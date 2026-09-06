import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { getSettings, updateSettings } from './settings';
import {
  assignFolder,
  createFolder,
  deleteFolder,
  getFolders,
  updateFolder,
} from './folders';
import { isRegistrarEnabled, setRegistrarEnabled } from './registrar-state';
import { resolvePricing, setManualPrice } from './pricing';
import { getStoredCredentials, setStoredCredentials } from './credentials';
import {
  clearAll,
  isStale,
  patchEntryData,
  readAll,
  readEntry,
  writeEntry,
} from './cache';

// The services over a fresh in-memory store: each one's public API still
// behaves as it did over its own JSON file, and what lands in the DocStore is
// the same shape that file had.

let store: MemoryDocStore;
beforeEach(async () => {
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
});

describe('settings', () => {
  it('defaults, patches, coerces, and persists one key per setting', async () => {
    expect(getSettings()).toEqual({
      autoSyncIntervalMinutes: 1440,
      recentNameservers: [],
      mcpEnabled: false,
    });
    updateSettings({ autoSyncIntervalMinutes: -5 });
    expect(getSettings().autoSyncIntervalMinutes).toBe(1440);
    updateSettings({
      autoSyncIntervalMinutes: 30.7,
      recentNameservers: [['a', 'b'], [], ['c']],
    });
    expect(getSettings()).toEqual({
      autoSyncIntervalMinutes: 30,
      recentNameservers: [['a', 'b'], ['c']],
      mcpEnabled: false,
    });
    await flushWrites();
    expect(await store.list('settings')).toEqual({
      autoSyncIntervalMinutes: 30,
      recentNameservers: [['a', 'b'], ['c']],
      mcpEnabled: false,
    });
  });
});

describe('folders', () => {
  it('creates, updates, assigns, and deletes with cascading unassign', async () => {
    const f = createFolder({ name: 'Keep', description: '', color: 'red' });
    updateFolder(f.id, { name: 'Keepers' });
    assignFolder('dynadot:a.com', f.id);
    assignFolder('dynadot:b.com', 'not-a-folder'); // treated as unassign
    expect(getFolders()).toEqual({
      folders: [{ ...f, name: 'Keepers' }],
      assignments: { 'dynadot:a.com': f.id },
    });
    await flushWrites();
    expect(await store.list('folders')).toEqual(getFolders());

    deleteFolder(f.id);
    expect(getFolders()).toEqual({ folders: [], assignments: {} });
  });
});

describe('registrar-state', () => {
  it('stores only the disabled set', async () => {
    expect(isRegistrarEnabled('gandi')).toBe(true);
    setRegistrarEnabled('gandi', false);
    expect(isRegistrarEnabled('gandi')).toBe(false);
    await flushWrites();
    expect(await store.get('registrar-state', 'disabled')).toEqual(['gandi']);
    setRegistrarEnabled('gandi', true);
    await flushWrites();
    expect(await store.get('registrar-state', 'disabled')).toEqual([]);
  });
});

describe('pricing overrides', () => {
  it('manual price wins, and clears with null', async () => {
    setManualPrice('dynadot', 'a.com', 12.5);
    expect(resolvePricing('dynadot', 'a.com')).toMatchObject({
      renewal: 12.5,
      source: 'manual',
    });
    await flushWrites();
    expect(await store.list('pricing-overrides')).toEqual({
      'dynadot:a.com': 12.5,
    });
    setManualPrice('dynadot', 'a.com', null);
    expect(resolvePricing('dynadot', 'a.com').source).not.toBe('manual');
  });
});

describe('credentials', () => {
  it('trims, drops blanks, clears on all-empty, and awaits the write', async () => {
    await setStoredCredentials('dynadot', { apiKey: ' k ', extra: '  ' });
    expect(getStoredCredentials('dynadot')).toEqual({ apiKey: 'k' });
    expect(await store.get('credentials', 'dynadot')).toEqual({ apiKey: 'k' });
    await setStoredCredentials('dynadot', { apiKey: '' });
    expect(getStoredCredentials('dynadot')).toEqual({});
    expect(await store.get('credentials', 'dynadot')).toBeNull();
  });
});

describe('cache', () => {
  it('stamps, patches without restamping, and clears', async () => {
    const e = writeEntry('portfolio', 'dynadot', { n: 1 });
    expect(readEntry('portfolio', 'dynadot')).toEqual(e);
    expect(isStale(e)).toBe(false);
    patchEntryData<{ n: number }>('portfolio', 'dynadot', (d) => ({
      n: d.n + 1,
    }));
    expect(readEntry<{ n: number }>('portfolio', 'dynadot')).toEqual({
      data: { n: 2 },
      fetchedAt: e.fetchedAt,
    });
    await flushWrites();
    expect(await store.list('cache-portfolio')).toEqual(readAll('portfolio'));
    clearAll();
    expect(readEntry('portfolio', 'dynadot')).toBeNull();
    await flushWrites();
    expect(await store.list('cache-portfolio')).toEqual({});
  });
});

describe('settings: mcpEnabled + change listeners', () => {
  it('defaults off, reports whether it was ever stored, and notifies on change', async () => {
    const { isSettingStored, onSettingsChanged } = await import('./settings');
    expect(getSettings().mcpEnabled).toBe(false);
    expect(isSettingStored('mcpEnabled')).toBe(false);

    const seen: [boolean, boolean][] = [];
    const off = onSettingsChanged((next, prev) =>
      seen.push([prev.mcpEnabled, next.mcpEnabled]),
    );
    updateSettings({ mcpEnabled: true });
    expect(getSettings().mcpEnabled).toBe(true);
    expect(isSettingStored('mcpEnabled')).toBe(true);
    expect(seen).toEqual([[false, true]]);
    off();
    updateSettings({ mcpEnabled: false });
    expect(seen).toHaveLength(1);
    await flushWrites();
    expect(await store.get('settings', 'mcpEnabled')).toBe(false);
  });
});
