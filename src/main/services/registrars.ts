import {
  RegistrarClient,
  createRegistrar,
  listPortfolio,
  registrars,
  type Domain,
  type OperationResult,
  type RegisterDomainInput,
  type RegistrarCredentials,
  type RegistrarName,
} from '@aoxborrow/registrar-client';
import { promises as dnsPromises } from 'node:dns';
import { getStoredCredentials, setStoredCredentials } from './credentials';
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
  Portfolio,
  PortfolioErrorInfo,
  RegistrarMeta,
  RenewalPricing,
} from '../../shared/ipc';

const detailKey = (name: RegistrarName, domain: string): string =>
  `${name}:${domain}`;

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

// Cache one client per registrar so we don't rebuild it on every call.
const clients = new Map<RegistrarName, RegistrarClient>();

/** All built-in registrar ids, e.g. "dynadot", "godaddy". */
export const registrarNames = Object.keys(registrars) as [
  RegistrarName,
  ...RegistrarName[],
];

/**
 * Returns a cached client for `name`, building it from resolved credentials on
 * first use. The shared lower-level core: MCP tools and UI IPC handlers both
 * call in.
 */
export function getRegistrarClient(name: RegistrarName): RegistrarClient {
  let client = clients.get(name);
  if (!client) {
    client = new RegistrarClient(
      createRegistrar(name, resolveCredentials(name)),
    );
    clients.set(name, client);
  }
  return client;
}

/** Registrars whose required credentials are all present (stored or in env). */
export function getConfiguredRegistrars(): RegistrarName[] {
  return registrarNames.filter((name) => isConfigured(name));
}

/** One registrar's cached slice (dates revived), or null when never synced. */
function readRegistrarEntry(
  name: RegistrarName,
): RegistrarPortfolioEntry | null {
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

  for (const name of getConfiguredRegistrars()) {
    const entry = readRegistrarEntry(name);
    if (!entry) continue;
    domains.push(...entry.domains);
    if (entry.lastError)
      errors.push({ registrar: name, message: entry.lastError });
    if (entry.lastSyncedAt != null) {
      registrarIds.push(name);
      fetchedAt = Math.max(fetchedAt ?? 0, entry.lastSyncedAt);
    }
  }

  return {
    domains,
    errors,
    registrars: registrarIds,
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
async function syncRegistrarInto(name: RegistrarName): Promise<void> {
  const prev = readRegistrarEntry(name);
  let entry: RegistrarPortfolioEntry;
  try {
    const { domains, errors } = await listPortfolio([getRegistrarClient(name)]);
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
  writeEntry('portfolio', name, entry);
  // Refresh per-name renewal quotes as part of the sync. Only registrars that
  // can price a specific owned domain, and only on premium-capable TLDs, make an
  // API call here; every other domain resolves from the bundled base rates with
  // no network. Quotes land in each domain's detail cache (see syncRenewalQuotes).
  await syncRenewalQuotes(name, entry.domains);
}

/**
 * Fetch a fresh per-name renewal quote for a domain (the premium-accurate price
 * a registrar reports for a domain you own), or null on any failure. Only called
 * for `usesPerNameQuote` registrars, so `getPricing` is always supported here.
 */
async function fetchRenewalQuote(
  name: RegistrarName,
  domain: string,
): Promise<RenewalQuote | null> {
  try {
    const pricing = await getRegistrarClient(name).getPricing(domain);
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
): Promise<void> {
  const todo = domains.filter((d) => usesPerNameQuote(name, tldOf(d.domainName)));
  if (todo.length === 0) return;

  const CONCURRENCY = 4;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const d = todo[next++];
      const quote = await fetchRenewalQuote(name, d.domainName);
      if (!quote) continue;
      // Merge onto any existing detail so nameservers/privacy/lock are preserved.
      const key = detailKey(name, d.domainName);
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
    await Promise.all(getConfiguredRegistrars().map(syncRegistrarInto));
  }
  return assemblePortfolio();
}

/**
 * Syncs a single registrar (e.g. right after its credentials are saved) and
 * returns the updated aggregate portfolio, merged with every other registrar's
 * cached slice.
 */
export async function syncRegistrar(name: RegistrarName): Promise<Portfolio> {
  if (isConfigured(name)) {
    await syncRegistrarInto(name);
  } else {
    // Credentials were cleared — drop the registrar's slice so its domains don't
    // linger (or resurface if it's reconfigured before the next sync).
    clearEntry('portfolio', name);
  }
  return assemblePortfolio();
}

/** The cached portfolio (revived), or null when nothing has ever synced. */
export function getCachedPortfolio(): Portfolio | null {
  const anySynced = getConfiguredRegistrars().some((name) =>
    readEntry('portfolio', name),
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
    const key = detailKey(registrar, d.domainName);
    out[`${d.registrar}:${d.domainName}`] = resolvePricing(
      registrar,
      d.domainName,
      quotes[key]?.data.renewalQuote,
    );
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
): Promise<RenewalPricing> {
  const quote = usesPerNameQuote(name, tldOf(domain))
    ? ((await fetchRenewalQuote(name, domain)) ?? undefined)
    : undefined;
  return resolvePricing(name, domain, quote);
}

// The registrar-client library lists its config fields in an order that puts a
// couple of registrars' account/ID field after the secret it identifies, which
// reads backwards in the form. Override the display order so the identifier
// comes first; registrars not listed keep the library's order. Any field names
// not mentioned here are appended in their original order, so this stays correct
// if the library adds fields later.
const FIELD_ORDER: Partial<Record<RegistrarName, string[]>> = {
  cloudflare: ['accountId', 'apiToken'],
  godaddy: ['customerId', 'apiToken', 'apiKey', 'apiSecret'],
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

/** Metadata that drives the Settings > Registrars form (no secret values). */
export function getRegistrarMetadata(): RegistrarMeta[] {
  return registrarNames.map((name) => {
    const R = registrars[name];
    const sync = readEntry<RegistrarPortfolioEntry>('portfolio', name)?.data;
    return {
      name,
      displayName: R.displayName,
      helpText: R.helpText,
      supportsSandbox: R.supportsSandbox,
      configured: isConfigured(name),
      sync: {
        lastSyncedAt: sync?.lastSyncedAt ?? null,
        lastError: sync?.lastError ?? null,
        domainCount: sync?.domains.length ?? 0,
      },
      configFields: orderConfigFields(name, R.configFields).map((f) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.options,
      })),
    };
  });
}

/** The saved credential values for a registrar (for pre-filling the form). */
export function getRegistrarCredentialValues(
  name: RegistrarName,
): RegistrarCredentials {
  return getStoredCredentials(name);
}

/** Saves credentials and invalidates the cached client so the next call rebuilds. */
export function saveRegistrarCredentials(
  name: RegistrarName,
  creds: RegistrarCredentials,
): void {
  setStoredCredentials(name, creds);
  clients.delete(name);
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
): Promise<Partial<Domain> | null> {
  const key = detailKey(name, domainName);
  // Preserve any renewal quote captured at Sync when we rewrite this entry below,
  // so refreshing detail doesn't drop the domain's price.
  const priorQuote = readEntry<DetailRecord>('detail', key)?.data.renewalQuote;
  const withQuote = <T extends object>(record: T): T & DetailRecord =>
    priorQuote ? { ...record, renewalQuote: priorQuote } : record;
  if (!refresh) {
    const cached = readEntry<DetailRecord>('detail', key);
    // Serve a fresh-enough cached partial without any network calls.
    if (cached && !isStale(cached)) {
      return reviveDomainDates(withoutQuote(cached.data));
    }
  }

  const client = getRegistrarClient(name);

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

  if (domain) {
    const result = {
      ...domain,
      nameservers,
      ...(createdDate ? { createdDate } : {}),
    };
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
    const extra = detail[detailKey(d.registrar as RegistrarName, d.domainName)];
    return extra ? { ...d, ...extra } : d;
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
): void {
  patchEntryData<RegistrarPortfolioEntry>('portfolio', name, (e) => ({
    ...e,
    domains: e.domains.map((d) =>
      d.domainName === domainName ? { ...d, ...patch } : d,
    ),
  }));
  patchEntryData<Partial<Domain>>(
    'detail',
    detailKey(name, domainName),
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
): Promise<OperationResult> {
  const result = await getRegistrarClient(name).setAutoRenew(
    domainName,
    enabled,
  );
  if (result.success)
    patchDomainInCaches(name, domainName, { autoRenew: enabled });
  return result;
}

/** Sets the transfer lock and, on success, patches the caches. Returns the raw
 * result (no throw). */
export async function setLockCached(
  name: RegistrarName,
  domainName: string,
  locked: boolean,
): Promise<OperationResult> {
  const client = getRegistrarClient(name);
  const result = await (locked
    ? client.lockDomain(domainName)
    : client.unlockDomain(domainName));
  if (result.success) patchDomainInCaches(name, domainName, { locked });
  return result;
}

/** Sets WHOIS privacy and, on success, patches the caches. Returns the raw
 * result (no throw). */
export async function setPrivacyCached(
  name: RegistrarName,
  domainName: string,
  enabled: boolean,
): Promise<OperationResult> {
  const result = await getRegistrarClient(name).setPrivacy(domainName, enabled);
  if (result.success)
    patchDomainInCaches(name, domainName, { privacy: enabled });
  return result;
}

/** Replaces the nameservers and, on success, patches the caches. Returns the raw
 * result (no throw). */
export async function setNameserversCached(
  name: RegistrarName,
  domainName: string,
  nameservers: string[],
): Promise<OperationResult> {
  const result = await getRegistrarClient(name).updateNameservers(
    domainName,
    nameservers,
  );
  if (result.success) patchDomainInCaches(name, domainName, { nameservers });
  return result;
}

/**
 * Renews a domain. The registrar's `OperationResult` doesn't carry the new
 * expiry, so on success we re-fetch the domain's detail (which writes through the
 * detail cache) and patch the fresh expiration/renewal/status into the portfolio
 * slice too. A re-fetch failure is swallowed — the renewal still succeeded and
 * the next Sync corrects the date. Returns the raw result (no throw).
 */
export async function renewDomainCached(
  name: RegistrarName,
  domainName: string,
  years?: number,
): Promise<OperationResult> {
  const result = await getRegistrarClient(name).renewDomain(domainName, years);
  if (result.success) {
    try {
      const detail = await getDomainDetail(name, domainName, true);
      const patch: Partial<Domain> = {};
      if (detail?.expirationDate != null)
        patch.expirationDate = detail.expirationDate;
      if (detail?.renewalDate != null) patch.renewalDate = detail.renewalDate;
      if (detail?.status != null) patch.status = detail.status;
      if (Object.keys(patch).length > 0)
        patchDomainInCaches(name, domainName, patch);
    } catch {
      // Renewal succeeded; leave the cached expiry for the next Sync to correct.
    }
  }
  return result;
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
): Promise<OperationResult> {
  const result = await getRegistrarClient(name).registerDomain(
    domainName,
    input,
  );
  if (result.success) await syncRegistrarInto(name);
  return result;
}

/**
 * UI-facing auto-renew toggle. Wraps `setAutoRenewCached` and normalizes a soft
 * failure (`success: false`, e.g. Namecheap) to a thrown error so the renderer's
 * optimistic toggle can roll back on a single failure mode.
 */
export async function setDomainAutoRenew(
  name: RegistrarName,
  domainName: string,
  enabled: boolean,
): Promise<OperationResult> {
  const result = await setAutoRenewCached(name, domainName, enabled);
  if (!result.success) {
    throw new Error(
      result.message || `Failed to update auto-renew for ${domainName}`,
    );
  }
  return result;
}

/**
 * Reads a domain's live nameservers via a DNS `NS` query — the delegation the
 * domain actually uses, and the only way to see nameservers a registrar won't
 * report (a Cloudflare domain not added as a zone, or one on the registrar's own
 * DNS, e.g. Dynadot's `ns*.dyna-ns.net`). Fast (a UDP round-trip), but capped
 * with a short timeout; empty on any failure, timeout, or undelegated domain.
 */
async function lookupNameservers(domainName: string): Promise<string[]> {
  try {
    const ns = await Promise.race([
      dnsPromises.resolveNs(domainName),
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 5_000)),
    ]);
    return ns.map((n) => n.toLowerCase().replace(/\.$/, '')).filter(Boolean);
  } catch {
    // NXDOMAIN, SERVFAIL, no NS records, etc. — nothing to add.
    return [];
  }
}

// ── internals ────────────────────────────────────────────────────────────────

// Resolve a field to the value the user saved in Settings (encrypted via
// safeStorage). Credentials come only from the GUI store now — no .env or
// process.env fallback, so ambient vars from other tools can't shadow creds.
function resolveField(name: RegistrarName, field: string): string | undefined {
  return getStoredCredentials(name)[field];
}

function isConfigured(name: RegistrarName): boolean {
  const fields = registrars[name].configFields;
  // Every required field must resolve to a value.
  const requiredOk = fields.every(
    (field) => !field.required || Boolean(resolveField(name, field.name)),
  );
  if (!requiredOk) return false;
  // Some registrars mark every credential field optional because they accept
  // one of several auth shapes (e.g. GoDaddy: a PAT, or a key + secret pair).
  // There "all required fields present" is vacuously true even with nothing
  // entered, which would make the registrar look configured on a fresh install
  // and then 401 on the first query. So when nothing is required, also demand
  // at least one credential value before treating the registrar as configured.
  if (fields.some((field) => field.required)) return true;
  return fields.some((field) => Boolean(resolveField(name, field.name)));
}

function resolveCredentials(name: RegistrarName): RegistrarCredentials {
  const creds: RegistrarCredentials = {};
  const missing: string[] = [];
  for (const field of registrars[name].configFields) {
    const value = resolveField(name, field.name);
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
