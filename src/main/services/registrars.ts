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
import { getStoredCredentials, setStoredCredentials } from './credentials';
import { getDevEnvVar } from './dev-env';
import {
  clearEntry,
  isStale,
  patchEntryData,
  readAll,
  readEntry,
  writeEntry,
} from './cache';
import type {
  Portfolio,
  PortfolioErrorInfo,
  RegistrarMeta,
} from '../../shared/ipc';

const detailKey = (name: RegistrarName, domain: string): string =>
  `${name}:${domain}`;

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

/** All cached per-domain detail partials, keyed `registrar:domain` (revived). */
export function getCachedDetail(): Record<string, Partial<Domain>> {
  const all = readAll<Partial<Domain>>('detail');
  const out: Record<string, Partial<Domain>> = {};
  for (const [key, entry] of Object.entries(all)) {
    out[key] = reviveDomainDates(entry.data);
  }
  return out;
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
      configFields: R.configFields.map((f) => ({
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
 *  - a dns.tools WHOIS/RDAP lookup for the registry's nameservers and, when the
 *    registrar doesn't expose one, the creation date (e.g. NameBright).
 * The registry fallbacks run even when `getDomain` fails (e.g. Dynadot's detail
 * API rejects some TLDs its list still returns). Returns null only when nothing
 * could be resolved.
 */
export async function getDomainDetail(
  name: RegistrarName,
  domainName: string,
  refresh = false,
): Promise<Partial<Domain> | null> {
  const key = detailKey(name, domainName);
  if (!refresh) {
    const cached = readEntry<Partial<Domain>>('detail', key);
    // Serve a fresh-enough cached partial without any network calls.
    if (cached && !isStale(cached)) return reviveDomainDates(cached.data);
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

  let createdDate = domain?.createdDate ?? null;

  // Fall back to the public registry (via dns.tools, RDAP/WHOIS per TLD) for
  // whatever the registrar couldn't supply: nameservers (e.g. a domain on the
  // registrar's default DNS) and/or the creation date (e.g. NameBright, whose
  // API returns no registration date at all).
  if (nameservers.length === 0 || createdDate === null) {
    const registry = await lookupRegistry(domainName);
    if (nameservers.length === 0) nameservers = registry.nameservers;
    if (createdDate === null) createdDate = registry.createdDate;
  }

  if (domain) {
    const result = {
      ...domain,
      nameservers,
      ...(createdDate ? { createdDate } : {}),
    };
    writeEntry('detail', key, result);
    return result;
  }
  const partial: Partial<Domain> = {};
  if (nameservers.length > 0) partial.nameservers = nameservers;
  if (createdDate) partial.createdDate = createdDate;
  // Only cache a partial that actually resolved something; a null result stays
  // uncached so a later refresh retries it.
  if (Object.keys(partial).length === 0) return null;
  writeEntry('detail', key, partial);
  return partial;
}

/**
 * Portfolio domains merged with any cached per-domain detail (nameservers,
 * privacy, lock, creation date), plus the headline `fetchedAt`. A pure cache
 * read — no network — mirroring the renderer's `enriched` overlay so filters on
 * detail-only fields work when a domain has been enriched. Backs the MCP
 * `portfolio_query`/`portfolio_list` tools.
 */
export function getMergedPortfolio(): {
  domains: Domain[];
  fetchedAt: number | null;
} {
  const portfolio = getCachedPortfolio();
  if (!portfolio) return { domains: [], fetchedAt: null };
  const detail = getCachedDetail();
  const domains = portfolio.domains.map((d) => {
    const extra = detail[detailKey(d.registrar as RegistrarName, d.domainName)];
    return extra ? { ...d, ...extra } : d;
  });
  return { domains, fetchedAt: portfolio.fetchedAt };
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
 * Reads a domain's nameservers and creation date from the public registry via
 * the dns.tools domain API, which picks RDAP or WHOIS per TLD. Fields are empty
 * on any failure. Set DNS_TOOLS_API_KEY to raise rate limits; the free tier
 * needs no auth.
 */
async function lookupRegistry(
  domainName: string,
): Promise<{ nameservers: string[]; createdDate: Date | null }> {
  const empty = { nameservers: [] as string[], createdDate: null };
  try {
    const apiKey = process.env.DNS_TOOLS_API_KEY;
    const res = await fetch(
      `https://api.dns.tools/v1/domain/${encodeURIComponent(domainName)}`,
      {
        headers: {
          accept: 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      results?: { nameservers?: string[]; creation_date?: string }[];
    };
    const result = data.results?.[0];
    const nameservers = (result?.nameservers ?? [])
      .map((ns) => ns.toLowerCase())
      .filter(Boolean);
    let createdDate: Date | null = null;
    if (result?.creation_date) {
      const parsed = new Date(result.creation_date);
      if (!Number.isNaN(parsed.getTime())) createdDate = parsed;
    }
    return { nameservers, createdDate };
  } catch {
    return empty;
  }
}

// ── internals ────────────────────────────────────────────────────────────────

// Maps a provider's configField (camelCase) to its env var, per the .env
// convention <PROVIDER>_<FIELD_UPPER_SNAKE>, e.g. apiKey -> DYNADOT_API_KEY.
function envKey(name: RegistrarName, field: string): string {
  const snake = field.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  return `${name.toUpperCase()}_${snake}`;
}

// Resolve a field: user-saved value first, then the dev-only .env fallback.
// Never reads process.env — ambient vars from other tools must not shadow creds.
function resolveField(name: RegistrarName, field: string): string | undefined {
  return getStoredCredentials(name)[field] ?? getDevEnvVar(envKey(name, field));
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
