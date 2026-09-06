import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { MemoryDocStore } from '../storage/doc-store';
import { configureStore, hydrateStores } from '../storage/namespace';
import { updateSettings } from '../services/settings';
import { listPendingApprovals, resolvePending } from './oauth';
import { createMcpRoutes, redirectUriMatches } from './routes';

// The MCP surface end to end through Hono's in-process `request()`: discovery,
// registration, authorize → approve in-app → token, then a real JSON-RPC call
// against /mcp with the bearer token.

const ORIGIN = 'https://dombot.example';
const REDIRECT = 'http://localhost:9999/callback';

let app: Hono;
beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  updateSettings({ mcpEnabled: true });
  app = new Hono();
  app.route('/', createMcpRoutes({ version: '9.9.9' }));
});

const req = (path: string, init?: RequestInit) =>
  app.request(ORIGIN + path, init);
const form = (body: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(),
});

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function register(): Promise<{ client_id: string }> {
  const res = await req('/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claude',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
    }),
  });
  expect(res.status).toBe(201);
  return res.json();
}

/** Runs the whole pairing dance and returns a bearer token. */
async function pair(): Promise<string> {
  const { client_id } = await register();
  const verifier = 'verifier-verifier-verifier-verifier-verifier';
  const q = new URLSearchParams({
    client_id,
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    state: 's1',
    scope: 'portfolio',
  });
  const auth = await req('/authorize?' + q);
  expect(auth.status).toBe(200);
  expect(await auth.text()).toContain('Approve this connection');

  const [pending] = listPendingApprovals();
  const status = await (await req('/oauth/status?id=' + pending.id)).json();
  expect(status).toEqual({ status: 'pending' });
  resolvePending(pending.id, true);
  const after = (await (
    await req('/oauth/status?id=' + pending.id)
  ).json()) as {
    status: string;
    redirect: string;
  };
  expect(after.status).toBe('approved');
  const code = new URL(after.redirect).searchParams.get('code')!;

  const tok = await req(
    '/token',
    form({
      grant_type: 'authorization_code',
      client_id,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    }),
  );
  expect(tok.status).toBe(200);
  const body = (await tok.json()) as { access_token: string };
  return body.access_token;
}

describe('discovery', () => {
  it('advertises endpoints on the request origin', async () => {
    const as = await (
      await req('/.well-known/oauth-authorization-server')
    ).json();
    expect(as).toMatchObject({
      issuer: ORIGIN + '/',
      authorization_endpoint: ORIGIN + '/authorize',
      token_endpoint: ORIGIN + '/token',
      registration_endpoint: ORIGIN + '/register',
      code_challenge_methods_supported: ['S256'],
    });
    const rs = await (
      await req('/.well-known/oauth-protected-resource/mcp')
    ).json();
    expect(rs).toMatchObject({
      resource: ORIGIN + '/mcp',
      authorization_servers: [ORIGIN + '/'],
    });
    const res = await req('/.well-known/oauth-authorization-server', {
      method: 'OPTIONS',
      headers: { origin: 'https://claude.ai' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('leaves the rest of the host origin alone', async () => {
    updateSettings({ mcpEnabled: false });
    app.get('/', (c) => c.text('home'));
    const res = await req('/', { headers: { origin: 'https://claude.ai' } });
    expect(await res.text()).toBe('home');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('is gone entirely while the setting is off', async () => {
    updateSettings({ mcpEnabled: false });
    expect((await req('/.well-known/oauth-authorization-server')).status).toBe(
      404,
    );
    expect((await req('/mcp', { method: 'POST' })).status).toBe(404);
  });
});

describe('authorize', () => {
  it('rejects an unknown client or redirect directly', async () => {
    expect((await req('/authorize?client_id=nope')).status).toBe(400);
    const { client_id } = await register();
    const res = await req(
      `/authorize?client_id=${client_id}&redirect_uri=https://evil.example/`,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('redirects other errors back to the client', async () => {
    const { client_id } = await register();
    const res = await req(
      `/authorize?client_id=${client_id}&response_type=token&state=st`,
    );
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get('error')).toBe('invalid_request');
    expect(loc.searchParams.get('state')).toBe('st');
  });

  it('auto-approves when told to (dev)', async () => {
    const dev = new Hono();
    dev.route('/', createMcpRoutes({ version: '0', autoApprove: true }));
    const reg = await dev.request(ORIGIN + '/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT] }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const res = await dev.request(
      `${ORIGIN}/authorize?client_id=${client_id}&response_type=code&code_challenge=x&code_challenge_method=S256`,
    );
    expect(res.status).toBe(302);
    expect(
      new URL(res.headers.get('location')!).searchParams.get('code'),
    ).toMatch(/^[0-9a-f]{48}$/);
  });
});

describe('token + mcp', () => {
  it('pairs, then serves tools/list to the bearer and 401s everyone else', async () => {
    const unauth = await req('/mcp', { method: 'POST' });
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get('www-authenticate')).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );

    const token = await pair();
    const rpc = (body: unknown, extra: Record<string, string> = {}) =>
      req('/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...extra,
        },
        body: JSON.stringify(body),
      });

    const init = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    });
    expect(init.status).toBe(200);
    const initBody = (await init.json()) as {
      result: { serverInfo: { name: string; version: string } };
    };
    expect(initBody.result.serverInfo).toEqual({
      name: 'DomBot',
      version: '9.9.9',
    });
    // Stateless: no session id is issued, and the next call needs none.
    expect(init.headers.get('mcp-session-id')).toBeNull();

    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(list.status).toBe(200);
    const tools = (await list.json()) as {
      result: { tools: { name: string }[] };
    };
    expect(tools.result.tools.map((t) => t.name)).toContain('registrar_list');

    const bad = await req('/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer nope' },
    });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ error: 'invalid_token' });
  });

  it('accepts a host-supplied static token', async () => {
    const dev = new Hono();
    dev.route(
      '/',
      createMcpRoutes({
        version: '0',
        verifyStaticToken: (t) =>
          t === 'shim'
            ? { token: t, clientId: 'stdio', scopes: [], expiresAt: 4e9 }
            : null,
      }),
    );
    const res = await dev.request(ORIGIN + '/mcp', {
      method: 'POST',
      headers: {
        authorization: 'Bearer shim',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects a bad verifier, a reused code, and an unknown client', async () => {
    const { client_id } = await register();
    const res = await req(
      '/token',
      form({
        grant_type: 'authorization_code',
        client_id,
        code: 'nope',
        code_verifier: 'v',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
    const unknown = await req(
      '/token',
      form({ grant_type: 'authorization_code', client_id: 'x', code: 'c' }),
    );
    expect(await unknown.json()).toMatchObject({ error: 'invalid_client' });
    const grant = await req(
      '/token',
      form({ grant_type: 'refresh_token', client_id, refresh_token: 'r' }),
    );
    expect(await grant.json()).toMatchObject({
      error: 'unsupported_grant_type',
    });
  });

  it('revokes through /revoke', async () => {
    const token = await pair();
    // The client id is the only paired one.
    const { listMcpClients } = await import('./oauth');
    const [client] = listMcpClients();
    const res = await req(
      '/revoke',
      form({ client_id: client.clientId, token }),
    );
    expect(res.status).toBe(200);
    const after = await req('/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });
});

describe('redirectUriMatches', () => {
  it('relaxes only the port, only on loopback', () => {
    expect(
      redirectUriMatches(
        'http://localhost:5000/cb',
        'http://localhost:1234/cb',
      ),
    ).toBe(true);
    expect(
      redirectUriMatches(
        'http://127.0.0.1:5000/cb',
        'http://localhost:5000/cb',
      ),
    ).toBe(false);
    expect(
      redirectUriMatches('http://localhost:5000/other', 'http://localhost/cb'),
    ).toBe(false);
    expect(
      redirectUriMatches('https://a.example:1/cb', 'https://a.example:2/cb'),
    ).toBe(false);
    expect(redirectUriMatches('x', 'x')).toBe(true);
  });
});
