import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocStore } from './doc-store';
import { configureStore, flushWrites, hydrateStores } from './namespace';
import {
  BUNDLE_FORMAT,
  BundleError,
  buildBundle,
  exportBundle,
  importBundle,
  parseBundle,
} from './bundle';
import {
  getSettings,
  onSettingsChanged,
  updateSettings,
} from '../services/settings';
import { createFolder, getFolders } from '../services/folders';
import { setStoredCredentials } from '../services/credentials';
import { getRegistrarClient } from '../services/registrars';
import { sealBundle } from '../../shared/bundle-seal';
import { HIDDEN_FOLDER_ID } from '../../shared/ipc';
import { bumpRevision, getRevisions } from '../revision';
import { onCoreEvent } from '../events';

const APP = { version: '9.9.9', platform: 'test' };

let store: MemoryDocStore;
beforeEach(async () => {
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
});

async function seed() {
  await setStoredCredentials('godaddy', { apiToken: 'k' });
  createFolder({ name: 'Keepers', color: 'green', description: '' });
  updateSettings({ mcpEnabled: true, autoSyncIntervalMinutes: 60 });
  bumpRevision('portfolio');
  await flushWrites();
}

describe('buildBundle', () => {
  it('captures every namespace except local ones (meta)', async () => {
    await seed();
    const b = buildBundle(APP);
    expect(b.format).toBe(BUNDLE_FORMAT);
    expect(b.app).toEqual(APP);
    expect(Object.keys(b.namespaces).sort()).toEqual(
      expect.arrayContaining(['registrar-credentials', 'folders', 'settings']),
    );
    expect(b.namespaces.meta).toBeUndefined();
    expect(b.namespaces.auth).toBeUndefined();
    expect(b.version).toBe(5);
    expect(b.namespaces['registrar-credentials'].godaddy).toEqual({
      apiToken: 'k',
    });
  });
});

describe('export → import', () => {
  it('round-trips in the clear and replaces the store', async () => {
    await seed();
    const text = exportBundle(APP);
    expect(text).toContain('"apiToken": "k"');

    // A fresh store with different content.
    configureStore(new MemoryDocStore());
    await hydrateStores();
    createFolder({ name: 'Old', color: 'red', description: '' });
    updateSettings({ mcpEnabled: false });
    await setStoredCredentials('godaddy', { apiToken: 'old' });
    const staleClient = getRegistrarClient('godaddy');
    const settingsChanged = vi.fn();
    onSettingsChanged(settingsChanged);
    const portfolioChanged = vi.fn();
    onCoreEvent('portfolioChanged', portfolioChanged);

    const result = await importBundle(text);
    expect(result.namespaces).toBeGreaterThanOrEqual(3);
    expect(result.entries).toBeGreaterThanOrEqual(3);
    expect(getFolders().folders.map((f) => f.name)).toEqual(['Keepers']);
    expect(getSettings()).toMatchObject({
      mcpEnabled: true,
      autoSyncIntervalMinutes: 60,
    });
    expect(settingsChanged).toHaveBeenCalledWith(
      expect.objectContaining({ mcpEnabled: true }),
      expect.objectContaining({ mcpEnabled: false }),
    );
    expect(portfolioChanged).toHaveBeenCalled();
    // The registrar client built from the old keys is gone.
    expect(getRegistrarClient('godaddy')).not.toBe(staleClient);
    // Revision counters (meta) were not touched by the import.
    expect(getRevisions().portfolio).toBe(0);

    // And it's durable, not just in memory.
    await flushWrites();
    await hydrateStores();
    expect(getFolders().folders.map((f) => f.name)).toEqual(['Keepers']);
  });

  it('refuses a sealed file until the client opens it', async () => {
    await seed();
    const sealed = await sealBundle(exportBundle(APP), 'hunter2');
    expect(() => parseBundle(sealed)).toThrow(/sealed with a passphrase/);
  });

  it('rejects things that are not bundles', () => {
    expect(() => parseBundle('not json')).toThrow(BundleError);
    expect(() => parseBundle('{"format":"x"}')).toThrow(
      /Not a DomBot data file/,
    );
    expect(() =>
      parseBundle(JSON.stringify({ format: BUNDLE_FORMAT, version: 99 })),
    ).toThrow(/newer DomBot/);
    expect(() =>
      parseBundle(JSON.stringify({ format: BUNDLE_FORMAT, version: 1 })),
    ).toThrow(/no content/);
    expect(() =>
      parseBundle(
        JSON.stringify({
          format: BUNDLE_FORMAT,
          version: 1,
          namespaces: { folders: [1] },
        }),
      ),
    ).toThrow(/Malformed/);
  });

  it('empties namespaces the file leaves out (nothing survives but meta)', async () => {
    await seed();
    const text = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: 1,
      exportedAt: 'x',
      app: APP,
      namespaces: { settings: { mcpEnabled: true } },
    });
    await importBundle(text);
    await flushWrites();
    expect(getFolders().folders).toEqual([]);
    expect(await store.list('registrar-credentials')).toEqual({});
    expect(await store.list('folders')).toEqual({});
    expect(getSettings().mcpEnabled).toBe(true);
    // Revision counters (meta) are still there.
    expect(getRevisions().portfolio).toBe(1);
  });

  it('ignores namespaces this build does not know', async () => {
    const text = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: 1,
      exportedAt: 'x',
      app: APP,
      namespaces: { 'future-thing': { a: 1 }, settings: { mcpEnabled: true } },
    });
    const result = await importBundle(text);
    expect(result).toEqual({ namespaces: 1, entries: 1 });
    await flushWrites();
    expect(await store.list('future-thing')).toEqual({});
    expect(getSettings().mcpEnabled).toBe(true);
  });

  it('upgrades a v3 file: old names, account-scoped folders and prices', async () => {
    const text = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: 3,
      exportedAt: 'x',
      app: APP,
      namespaces: {
        credentials: { godaddy: { apiToken: 'k' } },
        'cache-portfolio': { godaddy: { fetchedAt: 1, data: { domains: [] } } },
        'tld-rates': { 'godaddy:com': 8.99 },
        'pricing-overrides': {
          'godaddy:Münich.de': 40,
          'acct-2:xn--mnich-kva.de': 99,
        },
        folders: {
          folders: [{ id: 'f1', name: 'Keep', description: '', color: 'red' }],
          assignments: { 'godaddy:a.com': 'f1', 'godaddy:b.com': '__hidden__' },
        },
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await importBundle(text);
    warn.mockRestore();
    await flushWrites();
    expect(await store.list('registrar-credentials')).toEqual({
      godaddy: { apiToken: 'k' },
    });
    expect(Object.keys(await store.list('registrar-domains'))).toEqual([
      'godaddy',
    ]);
    expect(await store.list('registrar-tld-rates')).toEqual({
      'godaddy:com': 8.99,
    });
    // Keyed by name; the second account's entry for the same name is dropped.
    expect(await store.list('domain-prices')).toEqual({
      'xn--mnich-kva.de': 40,
    });
    expect(getFolders()).toEqual({
      folders: [{ id: 'f1', name: 'Keep', description: '', color: 'red' }],
      assignments: { 'a.com': 'f1', 'b.com': HIDDEN_FOLDER_ID },
    });
    for (const old of ['credentials', 'cache-portfolio', 'pricing-overrides'])
      expect(await store.list(old)).toEqual({});
  });

  it('imports a v4 file (no history yet) and refuses one newer than v5', async () => {
    await seed();
    const v4 = { ...buildBundle(APP), version: 4 };
    await importBundle(JSON.stringify(v4));
    expect(getFolders().folders.map((f) => f.name)).toEqual(['Keepers']);
    expect(buildBundle(APP).version).toBe(5);
    expect(() => parseBundle(JSON.stringify({ ...v4, version: 6 }))).toThrow(
      /newer DomBot/,
    );
  });

  it("moves a v4 file's Archive folder assignments to Hidden", async () => {
    const v4 = {
      ...buildBundle(APP),
      version: 4,
      namespaces: {
        ...buildBundle(APP).namespaces,
        'domain-folders': { 'a.com': '__archive__', 'b.com': 'f1' },
      },
    };
    await importBundle(JSON.stringify(v4));
    await flushWrites();
    expect(await store.list('domain-folders')).toEqual({
      'a.com': HIDDEN_FOLDER_ID,
      'b.com': 'f1',
    });
  });
});
