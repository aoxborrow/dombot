import {
  RegistrarClient,
  createRegistrar,
  listPortfolio,
  registrars,
  type OperationResult,
  type RegisterDomainInput,
  type RegistrarCredentials,
  type RegistrarName,
  type RequestOptions,
} from '@aoxborrow/registrar-client';
import {
  accountById,
  createAccount,
  isSavedAccount,
  listAccounts,
  removeAccountRecord,
} from './accounts';
import { domainKey } from '../../shared/account-key';
import { serialByKey } from './serial-by-key';
import { getStoredCredentials, setStoredCredentials } from './credentials';
import { resolveNameservers } from '../dns';
import { isRegistrarEnabled, setRegistrarEnabled } from './registrar-state';
import {
  clearEntry,
  isStale,
  patchEntryData,
  readAll,
  readEntry,
  writeEntry,
} from './cache';
import {
  resolvePricing,
  tldOf,
  usesPerNameQuote,
  type RenewalQuote,
} from './pricing';
import type {
  Domain,
  RegistrarAccount,
  RegistrarDefinition,
  Portfolio,
  PortfolioErrorInfo,
  RegistrarMeta,
  RenewalPricing,
} from '../../shared/ipc';

const detailKey = (accountId: string, domain: string): string =>
  `${accountId}:${domain}`;

// A cached per-domain detail record: the domain's detail fields (nameservers,
// privacy, lock, creation date) plus an optional per-name renewal quote captured
// during Sync for the registrars that can price a specific owned domain. Keeping
// the quote here means one cache for all domain data — refreshed and cleared with
// the detail, never on a separate pricing schedule.
type DetailRecord = Partial<Domain> & { renewalQuote?: RenewalQuote };

/** A detail record without its renewal quote — the domain-only view callers get. */
function withoutQuote(record: DetailRecord): Partial<Domain> {
  const rest = { ...record };
  delete rest.renewalQuote;
  delete rest.accountId;
  delete rest.accountLabel;
  return rest;
}

/**
 * One registrar's slice of the portfolio, cached under the 'portfolio' namespace
 * keyed by registrar id (so each syncs independently). `lastSyncedAt` is the last
 * time domains were fetched *successfully*; `lastError` is the most recent
 * attempt's error (null when it succeeded). On a failed sync we keep the last-good
 * `domains` and `lastSyncedAt`, and only set `lastError`.
 */
interface RegistrarPortfolioEntry {
  domains: Domain[];
  lastSyncedAt: number | null;
  lastError: string | null;
}

/** Dates round-trip through JSON as ISO strings; revive them back to `Date`. */
function reviveDomainDates<T extends Partial<Domain>>(d: T): T {
  const out = { ...d } as Partial<Domain>;
  if (out.createdDate != null) out.createdDate = new Date(out.createdDate);
  if (out.expirationDate != null)
    out.expirationDate = new Date(out.expirationDate);
  return out as T;
}

// Cache one client per account so we don't rebuild it on every call.
const clients = new Map<string, RegistrarClient>();
const clientCredentials = new Map<string, string>();
const generations = new Map<string, number>();
function invalidateAccount(id: string): void {
  clients.delete(id);
  clientCredentials.delete(id);
  generations.set(id, (generations.get(id) ?? 0) + 1);
}

/** All built-in registrar ids, e.g. "dynadot", "godaddy". */
export const registrarNames = Object.keys(registrars) as [
  RegistrarName,
  ...RegistrarName[],
];

/** The library's capability list for a provider (core + extended `Feature` ids). */
export function getRegistrarFeatures(name: RegistrarName): readonly string[] {
  return registrars[name].features;
}

/** Resolve once before work starts. Labels never participate in routing. */
export function resolveAccount(
  name: RegistrarName,
  accountId?: string,
  domainName?: string,
): RegistrarAccount {
  const accounts = listAccounts().filter((a) => a.registrar === name);
  const configured = accounts.filter((a) => isConfigured(name, a.id));
  const target = domainName?.trim().toLowerCase();
  const owners = target
    ? listAccounts().filter((a) =>
        readRegistrarEntry(a.id)?.domains.some(
          (d) => d.domainName.toLowerCase() === target,
        ),
      )
    : [];
  let account: RegistrarAccount | undefined;
  if (accountId) {
    account = accountById(accountId);
    if (account.registrar !== name)
      throw new Error(
        `Account "${accountId}" does not belong to registrar "${name}".`,
      );
  } else {
    const ownersHere = owners.filter((a) => a.registrar === name);
    const matches = ownersHere.filter(
      (a) => configured.some((c) => c.id === a.id) && isRegistrarEnabled(a.id),
    );
    if (matches.length === 1) account = matches[0];
    else if (matches.length > 1)
      throw new Error(
        'Multiple accounts match. Pass accountId to disambiguate.',
      );
    // A single cached owner that isn't usable (disabled or missing credentials):
    // resolve to it so the caller gets the precise reason, not a misleading
    // "multiple accounts match" when only one account actually holds the domain.
    else if (ownersHere.length === 1) account = ownersHere[0];
    else if (ownersHere.length > 1 || configured.length > 1)
      throw new Error(
        'Multiple accounts match. Pass accountId to disambiguate.',
      );
    else
      account =
        configured[0] ?? (accounts.length === 1 ? accounts[0] : undefined);
  }
  if (!account)
    throw new Error(
      'No account selected. Configure an account in Settings or pass accountId.',
    );
  if (owners.length && !owners.some((a) => a.id === account.id))
    throw new Error(
      `Domain "${domainName}" is cached in a different account. Sync or select its owning account.`,
    );
  return account;
}

/** Validates a domain target before any cached read or provider operation. */
export function resolveDomainAccount(
  name: RegistrarName,
  domain: string,
  accountId?: string,
): RegistrarAccount {
  const account = resolveAccount(name, accountId, domain);
  requireActive(account);
  return account;
}

function requireActive(account: RegistrarAccount): void {
  if (!isRegistrarEnabled(account.id))
    throw new Error(`Account "${account.label}" is disabled.`);
  if (!isConfigured(account.registrar, account.id))
    throw new Error(
      `Missing credentials for "${account.label}" (configure in Settings).`,
    );
}

export function getRegistrarClient(
  name: RegistrarName,
  accountId?: string,
): RegistrarClient {
  const account = resolveAccount(name, accountId);
  requireActive(account);
  const credentials = resolveCredentials(name, account.id);
  const fingerprint = JSON.stringify(credentials);
  if (clientCredentials.get(account.id) !== fingerprint)
    invalidateAccount(account.id);
  let client = clients.get(account.id);
  if (!client) {
    client = new RegistrarClient(createRegistrar(name, credentials));
    clients.set(account.id, client);
    clientCredentials.set(account.id, fingerprint);
  }
  return client;
}

export function getConfiguredRegistrars(): RegistrarName[] {
  return [
    ...new Set(
      listAccounts()
        .filter((a) => isConfigured(a.registrar, a.id))
        .map((a) => a.registrar),
    ),
  ];
}

export function getActiveAccounts(): RegistrarAccount[] {
  return listAccounts().filter(
    (a) => isConfigured(a.registrar, a.id) && isRegistrarEnabled(a.id),
  );
}

export function getActiveRegistrars(): RegistrarName[] {
  return [...new Set(getActiveAccounts().map((a) => a.registrar))];
}

/** One registrar's cached slice (dates revived), or null when never synced. */
function readRegistrarEntry(name: string): RegistrarPortfolioEntry | null {
  const cached = readEntry<RegistrarPortfolioEntry>('portfolio', name);
  if (!cached) return null;
  return {
    ...cached.data,
    domains: cached.data.domains.map(reviveDomainDates),
  };
}

/** Display-name map for every built-in registrar (id → e.g. "Dynadot"). */
function registrarLabelMap(): Record<string, string> {
  return Object.fromEntries(
    registrarNames.map((name) => [name, registrars[name].displayName]),
  );
}

/**
 * Assembles the aggregate portfolio from the per-registrar cache slices of every
 * *configured* registrar. `registrars` and the headline `fetchedAt` cover only
 * registrars that have synced successfully at least once (so counts reflect real
 * data); a configured registrar that only ever errored still contributes its
 * error. No network — pure cache read.
 */
function assemblePortfolio(): Portfolio {
  const domains: Domain[] = [];
  const errors: PortfolioErrorInfo[] = [];
  const registrarIds: string[] = [];
  let fetchedAt: number | null = null;

  for (const account of getActiveAccounts()) {
    const name = account.registrar;
    const entry = readRegistrarEntry(account.id);
    if (!entry) continue;
    domains.push(
      ...entry.domains.map((d) => ({
        ...d,
        registrar: name,
        accountId: account.id,
        accountLabel: account.label,
      })),
    );
    if (entry.lastError)
      errors.push({
        registrar: name,
        accountId: account.id,
        accountLabel: account.label,
        message: entry.lastError,
      });
    if (entry.lastSyncedAt != null) {
      registrarIds.push(name);
      fetchedAt = Math.max(fetchedAt ?? 0, entry.lastSyncedAt);
    }
  }

  return {
    domains,
    errors,
    registrars: [...new Set(registrarIds)],
    registrarLabels: registrarLabelMap(),
    fetchedAt,
  };
}

/**
 * Syncs one registrar's domains into the cache. On success we replace its slice
 * with the freshly-listed domains and stamp `lastSyncedAt`. On failure (missing
 * creds, or a per-registrar list error) we keep the last-good domains and
 * `lastSyncedAt` and only record `lastError`, so a transient failure doesn't blank
 * a registrar that was working.
 */
async function syncRegistrarInto(account: RegistrarAccount): Promise<void> {
  const { registrar: name, id: accountId } = account;
  let generation = generations.get(accountId) ?? 0;
  const prev = readRegistrarEntry(accountId);
  let entry: RegistrarPortfolioEntry;
  try {
    const client = getRegistrarClient(name, accountId);
    generation = (generations.get(accountId) ?? 0) + 1;
    generations.set(accountId, generation);
    const { domains, errors } = await listPortfolio([client]);
    const error = errors[0]?.error;
    entry = error
      ? {
          domains: prev?.domains ?? [],
          lastSyncedAt: prev?.lastSyncedAt ?? null,
          lastError: error.message,
        }
      : { domains, lastSyncedAt: Date.now(), lastError: null };
  } catch (err) {
    entry = {
      domains: prev?.domains ?? [],
      lastSyncedAt: prev?.lastSyncedAt ?? null,
      lastError: err instanceof Error ? err.message : String(err),
    };
  }
  if ((generations.get(accountId) ?? 0) !== generation) return;
  writeEntry('portfolio', accountId, entry);
  // Refresh per-name renewal quotes as part of the sync. Only registrars that
  // can price a specific owned domain, and only on premium-capable TLDs, make an
  // API call here; every other domain resolves from the bundled base rates with
  // no network. Quotes land in each domain's detail cache (see syncRenewalQuotes).
  if (!entry.lastError)
    await syncRenewalQuotes(name, entry.domains, accountId, generation);
}

/**
 * Fetch a fresh per-name renewal quote for a domain (the premium-accurate price
 * a registrar reports for a domain you own), or null on any failure. Only called
 * for `usesPerNameQuote` registrars, so `getPricing` is always supported here.
 */
async function fetchRenewalQuote(
  name: RegistrarName,
  domain: string,
  accountId: string,
): Promise<RenewalQuote | null> {
  try {
    const pricing = await getRegistrarClient(name, accountId).getPricing(
      domain,
    );
    return {
      renewal: typeof pricing.renewal === 'number' ? pricing.renewal : null,
      currency: pricing.currency ?? 'USD',
    };
  } catch {
    return null;
  }
}

/**
 * During a sync, fetch fresh per-name renewal quotes for the registrar's
 * premium-capable domains and merge each into that domain's detail cache entry.
 * Bounded concurrency keeps us well under any registrar's rate limit. A no-op for
 * registrars that don't price per name — those domains always take the base rate.
 */
async function syncRenewalQuotes(
  name: RegistrarName,
  domains: Domain[],
  accountId: string,
  generation: number,
): Promise<void> {
  const todo = domains.filter((d) =>
    usesPerNameQuote(name, tldOf(d.domainName)),
  );
  if (todo.length === 0) return;

  const CONCURRENCY = 4;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const d = todo[next++];
      const quote = await fetchRenewalQuote(name, d.domainName, accountId);
      if ((generations.get(accountId) ?? 0) !== generation) return;
      if (!quote) continue;
      // Merge onto any existing detail so nameservers/privacy/lock are preserved.
      const key = detailKey(accountId, d.domainName);
      const existing = readEntry<DetailRecord>('detail', key)?.data ?? {};
      writeEntry('detail', key, { ...existing, renewalQuote: quote });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker),
  );
}

/**
 * The aggregated portfolio across every configured registrar, cache-backed.
 *
 * With `refresh` false we return the assembled cache verbatim (instant, no
 * network) — the launch/hydration path. With `refresh` true (the default, e.g.
 * the "Sync domains" button) we re-sync every configured registrar in parallel,
 * then return the assembled result.
 */
export async function getPortfolio(refresh = true): Promise<Portfolio> {
  if (refresh) {
    // Only sync enabled registrars — a disabled one keeps its credentials but is
    // deliberately skipped.
    await Promise.all(getActiveAccounts().map(syncRegistrarInto));
  }
  return assemblePortfolio();
}

/**
 * Syncs a single registrar (e.g. right after its credentials are saved) and
 * returns the updated aggregate portfolio, merged with every other registrar's
 * cached slice.
 */
export async function syncRegistrar(
  name: RegistrarName,
  accountId?: string,
): Promise<Portfolio> {
  const account = resolveAccount(name, accountId);
  if (isConfigured(name, account.id)) {
    // A configured account keeps its cached slice even while disabled — the
    // portfolio just hides it (see setRegistrarEnabledCached, which never
    // clears). Only sync when it's actually enabled.
    if (isRegistrarEnabled(account.id)) await syncRegistrarInto(account);
  } else {
    // Credentials are gone — drop the stale slice so it can't reappear.
    clearRegistrarData(account.id);
  }
  return assemblePortfolio();
}

export async function setRegistrarEnabledCached(
  name: RegistrarName,
  enabled: boolean,
  accountId?: string,
): Promise<Portfolio> {
  const account = resolveAccount(name, accountId);
  invalidateAccount(account.id);
  setRegistrarEnabled(account.id, enabled);
  if (enabled && isConfigured(name, account.id))
    await syncRegistrarInto(account);
  return assemblePortfolio();
}

export async function removeRegistrarAccount(accountId: string): Promise<void> {
  accountById(accountId);
  invalidateAccount(accountId);
  await setStoredCredentials(accountId, {});
  clearRegistrarData(accountId);
  await removeAccountRecord(accountId);
}

/** Drops a registrar's cached portfolio slice and every one of its detail entries. */
function clearRegistrarData(name: string): void {
  clearEntry('portfolio', name);
  const prefix = `${name}:`;
  for (const key of Object.keys(readAll<DetailRecord>('detail'))) {
    if (key.startsWith(prefix)) clearEntry('detail', key);
  }
}

/** The cached portfolio (revived), or null when nothing has ever synced. */
export function getCachedPortfolio(): Portfolio | null {
  const anySynced = getActiveAccounts().some((account) =>
    readEntry('portfolio', account.id),
  );
  return anySynced ? assemblePortfolio() : null;
}

/**
 * Distinct registrars that hold `domainName` in the cached portfolio
 * (case-insensitive). Backs the MCP tools' automatic registrar resolution, so a
 * caller can act on a domain it owns without knowing which registrar holds it.
 * Normally one; empty when the domain isn't cached (never synced, or added
 * since the last sync), and more than one only if a stale cache still lists a
 * transferred-away domain at its old registrar too.
 */
export function findRegistrarsForDomain(domainName: string): RegistrarName[] {
  const target = domainName.trim().toLowerCase();
  const found = new Set<RegistrarName>();
  for (const d of getCachedPortfolio()?.domains ?? []) {
    if (d.domainName.toLowerCase() === target) {
      found.add(d.registrar as RegistrarName);
    }
  }
  return [...found];
}

/** All cached per-domain detail partials, keyed `registrar:domain` (revived).
 *  The stored renewal quote is dropped — it feeds pricing, not the detail overlay. */
export function getCachedDetail(): Record<string, Partial<Domain>> {
  const all = readAll<DetailRecord>('detail');
  const out: Record<string, Partial<Domain>> = {};
  for (const [key, entry] of Object.entries(all)) {
    out[key] = reviveDomainDates(withoutQuote(entry.data));
  }
  return out;
}

/**
 * Renewal pricing for every cached portfolio domain, computed from local data
 * only (manual override → the quote captured at Sync → the bundled base rate).
 * No network — backs the launch snapshot and the store's post-sync refresh.
 */
export function getPortfolioPricing(): Record<string, RenewalPricing> {
  const portfolio = getCachedPortfolio();
  if (!portfolio) return {};
  const quotes = readAll<DetailRecord>('detail');
  const out: Record<string, RenewalPricing> = {};
  for (const d of portfolio.domains) {
    const registrar = d.registrar as RegistrarName;
    const key = domainKey(d);
    out[key] = {
      ...resolvePricing(
        registrar,
        d.domainName,
        quotes[key]?.data.renewalQuote,
        d.accountId,
      ),
      accountId: d.accountId,
    };
  }
  return out;
}

/**
 * A single domain's renewal price with a fresh per-name quote when the registrar
 * supports one — the live, premium-accurate lookup for the MCP tool. The UI never
 * uses this; it reads the Sync-populated `getPortfolioPricing` instead.
 */
export async function getRenewalPriceLive(
  name: RegistrarName,
  domain: string,
  accountId?: string,
): Promise<RenewalPricing> {
  accountId = resolveDomainAccount(name, domain, accountId).id;
  const quote = usesPerNameQuote(name, tldOf(domain))
    ? ((await fetchRenewalQuote(name, domain, accountId)) ?? undefined)
    : undefined;
  return { ...resolvePricing(name, domain, quote, accountId), accountId };
}

// The registrar-client library lists its config fields in an order that puts a
// couple of registrars' account/ID field after the secret it identifies, which
// reads backwards in the form. Override the display order so the identifier
// comes first; registrars not listed keep the library's order. Any field names
// not mentioned here are appended in their original order, so this stays correct
// if the library adds fields later.
//
// GoDaddy is deliberately absent: it now exposes a single credential, the PAT
// (`apiToken`), so there is nothing to reorder. The library still carries the
// legacy sso-key (`apiKey`/`apiSecret`) and `customerId` handling internally,
// but those are no longer configurable — which means GoDaddy domain forwarding
// (which needs `customerId`, plus an sso-key to resolve a numeric shopper ID) is
// unavailable through the app. GoDaddy deprecates sso-key in 2026 regardless.
const FIELD_ORDER: Partial<Record<RegistrarName, string[]>> = {
  cloudflare: ['accountId', 'apiToken'],
};

function orderConfigFields<T extends { name: string }>(
  name: RegistrarName,
  fields: T[],
): T[] {
  const order = FIELD_ORDER[name];
  if (!order) return fields;
  return fields
    .slice()
    .sort(
      (a, b) =>
        (order.indexOf(a.name) + 1 || Infinity) -
        (order.indexOf(b.name) + 1 || Infinity),
    );
}

/** Provider catalog stays available even after its last account is removed. */
export function getRegistrarCatalog(): RegistrarDefinition[] {
  return registrarNames.map((name) => {
    const R = registrars[name];
    return {
      name,
      displayName: R.displayName,
      supportsSandbox: R.supportsSandbox,
      configFields: orderConfigFields(name, R.configFields).map((f) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.options,
      })),
      features: [...R.features],
    };
  });
}

/** Metadata for stored accounts and backward-compatible default placeholders. */
export function getRegistrarMetadata(): RegistrarMeta[] {
  const catalog = getRegistrarCatalog();
  return listAccounts().map((account) => {
    const sync = readEntry<RegistrarPortfolioEntry>(
      'portfolio',
      account.id,
    )?.data;
    return {
      ...catalog.find((r) => r.name === account.registrar)!,
      accountId: account.id,
      accountLabel: account.label,
      saved:
        isSavedAccount(account.id) ||
        Object.keys(getStoredCredentials(account.id)).length > 0,
      configured: isConfigured(account.registrar, account.id),
      enabled: isRegistrarEnabled(account.id),
      sync: {
        lastSyncedAt: sync?.lastSyncedAt ?? null,
        lastError: sync?.lastError ?? null,
        domainCount: sync?.domains.length ?? 0,
      },
    };
  });
}

const publishConnection = serialByKey();

/** Check draft credentials without saving them, then publish a complete account. */
export async function connectRegistrarAccount(
  name: RegistrarName,
  credentials: RegistrarCredentials,
  label?: string,
): Promise<RegistrarAccount> {
  const provider = getRegistrarCatalog().find((r) => r.name === name);
  if (!provider) throw new Error('Unknown registrar.');
  const clean: RegistrarCredentials = {};
  for (const field of provider.configFields) {
    const value = credentials[field.name]?.trim();
    if (value) clean[field.name] = value;
    else if (field.required) throw new Error(`${field.label} is required.`);
  }
  if (!Object.keys(clean).length)
    throw new Error('Enter your account credentials.');
  if ((label?.trim().length ?? 0) > 100)
    throw new Error('Account label must contain at most 100 characters.');
  const assertNotDuplicate = () => {
    const duplicate = getRegistrarMetadata().find(
      (account) =>
        account.name === name &&
        account.saved &&
        provider.configFields.every(
          (field) =>
            (getStoredCredentials(account.accountId ?? name)[
              field.name
            ]?.trim() ?? '') === (clean[field.name] ?? ''),
        ),
    );
    if (duplicate)
      throw new Error(
        `These credentials are already connected as "${duplicate.accountLabel}". Edit that account instead.`,
      );
  };
  assertNotDuplicate();
  const client = new RegistrarClient(createRegistrar(name, clean));
  const result = await client.testConnection();
  if (!result.success)
    throw new Error(
      result.message ||
        'Connection failed. Check your credentials and try again.',
    );
  // Concurrent tests may both pass before either account exists. Recheck and
  // publish serially, while keeping network tests outside this short queue.
  return publishConnection(name, async () => {
    assertNotDuplicate();
    const existing = getRegistrarMetadata().filter(
      (a) => a.name === name && a.saved,
    );
    let number = existing.length + 1;
    let suggested = existing.length ? `Account ${number}` : 'Main';
    while (existing.some((a) => a.accountLabel === suggested))
      suggested = `Account ${++number}`;
    return createAccount(name, label?.trim() || suggested, clean);
  });
}

/** The saved credential values for a registrar (for pre-filling the form). */
export function getRegistrarCredentialValues(
  name: RegistrarName,
  accountId?: string,
): RegistrarCredentials {
  return getStoredCredentials(resolveAccount(name, accountId).id);
}

/** Drops every cached client (credentials were replaced wholesale, e.g. by
 *  a data import) so the next call rebuilds from what's stored now. */
export function resetRegistrarClients(): void {
  for (const id of clients.keys()) invalidateAccount(id);
}

/** Saves credentials and invalidates the cached client so the next call rebuilds. */
export async function saveRegistrarCredentials(
  name: RegistrarName,
  creds: RegistrarCredentials,
  accountId?: string,
): Promise<void> {
  const account = resolveAccount(name, accountId);
  invalidateAccount(account.id);
  await setStoredCredentials(account.id, creds);
  clearRegistrarData(account.id);
}

/**
 * Best-available detail for a single domain, for lazy per-row UI enrichment.
 * Returns a partial that the caller merges over the list summary:
 *  - `getDomain` for the full record (privacy/lock/dates/nameservers), then
 *  - a `getNameservers` fallback for providers whose detail omits them, then
 *  - a live DNS `NS` query for the rest — the source of truth for domains whose
 *    registrar can't report nameservers (a Cloudflare domain not added as a zone,
 *    or one on the registrar's own DNS, e.g. Dynadot's `ns*.dyna-ns.net`). It
 *    runs even when `getDomain` fails (e.g. Dynadot's detail API rejects some
 *    TLDs its list still returns).
 * Creation date is taken only from the registrar; providers that don't report
 * one (e.g. NameBright) leave it blank rather than triggering an extra lookup.
 * Returns null only when nothing could be resolved.
 */
export async function getDomainDetail(
  name: RegistrarName,
  domainName: string,
  refresh = false,
  accountId?: string,
): Promise<Partial<Domain> | null> {
  accountId = resolveDomainAccount(name, domainName, accountId).id;
  const client = getRegistrarClient(name, accountId);
  const generation = generations.get(accountId) ?? 0;
  const key = detailKey(accountId, domainName);
  // Preserve any renewal quote captured at Sync when we rewrite this entry below,
  // so refreshing detail doesn't drop the domain's price.
  const priorQuote = readEntry<DetailRecord>('detail', key)?.data.renewalQuote;
  const withQuote = <T extends object>(record: T): T & DetailRecord =>
    priorQuote ? { ...record, renewalQuote: priorQuote } : record;
  if (!refresh) {
    const cached = readEntry<DetailRecord>('detail', key);
    // Serve a fresh-enough cached partial without any network calls.
    if (cached && !isStale(cached)) {
      return {
        ...reviveDomainDates(withoutQuote(cached.data)),
        registrar: name,
        accountId,
        accountLabel: accountById(accountId).label,
      };
    }
  }

  let domain: Domain | null = null;
  try {
    domain = await client.getDomain(domainName);
  } catch {
    // Detail unavailable for this TLD — fall through to registry-only lookups.
  }

  let nameservers = domain?.nameservers ?? [];
  if (nameservers.length === 0) {
    try {
      const fromRegistrar = await client.getNameservers(domainName);
      if (fromRegistrar.length > 0) nameservers = fromRegistrar;
    } catch {
      // registrar can't supply them via this endpoint either
    }
  }

  const createdDate = domain?.createdDate ?? null;

  // Fall back to a live DNS query only for nameservers the registrar can't
  // report (a Cloudflare domain not added as a zone, or one on the registrar's
  // own DNS). Creation date is left to the registrar — providers that omit it
  // (e.g. NameBright) stay blank rather than triggering an extra lookup.
  if (nameservers.length === 0) {
    nameservers = await lookupNameservers(domainName);
  }

  if ((generations.get(accountId) ?? 0) !== generation)
    throw new Error(
      'Account changed while loading detail; refresh the portfolio.',
    );
  if (domain) {
    const result = {
      ...domain,
      registrar: name,
      accountId,
      accountLabel: accountById(accountId).label,
      nameservers,
      ...(createdDate ? { createdDate } : {}),
    };
    if ((generations.get(accountId) ?? 0) === generation)
      writeEntry('detail', key, withQuote(result));
    return result;
  }
  const partial: Partial<Domain> = {};
  if (nameservers.length > 0) partial.nameservers = nameservers;
  if (createdDate) partial.createdDate = createdDate;
  // Nothing resolved this round: don't drop a previously-stored quote — keep the
  // entry alive if one exists, else stay uncached so a later refresh retries.
  if (Object.keys(partial).length === 0) {
    return priorQuote ? {} : null;
  }
  if ((generations.get(accountId) ?? 0) === generation)
    writeEntry('detail', key, withQuote(partial));
  return partial;
}

/**
 * Portfolio domains merged with any cached per-domain detail (nameservers,
 * privacy, lock, creation date), plus sync health: the headline `fetchedAt`, the
 * registrars that have synced, and any per-registrar sync `errors` (so a caller
 * knows the result is incomplete). A pure cache read — no network — mirroring
 * the renderer's `enriched` overlay so filters on detail-only fields work when a
 * domain has been enriched. Backs the MCP `portfolio_query` tool.
 */
export function getMergedPortfolio(): {
  domains: Domain[];
  fetchedAt: number | null;
  registrars: string[];
  errors: PortfolioErrorInfo[];
} {
  const portfolio = getCachedPortfolio();
  if (!portfolio)
    return { domains: [], fetchedAt: null, registrars: [], errors: [] };
  const detail = getCachedDetail();
  const domains = portfolio.domains.map((d) => {
    const extra = detail[domainKey(d)];
    return extra
      ? {
          ...d,
          ...extra,
          registrar: d.registrar,
          accountId: d.accountId,
          accountLabel: d.accountLabel,
        }
      : d;
  });
  return {
    domains,
    fetchedAt: portfolio.fetchedAt,
    registrars: portfolio.registrars,
    errors: portfolio.errors,
  };
}

/**
 * Applies a known field change to both the portfolio slice and the per-domain
 * detail cache (each entry's `fetchedAt` preserved), so a relaunch — and an open
 * Domains table (via the `portfolioChanged` event) — reflect the new value
 * without waiting for the next full sync. No-op for entries that don't exist.
 */
function patchDomainInCaches(
  name: RegistrarName,
  domainName: string,
  patch: Partial<Domain>,
  accountId: string,
): void {
  patchEntryData<RegistrarPortfolioEntry>('portfolio', accountId, (e) => ({
    ...e,
    domains: e.domains.map((d) =>
      d.domainName === domainName ? { ...d, ...patch } : d,
    ),
  }));
  patchEntryData<Partial<Domain>>(
    'detail',
    detailKey(accountId, domainName),
    (d) => ({
      ...d,
      ...patch,
    }),
  );
}

/**
 * Sets auto-renew and, on success, writes the new value into the portfolio and
 * detail caches. Returns the raw `OperationResult` (some providers report a soft
 * failure via `success: false` rather than throwing) without throwing, so an MCP
 * caller sees the provider's own message. The UI-facing `setDomainAutoRenew`
 * wraps this and normalizes a soft failure to a throw for its optimistic toggle.
 */
export async function setAutoRenewCached(
  name: RegistrarName,
  domainName: string,
  enabled: boolean,
  opts?: RequestOptions,
  accountId?: string,
): Promise<OperationResult> {
  accountId = resolveDomainAccount(name, domainName, accountId).id;
  const result = await getRegistrarClient(name, accountId).setAutoRenew(
    domainName,
    enabled,
    opts,
  );
  if (result.success)
    patchDomainInCaches(name, domainName, { autoRenew: enabled }, accountId);
  return result;
}

/** Sets the transfer lock and, on success, patches the caches. Returns the raw
 * result (no throw). */
export async function setLockCached(
  name: RegistrarName,
  domainName: string,
  locked: boolean,
  opts?: RequestOptions,
  accountId?: string,
): Promise<OperationResult> {
  accountId = resolveDomainAccount(name, domainName, accountId).id;
  const client = getRegistrarClient(name, accountId);
  const result = await (locked
    ? client.lockDomain(domainName, opts)
    : client.unlockDomain(domainName, opts));
  if (result.success)
    patchDomainInCaches(name, domainName, { locked }, accountId);
  return result;
}

/** Sets WHOIS privacy and, on success, patches the caches. Returns the raw
 * result (no throw). */
export async function setPrivacyCached(
  name: RegistrarName,
  domainName: string,
  enabled: boolean,
  opts?: RequestOptions,
  accountId?: string,
): Promise<OperationResult> {
  accountId = resolveDomainAccount(name, domainName, accountId).id;
  const result = await getRegistrarClient(name, accountId).setPrivacy(
    domainName,
    enabled,
    opts,
  );
  if (result.success)
    patchDomainInCaches(name, domainName, { privacy: enabled }, accountId);
  return result;
}

/** Replaces the nameservers and, on success, patches the caches. Returns the raw
 * result (no throw). */
export async function setNameserversCached(
  name: RegistrarName,
  domainName: string,
  nameservers: string[],
  opts?: RequestOptions,
  accountId?: string,
): Promise<OperationResult> {
  accountId = resolveDomainAccount(name, domainName, accountId).id;
  const result = await getRegistrarClient(name, accountId).updateNameservers(
    domainName,
    nameservers,
    opts,
  );
  if (result.success)
    patchDomainInCaches(name, domainName, { nameservers }, accountId);
  return result;
}

/**
 * Renews a domain. The registrar's `OperationResult` doesn't carry the new
 * expiry, so on success we re-fetch the domain's detail (which writes through the
 * detail cache) and patch the fresh expiration/renewal/status into the portfolio
 * slice too — that patch is returned so the caller can overlay it on its row. A
 * re-fetch failure is swallowed — the renewal still succeeded and the next Sync
 * corrects the date. Returns the raw result (no throw).
 *
 * Callers should pass `{ retries: 0 }`: a timed-out renew may have gone
 * through, and a blind retry would renew twice.
 */
export async function renewDomainCached(
  name: RegistrarName,
  domainName: string,
  years?: number,
  opts?: RequestOptions,
  accountId?: string,
): Promise<{ result: OperationResult; patch: Partial<Domain> }> {
  accountId = resolveDomainAccount(name, domainName, accountId).id;
  const result = await getRegistrarClient(name, accountId).renewDomain(
    domainName,
    years,
    opts,
  );
  const patch: Partial<Domain> = {};
  if (result.success) {
    try {
      const detail = await getDomainDetail(name, domainName, true, accountId);
      if (detail?.expirationDate != null)
        patch.expirationDate = detail.expirationDate;
      if (detail?.renewalDate != null) patch.renewalDate = detail.renewalDate;
      if (detail?.status != null) patch.status = detail.status;
      if (Object.keys(patch).length > 0)
        patchDomainInCaches(name, domainName, patch, accountId);
    } catch {
      // Renewal succeeded; leave the cached expiry for the next Sync to correct.
    }
  }
  return { result, patch };
}

/**
 * Registers a new domain and, on success, syncs that registrar's slice so the
 * new name enters the portfolio cache (the registrar's `OperationResult` doesn't
 * return a full `Domain` to append). Returns the raw result (no throw).
 */
export async function registerDomainCached(
  name: RegistrarName,
  domainName: string,
  input: RegisterDomainInput,
  accountId?: string,
): Promise<OperationResult> {
  accountId = resolveAccount(name, accountId).id;
  const result = await getRegistrarClient(name, accountId).registerDomain(
    domainName,
    input,
  );
  if (result.success) await syncRegistrarInto(accountById(accountId));
  return result;
}

/**
 * Reads a domain's live nameservers via a DNS `NS` query — the delegation the
 * domain actually uses, and the only way to see nameservers a registrar won't
 * report (a Cloudflare domain not added as a zone, or one on the registrar's own
 * DNS, e.g. Dynadot's `ns*.dyna-ns.net`). Goes over DNS-over-HTTPS so it works
 * on every host (see core/dns.ts); empty on any failure, timeout, or undelegated
 * domain.
 */
async function lookupNameservers(domainName: string): Promise<string[]> {
  try {
    return await resolveNameservers(domainName);
  } catch {
    // resolveNameservers already swallows failures; this is belt-and-braces.
    return [];
  }
}

// ── internals ────────────────────────────────────────────────────────────────

// Resolve a field to the value the user saved in Settings (encrypted at rest
// by the host). Credentials come only from the GUI store now — no .env or
// process.env fallback, so ambient vars from other tools can't shadow creds.
function resolveField(name: string, field: string): string | undefined {
  return getStoredCredentials(name)[field];
}

function isConfigured(name: RegistrarName, accountId: string): boolean {
  const fields = registrars[name].configFields;
  // Every required field must resolve to a value.
  const requiredOk = fields.every(
    (field) => !field.required || Boolean(resolveField(accountId, field.name)),
  );
  if (!requiredOk) return false;
  // Some registrars mark every credential field optional because they accept
  // one of several auth shapes. There "all required fields present" is vacuously
  // true even with nothing entered, which would make the registrar look
  // configured on a fresh install and then 401 on the first query. So when
  // nothing is required, also demand at least one credential value before
  // treating the registrar as configured.
  if (fields.some((field) => field.required)) return true;
  return fields.some((field) => Boolean(resolveField(accountId, field.name)));
}

function resolveCredentials(
  name: RegistrarName,
  accountId: string,
): RegistrarCredentials {
  const creds: RegistrarCredentials = {};
  const missing: string[] = [];
  for (const field of registrars[name].configFields) {
    const value = resolveField(accountId, field.name);
    if (value) creds[field.name] = value;
    else if (field.required) missing.push(field.name);
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing credentials for "${name}": ${missing.join(', ')} (configure in Settings).`,
    );
  }
  return creds;
}
