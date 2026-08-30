import {
  RegistrarClient,
  createRegistrar,
  registrars,
  type RegistrarCredentials,
  type RegistrarName,
} from '@aoxborrow/registrar-client';

// Cache one client per registrar so we don't rebuild it on every call.
// TODO: source credentials from OS-encrypted storage (Electron safeStorage)
// instead of process.env once we move past the .env dev setup.
const clients = new Map<RegistrarName, RegistrarClient>();

/** All built-in registrar ids, e.g. "dynadot", "godaddy". */
export const registrarNames = Object.keys(registrars) as [
  RegistrarName,
  ...RegistrarName[],
];

/**
 * Returns a cached client for `name`, building it from env credentials on first
 * use. The shared lower-level core: MCP tools and UI IPC handlers both call in.
 */
export function getRegistrarClient(name: RegistrarName): RegistrarClient {
  let client = clients.get(name);
  if (!client) {
    client = new RegistrarClient(
      createRegistrar(name, credentialsFromEnv(name)),
    );
    clients.set(name, client);
  }
  return client;
}

/** Registrars whose required credentials are all present in the environment. */
export function getConfiguredRegistrars(): RegistrarName[] {
  return registrarNames.filter((name) =>
    registrars[name].configFields.every(
      (field) =>
        !field.required || Boolean(process.env[envKey(name, field.name)]),
    ),
  );
}

/** Clients for every configured registrar — the sources for a portfolio view. */
export function getPortfolioSources(): RegistrarClient[] {
  return getConfiguredRegistrars().map(getRegistrarClient);
}

// Maps a provider's configField (camelCase) to its env var, per the .env
// convention <PROVIDER>_<FIELD_UPPER_SNAKE>, e.g. apiKey -> DYNADOT_API_KEY.
function envKey(name: RegistrarName, field: string): string {
  const snake = field.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  return `${name.toUpperCase()}_${snake}`;
}

function credentialsFromEnv(name: RegistrarName): RegistrarCredentials {
  const creds: RegistrarCredentials = {};
  const missing: string[] = [];
  for (const field of registrars[name].configFields) {
    const value = process.env[envKey(name, field.name)];
    if (value) creds[field.name] = value;
    else if (field.required) missing.push(envKey(name, field.name));
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing credentials for "${name}": ${missing.join(', ')} (set them in .env).`,
    );
  }
  return creds;
}
