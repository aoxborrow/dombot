import { RegistrarClient, createRegistrar } from '@aoxborrow/registrar-client';

// Cache one client per registrar so we don't rebuild it on every IPC call.
// TODO: source credentials from OS-encrypted storage (Electron safeStorage)
// instead of process.env once we move past the .env dev setup.
const clients = new Map<string, RegistrarClient>();

/** Returns a cached Dynadot client, building it from env creds on first use. */
export function getDynadotClient(): RegistrarClient {
  return getOrBuild('dynadot', () => {
    const apiKey = process.env.DYNADOT_API_KEY;
    const apiSecret = process.env.DYNADOT_API_SECRET;
    if (!apiKey || !apiSecret) {
      throw new Error(
        'Missing DYNADOT_API_KEY / DYNADOT_API_SECRET in the environment (.env).',
      );
    }
    return new RegistrarClient(
      createRegistrar('dynadot', { apiKey, apiSecret }),
    );
  });
}

function getOrBuild(id: string, build: () => RegistrarClient): RegistrarClient {
  let client = clients.get(id);
  if (!client) {
    client = build();
    clients.set(id, client);
  }
  return client;
}
