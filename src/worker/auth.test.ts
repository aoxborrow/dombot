import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../core/storage/doc-store';
import { configureStore, hydrateStores } from '../core/storage/namespace';
import {
  buildAuthConfig,
  checkPassword,
  createSession,
  isAuthenticated,
  loginLockRemaining,
  parseAuthMode,
  readCookie,
  recordLoginFailure,
  recordLoginSuccess,
  sameOrigin,
  verifySession,
} from './auth';
import {
  deriveEncryptionKey,
  deriveSessionKey,
  parseRootSecret,
  timingSafeEqualStrings,
} from './keys';

const ROOT = btoa(
  String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);

beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
});

describe('keys', () => {
  it('rejects a missing or short root secret', () => {
    expect(() => parseRootSecret(undefined)).toThrow(
      /DOMBOT_SECRET is not set/,
    );
    expect(() => parseRootSecret(btoa('short'))).toThrow(/at least 32/);
    expect(parseRootSecret(ROOT)).toHaveLength(32);
  });

  it('derives a stable 32-byte encryption key per root', async () => {
    const root = parseRootSecret(ROOT);
    const a = await deriveEncryptionKey(root);
    const b = await deriveEncryptionKey(root);
    expect(a).toHaveLength(32);
    expect(a).toEqual(b);
    const other = parseRootSecret(
      btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
    );
    expect(await deriveEncryptionKey(other)).not.toEqual(a);
  });

  it('compares strings in constant time by value', async () => {
    expect(await timingSafeEqualStrings('abc', 'abc')).toBe(true);
    expect(await timingSafeEqualStrings('abc', 'abd')).toBe(false);
    expect(await timingSafeEqualStrings('abc', 'abcd')).toBe(false);
  });
});

describe('sessions', () => {
  it('round-trips a signed session and rejects tampering', async () => {
    const key = await deriveSessionKey(parseRootSecret(ROOT), 'pw');
    const token = await createSession(key);
    expect(await verifySession(key, token)).toBe(true);
    expect(await verifySession(key, token.slice(0, -2) + 'zz')).toBe(false);
    expect(await verifySession(key, 'garbage')).toBe(false);
    expect(await verifySession(key, undefined)).toBe(false);
  });

  it('expires, and rotating the password invalidates it', async () => {
    const root = parseRootSecret(ROOT);
    const key = await deriveSessionKey(root, 'pw');
    const token = await createSession(key, 1_000);
    expect(await verifySession(key, token, 1_000 + 29 * 86_400_000)).toBe(true);
    expect(await verifySession(key, token, 1_000 + 31 * 86_400_000)).toBe(
      false,
    );
    const rotated = await deriveSessionKey(root, 'new-pw');
    expect(await verifySession(rotated, token)).toBe(false);
  });

  it('reads the cookie out of a header', () => {
    expect(
      readCookie('a=1; dombot_session=tok.sig; b=2', 'dombot_session'),
    ).toBe('tok.sig');
    expect(readCookie(undefined, 'x')).toBeUndefined();
  });
});

describe('auth config + gate', () => {
  it('parses modes and demands their prerequisites', async () => {
    expect(parseAuthMode(undefined)).toBe('password');
    expect(parseAuthMode('external')).toBe('external');
    expect(() => parseAuthMode('magic')).toThrow(/DOMBOT_AUTH must be/);
    const root = parseRootSecret(ROOT);
    await expect(
      buildAuthConfig({ DOMBOT_AUTH: 'password' }, root),
    ).rejects.toThrow(/DOMBOT_PASSWORD/);
    await expect(
      buildAuthConfig({ DOMBOT_AUTH: 'cloudflare-access' }, root),
    ).rejects.toThrow(/CF_ACCESS_TEAM_DOMAIN/);
    const ext = await buildAuthConfig({ DOMBOT_AUTH: 'external' }, root);
    expect(await isAuthenticated(ext, new Request('https://x/'))).toBe(true);
  });

  it('password mode: cookie gates the request', async () => {
    const cfg = await buildAuthConfig(
      { DOMBOT_AUTH: 'password', DOMBOT_PASSWORD: 'pw' },
      parseRootSecret(ROOT),
    );
    expect(await checkPassword(cfg, 'pw')).toBe(true);
    expect(await checkPassword(cfg, 'PW')).toBe(false);
    expect(await isAuthenticated(cfg, new Request('https://x/'))).toBe(false);
    const token = await createSession(cfg.sessionKey!);
    const req = new Request('https://x/', {
      headers: { cookie: `dombot_session=${token}` },
    });
    expect(await isAuthenticated(cfg, req)).toBe(true);
  });

  it('cloudflare-access mode: no header → not authenticated', async () => {
    const cfg = await buildAuthConfig(
      {
        DOMBOT_AUTH: 'cloudflare-access',
        CF_ACCESS_TEAM_DOMAIN: 'https://t.cloudflareaccess.com/',
        CF_ACCESS_AUD: 'aud',
      },
      parseRootSecret(ROOT),
    );
    expect(cfg.accessTeamDomain).toBe('https://t.cloudflareaccess.com');
    expect(await isAuthenticated(cfg, new Request('https://x/'))).toBe(false);
  });

  it('sameOrigin requires a matching Origin or Referer', () => {
    const mk = (h: Record<string, string>) =>
      new Request('https://app.example/api/x', { headers: h });
    expect(sameOrigin(mk({ origin: 'https://app.example' }))).toBe(true);
    expect(sameOrigin(mk({ referer: 'https://app.example/#/settings' }))).toBe(
      true,
    );
    expect(sameOrigin(mk({ origin: 'https://evil.example' }))).toBe(false);
    expect(sameOrigin(mk({}))).toBe(false);
  });
});

describe('login backoff', () => {
  it('locks after three failures with growing waits, clears on success', () => {
    const t0 = 1_000_000;
    expect(loginLockRemaining(t0)).toBe(0);
    recordLoginFailure(t0);
    recordLoginFailure(t0);
    recordLoginFailure(t0);
    expect(loginLockRemaining(t0)).toBe(0); // three free attempts
    recordLoginFailure(t0);
    expect(loginLockRemaining(t0)).toBe(1_000);
    recordLoginFailure(t0);
    expect(loginLockRemaining(t0)).toBe(2_000);
    recordLoginFailure(t0);
    expect(loginLockRemaining(t0)).toBe(4_000);
    expect(loginLockRemaining(t0 + 4_000)).toBe(0);
    recordLoginSuccess();
    recordLoginFailure(t0);
    expect(loginLockRemaining(t0)).toBe(0);
  });
});
