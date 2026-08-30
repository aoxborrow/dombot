import {
  RegistrarClient,
  createRegistrar,
  registrars,
  type RegistrarCredentials,
  type RegistrarName,
} from '@aoxborrow/registrar-client';
import { getStoredCredentials, setStoredCredentials } from './credentials';
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

// Resolve a field: user-saved value first, then the .env fallback (dev).
function resolveField(name: RegistrarName, field: string): string | undefined {
  return getStoredCredentials(name)[field] ?? process.env[envKey(name, field)];
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
