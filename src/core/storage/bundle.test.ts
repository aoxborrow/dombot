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
  await setStoredCredentials('godaddy', { apiKey: 'k', apiSecret: 's' });
  createFolder({ name: 'Keepers', color: 'green', description: '' });
  updateSettings({ mcpEnabled: true, autoSyncIntervalMinutes: 60 });
  bumpRevision('portfolio');
  await flushWrites();
}

describe('buildBundle', () => {
  it('captures every namespace except auth and meta', async () => {
    await seed();
    const b = buildBundle(APP);
    expect(b.format).toBe(BUNDLE_FORMAT);
    expect(b.app).toEqual(APP);
    expect(Object.keys(b.namespaces).sort()).toEqual(
      expect.arrayContaining(['credentials', 'folders', 'settings']),
    );
    expect(b.namespaces.meta).toBeUndefined();
    expect(b.namespaces.auth).toBeUndefined();
    expect(b.namespaces.credentials.godaddy).toEqual({
      apiKey: 'k',
      apiSecret: 's',
    });
  });
});

describe('export → import', () => {
  it('round-trips in the clear and replaces the store', async () => {
    await seed();
    const text = await exportBundle(APP);
    expect(text).toContain('"apiKey": "k"');

    // A fresh store with different content.
    configureStore(new MemoryDocStore());
    await hydrateStores();
    createFolder({ name: 'Old', color: 'red', description: '' });
    updateSettings({ mcpEnabled: false });
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
    // Revision counters (meta) were not touched by the import.
    expect(getRevisions().portfolio).toBe(0);

    // And it's durable, not just in memory.
    await flushWrites();
    await hydrateStores();
    expect(getFolders().folders.map((f) => f.name)).toEqual(['Keepers']);
  });

  it('seals with a passphrase and refuses the wrong one', async () => {
    await seed();
    const text = await exportBundle(APP, 'hunter2');
    expect(text).not.toContain('apiKey');
    expect(JSON.parse(text).encrypted.alg).toBe('AES-256-GCM');

    await expect(parseBundle(text)).rejects.toThrow(/needs its passphrase/);
    await expect(parseBundle(text, 'nope')).rejects.toThrow(/Wrong passphrase/);
    const bundle = await parseBundle(text, 'hunter2');
    expect(bundle.namespaces.credentials.godaddy).toEqual({
      apiKey: 'k',
      apiSecret: 's',
    });
  });

  it('rejects things that are not bundles', async () => {
    await expect(parseBundle('not json')).rejects.toBeInstanceOf(BundleError);
    await expect(parseBundle('{"format":"x"}')).rejects.toThrow(
      /Not a DomBot data file/,
    );
    await expect(
      parseBundle(JSON.stringify({ format: BUNDLE_FORMAT, version: 99 })),
    ).rejects.toThrow(/newer DomBot/);
    await expect(
      parseBundle(JSON.stringify({ format: BUNDLE_FORMAT, version: 1 })),
    ).rejects.toThrow(/no content/);
    await expect(
      parseBundle(
        JSON.stringify({
          format: BUNDLE_FORMAT,
          version: 1,
          namespaces: { folders: [1] },
        }),
      ),
    ).rejects.toThrow(/Malformed/);
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
});
