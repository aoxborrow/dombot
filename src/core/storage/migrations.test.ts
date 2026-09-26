import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocStore } from './doc-store';
import { EncryptedDocStore, aesGcmCipher, type Cipher } from './encrypted';
import { SCHEMA_VERSION, runMigrations } from './migrations';
import { HIDDEN_FOLDER_ID } from '../../shared/ipc';

let raw: MemoryDocStore;
let cipher: Cipher;
beforeEach(async () => {
  raw = new MemoryDocStore();
  cipher = await aesGcmCipher(new Uint8Array(32).fill(7));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Every stored namespace with entries (listing one creates it empty). */
async function contents(): Promise<Record<string, Record<string, unknown>>> {
  const all = await raw.loadAll();
  return Object.fromEntries(
    Object.entries(all).filter(([, e]) => Object.keys(e).length > 0),
  );
}

/** The desktop layout: only credentials and proxies are sealed. */
const sealing = (names: string[], c: Cipher = cipher) =>
  new EncryptedDocStore(raw, c, new Set(names));

/** A pre-v1 desktop store, written with the old names. */
async function seedLegacy(): Promise<void> {
  const old = sealing(['credentials', 'proxies']);
  await old.put('credentials', 'dynadot', { apiKey: 'k' });
  await old.put('proxies', 'default', { id: 'default', url: 'http://p' });
  await old.put('cache-portfolio', 'dynadot', { fetchedAt: 1, data: {} });
  await old.put('cache-detail', 'dynadot:a.com', { fetchedAt: 1, data: {} });
  await old.put('tld-rates', 'godaddy:com', 8.99);
  await old.put('registrar-state', 'disabled', ['gandi']);
  await old.put('pricing-overrides', 'dynadot:Münich.de', 40);
  await old.put('pricing-overrides', 'acct-2:xn--mnich-kva.de', 99);
  await old.put('folders', 'folders', [{ id: 'f1', name: 'Keep' }]);
  await old.put('folders', 'assignments', {
    'dynadot:a.com': 'f1',
    'acct-2:B.com': '__hidden__',
  });
  await old.put('settings', 'mcpEnabled', true);
}

describe('runMigrations', () => {
  it('stamps a fresh store and moves nothing', async () => {
    const store = sealing(['registrar-credentials']);
    await runMigrations(raw, store);
    expect(await store.get('meta', 'schemaVersion')).toBe(SCHEMA_VERSION);
    expect(await contents()).toEqual({ meta: { schemaVersion: 2 } });
  });

  it('renames namespaces, re-keys folders and prices by name, and keeps secrets sealed', async () => {
    await seedLegacy();
    const store = sealing(['registrar-credentials', 'registrar-proxies']);
    await runMigrations(raw, store);

    // Sealed values moved as ciphertext and still open under the new name.
    expect(await raw.get('registrar-credentials', 'dynadot')).toMatchObject({
      __sealed: 1,
    });
    expect(await store.get('registrar-credentials', 'dynadot')).toEqual({
      apiKey: 'k',
    });
    expect(await store.get('registrar-proxies', 'default')).toMatchObject({
      url: 'http://p',
    });
    expect(Object.keys(await store.list('registrar-domains'))).toEqual([
      'dynadot',
    ]);
    expect(Object.keys(await store.list('registrar-details'))).toEqual([
      'dynadot:a.com',
    ]);
    expect(await store.list('registrar-tld-rates')).toEqual({
      'godaddy:com': 8.99,
    });
    expect(await store.get('registrars', 'disabled')).toEqual(['gandi']);
    // First account wins a name both accounts priced.
    expect(await store.list('domain-prices')).toEqual({
      'xn--mnich-kva.de': 40,
    });
    expect(await store.list('folders')).toEqual({
      folders: [{ id: 'f1', name: 'Keep' }],
    });
    expect(await store.list('domain-folders')).toEqual({
      'a.com': 'f1',
      'b.com': HIDDEN_FOLDER_ID,
    });
    // Untouched namespaces stay put; old ones are gone.
    expect(await store.get('settings', 'mcpEnabled')).toBe(true);
    for (const old of [
      'credentials',
      'proxies',
      'cache-portfolio',
      'cache-detail',
      'tld-rates',
      'registrar-state',
      'pricing-overrides',
    ]) {
      expect(await raw.list(old)).toEqual({});
    }
    expect(await store.get('meta', 'schemaVersion')).toBe(2);

    // A second run is a no-op.
    const before = await contents();
    await runMigrations(raw, store);
    expect(await contents()).toEqual(before);
  });

  it('moves credentials it cannot decrypt (a locked keyring) instead of dropping them', async () => {
    await seedLegacy();
    const locked: Cipher = {
      alg: cipher.alg,
      seal: cipher.seal,
      open: () => Promise.reject(new Error('keyring locked')),
    };
    await runMigrations(
      raw,
      sealing(['registrar-credentials', 'registrar-proxies'], locked),
    );
    // Once the keyring is back, the key opens under its new name.
    expect(
      await sealing(['registrar-credentials']).get(
        'registrar-credentials',
        'dynadot',
      ),
    ).toEqual({ apiKey: 'k' });
  });

  it('stops without changes when the folder map is stored but unreadable', async () => {
    // The web layout seals every namespace; this one under a different key.
    const other = await aesGcmCipher(new Uint8Array(32).fill(9));
    await new EncryptedDocStore(raw, other).put('folders', 'assignments', {
      'dynadot:a.com': 'f1',
    });
    await raw.put('cache-portfolio', 'dynadot', { fetchedAt: 1 });
    const before = await contents();
    await expect(
      runMigrations(raw, new EncryptedDocStore(raw, cipher)),
    ).rejects.toThrow(/can't read folder assignments/);
    expect(await contents()).toEqual(before);
  });

  it('v2 moves Archive folder assignments to Hidden on a v1 store', async () => {
    const store = sealing(['registrar-credentials']);
    await store.put('meta', 'schemaVersion', 1);
    await store.putMany('domain-folders', [
      ['a.com', '__archive__'],
      ['b.com', 'f1'],
    ]);
    await runMigrations(raw, store);
    expect(await store.list('domain-folders')).toEqual({
      'a.com': HIDDEN_FOLDER_ID,
      'b.com': 'f1',
    });
    expect(await store.get('meta', 'schemaVersion')).toBe(2);
  });
});
