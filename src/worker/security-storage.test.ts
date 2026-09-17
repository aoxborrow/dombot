import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { D1DocStore } from './storage/d1-doc-store';
import { EncryptedDocStore, aesGcmCipher } from '../core/storage/encrypted';
import {
  clearLoginAttempts,
  LOGIN_ATTEMPTS,
  LOGIN_WINDOW_MS,
  loginSource,
  reserveLoginAttempt,
} from './login-rate-limit';
import { deriveSessionKey } from './keys';
vi.mock('cloudflare:sockets', () => ({ connect: vi.fn() }));
import worker from './index';

let sqlite: DatabaseSync;
let db: D1Database;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0001_docs.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0002_login_attempts.sql', 'utf8'));
  // Execute production SQL against SQLite; only the D1 transport is simulated.
  db = {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql);
      const bind = (...values: (string | number)[]) => ({
        async first() {
          return stmt.get(...values) ?? null;
        },
        async run() {
          return stmt.run(...values);
        },
        async all() {
          return { results: stmt.all(...values) };
        },
      });
      return { ...bind(), bind };
    },
  } as unknown as D1Database;
});

it('serves a valid owner login after another source exhausts its attempts', async () => {
  const env = {
    DB: db,
    DOMBOT_AUTH: 'password',
    DOMBOT_SECRET: btoa('a'.repeat(32)),
    DOMBOT_PASSWORD: 'a-long-synthetic-password',
    ASSETS: { fetch: async () => new Response('unused') },
  } as unknown as Env;
  const login = (ip: string, password: string) =>
    worker.fetch(
      new Request('https://app.example/auth/login', {
        method: 'POST',
        headers: {
          origin: 'https://app.example',
          'content-type': 'application/json',
          'cf-connecting-ip': ip,
        },
        body: JSON.stringify({ password }),
      }),
      env,
    );
  for (let i = 0; i < LOGIN_ATTEMPTS; i++)
    expect((await login('192.0.2.1', 'wrong')).status).toBe(401);
  const limited = await login('192.0.2.1', 'wrong');
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  const owner = await login('192.0.2.2', env.DOMBOT_PASSWORD!);
  expect(owner.status).toBe(200);
  expect(owner.headers.get('set-cookie')).toContain('HttpOnly');
  const status = await worker.fetch(
    new Request('https://app.example/auth/status', {
      headers: { cookie: owner.headers.get('set-cookie')!.split(';')[0] },
    }),
    env,
  );
  expect(await status.json()).toMatchObject({ authenticated: true });
});
afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

it('permits exactly one atomic encrypted grant consume across independent adapters', async () => {
  const cipher = await aesGcmCipher(new Uint8Array(32).fill(1));
  const a = new EncryptedDocStore(new D1DocStore(db), cipher);
  const b = new EncryptedDocStore(new D1DocStore(db), cipher);
  await a.put('mcp', 'code:test', { clientId: 'client' });
  const results = await Promise.all([
    a.take('mcp', 'code:test'),
    b.take('mcp', 'code:test'),
  ]);
  expect(results.filter(Boolean)).toEqual([{ clientId: 'client' }]);
});

it('limits a source atomically, without locking out other sources or extending the window', async () => {
  const now = 1000;
  const waits = await Promise.all(
    Array.from({ length: 25 }, () => reserveLoginAttempt(db, 'attacker', now)),
  );
  expect(waits.filter((n) => n === 0)).toHaveLength(LOGIN_ATTEMPTS);
  expect(await reserveLoginAttempt(db, 'owner', now)).toBe(0);
  expect(await reserveLoginAttempt(db, 'attacker', now + 5000)).toBe(
    LOGIN_WINDOW_MS - 5000,
  );
  expect(await reserveLoginAttempt(db, 'attacker', now + LOGIN_WINDOW_MS)).toBe(
    0,
  );
  await clearLoginAttempts(db, 'owner');
  expect(await reserveLoginAttempt(db, 'owner', now + LOGIN_WINDOW_MS)).toBe(0);
});

it('uses the Cloudflare source header and fails closed without it outside local development', async () => {
  const key = await deriveSessionKey(
    new Uint8Array(32).fill(1),
    'test-password',
  );
  const a = new Request('https://app.example/auth/login', {
    headers: { 'cf-connecting-ip': '192.0.2.1' },
  });
  const b = new Request(a, {
    headers: {
      'cf-connecting-ip': '192.0.2.1',
      'x-forwarded-for': '192.0.2.99',
    },
  });
  expect(await loginSource(a, key)).toBe(await loginSource(b, key));
  expect(await loginSource(a, key)).not.toContain('192.0.2.1');
  expect(
    await loginSource(new Request('https://app.example/'), key),
  ).toBeNull();
  expect(
    await loginSource(new Request('http://localhost/'), key),
  ).not.toBeNull();
});
