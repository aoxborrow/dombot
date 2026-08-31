import {
  RegistrarClient,
  createRegistrar,
  listPortfolio,
  registrars,
  type Domain,
  type RegistrarCredentials,
  type RegistrarName,
} from '@aoxborrow/registrar-client';
import { getStoredCredentials, setStoredCredentials } from './credentials';
import { getDevEnvVar } from './dev-env';
import { isStale, readAll, readEntry, writeEntry } from './cache';
import type { Portfolio, RegistrarMeta, TestResult } from '../../shared/ipc';

// Cache key for the single aggregated portfolio, and the per-domain detail key.
const PORTFOLIO_KEY = 'all';
const detailKey = (name: RegistrarName, domain: string): string =>
  `${name}:${domain}`;

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

/** Clients for every configured registrar — the sources for a portfolio view. */
export function getPortfolioSources(): RegistrarClient[] {
  return getConfiguredRegistrars().map(getRegistrarClient);
}

/**
 * The aggregated portfolio across every configured registrar, cache-backed.
 *
 * With `refresh` false we return the cached portfolio verbatim when one exists
 * (instant, no network) — the launch/hydration path. With `refresh` true (the
 * default, e.g. the UI's Refresh button) we re-query every registrar, cache the
 * result, and return it. `listPortfolio` isolates per-registrar failures; we
 * flatten its Error objects to plain messages so the result survives IPC clone.
 */
export async function getPortfolio(refresh = true): Promise<Portfolio> {
  if (!refresh) {
    const cached = readEntry<Portfolio>('portfolio', PORTFOLIO_KEY);
    if (cached) {
      return {
        ...cached.data,
        domains: cached.data.domains.map(reviveDomainDates),
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  const registrarIds = getConfiguredRegistrars();
  const { domains, errors } = await listPortfolio(getPortfolioSources());
  const registrarLabels = Object.fromEntries(
    getRegistrarMetadata().map((r) => [r.name, r.displayName]),
  );
  const portfolio: Portfolio = {
    domains,
    errors: errors.map(({ registrar, error }) => ({
      registrar,
      message: error.message,
    })),
    registrars: registrarIds,
    registrarLabels,
    fetchedAt: null,
  };
  // Cache the payload; stamp the returned copy with the write time.
  const entry = writeEntry('portfolio', PORTFOLIO_KEY, portfolio);
  return { ...portfolio, fetchedAt: entry.fetchedAt };
}

/** The cached portfolio (revived), or null — for launch hydration only. */
export function getCachedPortfolio(): Portfolio | null {
  const cached = readEntry<Portfolio>('portfolio', PORTFOLIO_KEY);
  if (!cached) return null;
  return {
    ...cached.data,
    domains: cached.data.domains.map(reviveDomainDates),
    fetchedAt: cached.fetchedAt,
  };
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
    return {
      name,
      displayName: R.displayName,
      helpText: R.helpText,
      supportsSandbox: R.supportsSandbox,
      configured: isConfigured(name),
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

/** Validates a registrar's credentials by calling its testConnection(). */
export async function testRegistrar(name: RegistrarName): Promise<TestResult> {
  try {
    const result = await getRegistrarClient(name).testConnection();
    return { ok: result.success, message: result.message };
  } catch (err) {
    // Bad creds may have been cached; drop so the next attempt rebuilds.
    clients.delete(name);
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
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
  return registrars[name].configFields.every(
    (field) => !field.required || Boolean(resolveField(name, field.name)),
  );
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
