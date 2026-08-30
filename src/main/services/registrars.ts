import {
  RegistrarClient,
  createRegistrar,
  registrars,
  type Domain,
  type RegistrarCredentials,
  type RegistrarName,
} from '@aoxborrow/registrar-client';
import { getStoredCredentials, setStoredCredentials } from './credentials';
import { getDevEnvVar } from './dev-env';
import type { RegistrarMeta, TestResult } from '../../shared/ipc';

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
 * Full detail for a single domain: getDomain, plus a getNameservers fallback for
 * providers whose detail endpoint omits nameservers (e.g. Namecheap). Used for
 * lazy per-row enrichment in the UI.
 */
export async function getDomainDetail(
  name: RegistrarName,
  domainName: string,
): Promise<Domain | null> {
  const client = getRegistrarClient(name);
  let domain: Domain;
  try {
    domain = await client.getDomain(domainName);
  } catch {
    // Detail unavailable — e.g. Dynadot's detail API rejects some TLDs that its
    // list endpoint still returns. Report "no detail" rather than throwing.
    return null;
  }
  if (domain.nameservers.length === 0) {
    try {
      const nameservers = await client.getNameservers(domainName);
      if (nameservers.length > 0) return { ...domain, nameservers };
    } catch {
      // leave nameservers empty if this provider can't supply them
    }
    // Last resort: the registrar API may report no nameservers when a domain is
    // on the registrar's *default* DNS (e.g. Dynadot returns [] for domains
    // using ns1/ns2.dyna-ns.net). The registry's RDAP record still lists the
    // actual delegation, so fall back to it for display.
    const rdap = await rdapNameservers(domainName);
    if (rdap.length > 0) return { ...domain, nameservers: rdap };
  }
  return domain;
}

/** Reads a domain's nameservers from its public RDAP record; [] on any failure. */
async function rdapNameservers(domainName: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://rdap.org/domain/${encodeURIComponent(domainName)}`,
      {
        headers: {
          accept: 'application/rdap+json',
          // rdap.org (Cloudflare) 403s requests without a browser-like UA.
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      nameservers?: { ldhName?: string }[];
    };
    return (data.nameservers ?? [])
      .map((ns) => ns.ldhName?.toLowerCase() ?? '')
      .filter(Boolean);
  } catch {
    return [];
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
