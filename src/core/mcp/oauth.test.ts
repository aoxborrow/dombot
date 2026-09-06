import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { onCoreEvent } from '../events';
import {
  authenticateClient,
  createPendingApproval,
  exchangeAuthorizationCode,
  getApprovalStatus,
  getClient,
  hasPairedClients,
  hashToken,
  legacyTokenEntry,
  listMcpClients,
  listPendingApprovals,
  MCP_NAMESPACE,
  pruneStale,
  registerClient,
  resolvePending,
  revokeMcpClient,
  revokeToken,
  verifyAccessToken,
  verifyPkce,
} from './oauth';

let store: MemoryDocStore;
beforeEach(async () => {
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
});

/** base64url(sha256(verifier)) — what a client sends as code_challenge. */
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

const REDIRECT = 'http://localhost:9999/callback';

function publicClient(name = 'Test Client') {
  return registerClient({
    client_name: name,
    redirect_uris: [REDIRECT],
    token_endpoint_auth_method: 'none',
  });
}

describe('registration', () => {
  it('issues an id (and no secret) to a public client', () => {
    const c = publicClient();
    expect(c.client_id).toMatch(/[0-9a-f-]{36}/);
    expect(c.client_secret).toBeUndefined();
    expect(getClient(c.client_id)?.client_name).toBe('Test Client');
    expect(authenticateClient(c.client_id, undefined)?.client_id).toBe(
      c.client_id,
    );
  });

  it('issues a secret to a confidential client and demands it back', () => {
    const c = registerClient({ redirect_uris: [REDIRECT] });
    expect(c.client_secret).toMatch(/^[0-9a-f]{64}$/);
    expect(authenticateClient(c.client_id, undefined)).toBeNull();
    expect(authenticateClient(c.client_id, 'nope')).toBeNull();
    expect(authenticateClient(c.client_id, c.client_secret)).not.toBeNull();
    expect(authenticateClient('missing', undefined)).toBeNull();
  });

  it('forgets registrations that never paired, keeps paired ones', async () => {
    const stale = publicClient('stale');
    const kept = publicClient('kept');
    // Pair `kept` so it survives.
    const p = createPendingApproval(kept, {
      scopes: [],
      redirectUri: REDIRECT,
      codeChallenge: await challengeFor('v'),
    });
    const code = new URL(resolvePending(p.id, true)!).searchParams.get('code')!;
    await exchangeAuthorizationCode(kept, code, 'v');
    pruneStale(Date.now() + 2 * 60 * 60 * 1000);
    expect(getClient(stale.client_id)).toBeUndefined();
    expect(getClient(kept.client_id)).toBeDefined();
  });
});

describe('approval → code → token', () => {
  it('walks the whole flow and persists the pairing by token hash', async () => {
    const changed = vi.fn();
    onCoreEvent('approvalsChanged', changed);
    const client = publicClient();
    const verifier = 'a-long-enough-verifier-string-for-pkce';
    const p = createPendingApproval(client, {
      state: 'xyz',
      scopes: ['portfolio'],
      redirectUri: REDIRECT,
      codeChallenge: await challengeFor(verifier),
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(p.displayCode).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(listPendingApprovals()).toEqual([
      expect.objectContaining({ id: p.id, clientName: 'Test Client' }),
    ]);
    expect(getApprovalStatus(p.id)).toEqual({
      status: 'pending',
      redirect: undefined,
    });

    const redirect = resolvePending(p.id, true)!;
    const url = new URL(redirect);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe('xyz');
    const code = url.searchParams.get('code')!;
    expect(code).toMatch(/^[0-9a-f]{48}$/);
    expect(getApprovalStatus(p.id)).toEqual({ status: 'approved', redirect });
    expect(listPendingApprovals()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(2);
    // Deciding twice is idempotent.
    expect(resolvePending(p.id, false)).toBe(redirect);

    // Wrong verifier / wrong client / reuse all fail.
    await expect(
      exchangeAuthorizationCode(client, code, 'wrong'),
    ).rejects.toThrow(/code_verifier/);
    const other = publicClient('other');
    await expect(
      exchangeAuthorizationCode(other, code, verifier),
    ).rejects.toThrow(/Invalid or expired/);
    await expect(
      exchangeAuthorizationCode(client, code, verifier, 'http://x/'),
    ).rejects.toThrow(/redirect_uri/);

    const tokens = await exchangeAuthorizationCode(client, code, verifier);
    expect(tokens.token_type).toBe('bearer');
    expect(tokens.scope).toBe('portfolio');
    await expect(
      exchangeAuthorizationCode(client, code, verifier),
    ).rejects.toThrow(/Invalid or expired/);

    const info = await verifyAccessToken(tokens.access_token);
    expect(info?.clientId).toBe(client.client_id);
    expect(info?.extra?.clientName).toBe('Test Client');
    expect(await verifyAccessToken('nope')).toBeNull();

    // The store holds the hash, never the token.
    await flushWrites();
    const raw = await store.list(MCP_NAMESPACE);
    expect(Object.keys(raw)).toContain(
      'token:' + (await hashToken(tokens.access_token)),
    );
    expect(JSON.stringify(raw)).not.toContain(tokens.access_token);

    expect(hasPairedClients()).toBe(true);
    expect(listMcpClients()).toEqual([
      expect.objectContaining({
        clientId: client.client_id,
        clientName: 'Test Client',
      }),
    ]);

    // Revoke by client un-pairs; verify fails after.
    await revokeMcpClient(client.client_id);
    expect(await verifyAccessToken(tokens.access_token)).toBeNull();
    expect(listMcpClients()).toEqual([]);
    expect(hasPairedClients()).toBe(false);
  });

  it('denial redirects with access_denied and mints no code', async () => {
    const client = publicClient();
    const p = createPendingApproval(client, {
      scopes: [],
      redirectUri: REDIRECT,
      codeChallenge: 'c',
    });
    const url = new URL(resolvePending(p.id, false)!);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('code')).toBeNull();
    expect(getApprovalStatus(p.id).status).toBe('denied');
  });

  it('expires codes and pending approvals', async () => {
    const client = publicClient();
    const p = createPendingApproval(client, {
      scopes: [],
      redirectUri: REDIRECT,
      codeChallenge: await challengeFor('v'),
    });
    const code = new URL(resolvePending(p.id, true)!).searchParams.get('code')!;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 6 * 60 * 1000);
      await expect(
        exchangeAuthorizationCode(client, code, 'v'),
      ).rejects.toThrow(/expired/);
      vi.setSystemTime(Date.now() + 5 * 60 * 1000);
      expect(getApprovalStatus(p.id).status).toBe('unknown');
    } finally {
      vi.useRealTimers();
    }
    expect(getApprovalStatus('nope').status).toBe('unknown');
  });

  it('revokeToken only honors the issuing client', async () => {
    const client = publicClient();
    const p = createPendingApproval(client, {
      scopes: [],
      redirectUri: REDIRECT,
      codeChallenge: await challengeFor('v'),
    });
    const code = new URL(resolvePending(p.id, true)!).searchParams.get('code')!;
    const { access_token } = await exchangeAuthorizationCode(client, code, 'v');
    await revokeToken(publicClient('other'), access_token);
    expect(await verifyAccessToken(access_token)).not.toBeNull();
    await revokeToken(client, access_token);
    expect(await verifyAccessToken(access_token)).toBeNull();
  });
});

describe('helpers', () => {
  it('verifies PKCE S256', async () => {
    expect(await verifyPkce('abc', await challengeFor('abc'))).toBe(true);
    expect(await verifyPkce('abd', await challengeFor('abc'))).toBe(false);
  });

  it('builds a legacy token entry the store recognizes', async () => {
    const { key, value } = await legacyTokenEntry({
      token: 'legacy-token',
      clientId: 'c1',
      scopes: ['portfolio'],
      expiresAt: 4_000_000_000,
      extra: { clientName: 'Old Client', pairedAt: 123 },
    });
    expect(key).toBe('token:' + (await hashToken('legacy-token')));
    expect(value).toEqual({
      clientId: 'c1',
      clientName: 'Old Client',
      scopes: ['portfolio'],
      pairedAt: 123,
      expiresAt: 4_000_000_000,
    });
    await store.put(MCP_NAMESPACE, key, value);
    await hydrateStores();
    expect((await verifyAccessToken('legacy-token'))?.clientId).toBe('c1');
    expect(listMcpClients()[0]?.clientName).toBe('Old Client');
  });
});
