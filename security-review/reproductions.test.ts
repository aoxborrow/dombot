// Security regression checks: passing means the original reproductions are blocked.
// Uses synthetic credentials and mocked network requests only.
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryDocStore } from '../src/core/storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../src/core/storage/namespace';
import {
  saveRegistrarCredentials,
  syncRegistrar,
  getMergedPortfolio,
  resetRegistrarClients,
} from '../src/core/services/registrars';
import {
  createPendingApproval,
  registerClient,
  resolvePending,
  exchangeAuthorizationCode,
} from '../src/core/mcp/oauth';
import { domainsToCsv } from '../src/renderer/lib/csv';
import type { Domain } from '../src/shared/ipc';
import { openBundle } from '../src/shared/bundle-seal';

afterEach(async () => {
  await flushWrites();
  vi.unstubAllGlobals();
  resetRegistrarClients();
});

it('blocks registrar secret disclosure through cache and MCP errors', async () => {
  const disk = new MemoryDocStore();
  configureStore(disk);
  await hydrateStores();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('denied', { status: 403 })),
  );
  await saveRegistrarCredentials('namesilo', {
    apiKey: 'AUDIT_FAKE_SECRET_123',
  });
  await syncRegistrar('namesilo');
  await flushWrites();
  expect(JSON.stringify(await disk.list('cache-portfolio'))).not.toContain(
    'AUDIT_FAKE_SECRET_123',
  );
  expect(JSON.stringify(getMergedPortfolio().errors)).not.toContain(
    'AUDIT_FAKE_SECRET_123',
  );
});

it('blocks parallel redemption of a one-time OAuth code', async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  const redirect = 'http://localhost:9876/callback';
  const client = registerClient({
    redirect_uris: [redirect],
    token_endpoint_auth_method: 'none',
  });
  const verifier = 'audit-verifier-that-is-long-enough-for-pkce-123456';
  const challenge = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  ).toString('base64url');
  const pending = createPendingApproval(client, {
    redirectUri: redirect,
    codeChallenge: challenge,
    scopes: ['portfolio'],
  });
  const code = new URL(resolvePending(pending.id, true)!).searchParams.get(
    'code',
  )!;
  const tokens = await Promise.allSettled([
    exchangeAuthorizationCode(client, code, verifier, redirect),
    exchangeAuthorizationCode(client, code, verifier, redirect),
  ]);
  expect(tokens.filter((t) => t.status === 'fulfilled')).toHaveLength(1);
});

it('neutralizes formulas in exported account labels', () => {
  const domain = {
    domainName: 'example.com',
    registrar: 'namesilo',
    accountLabel: '=1+1',
    status: 'active',
    nameservers: [],
    createdDate: null,
    expirationDate: null,
    renewalDate: null,
    syncedAt: null,
  } as unknown as Domain;
  expect(
    domainsToCsv([domain], {}, [], {}).split('\r\n')[1].split(',')[1],
  ).toBe("'=1+1");
});

it('rejects attacker-chosen KDF work before invoking crypto', async () => {
  const derive = vi
    .spyOn(crypto.subtle, 'deriveKey')
    .mockRejectedValueOnce(new Error('audit intercepted work'));
  try {
    await expect(
      openBundle(
        JSON.stringify({
          encrypted: {
            kdf: 'PBKDF2-SHA256',
            alg: 'AES-256-GCM',
            salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
            iterations: 2147483647,
            iv: '',
            ct: '',
          },
        }),
        'fake-passphrase',
      ),
    ).rejects.toThrow('Unsupported key derivation cost');
    expect(derive).not.toHaveBeenCalled();
  } finally {
    derive.mockRestore();
  }
});
