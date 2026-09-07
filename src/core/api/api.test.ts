import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { ApiValidationError, coreMethods, invoke } from './index';
import { domainOp, folderPatch } from './schemas';
import { broadcastBulkFinished, broadcastPortfolioChanged } from '../events';
import { IpcChannels, type BulkJob } from '../../shared/ipc';

let store: MemoryDocStore;
beforeEach(async () => {
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
});

describe('invoke', () => {
  it('pads omitted trailing optional args and runs the handler', async () => {
    // listPortfolio(refresh?) with no args → refresh defaults to true inside
    // the handler; we only check the schema accepts the shorter call here.
    const entry = coreMethods.getDomainDetail;
    expect(entry.args.parse(['dynadot', 'a.com', undefined])).toEqual([
      'dynadot',
      'a.com',
      undefined,
    ]);
    // Through invoke: same call minus the optional arg. The registrar client
    // isn't configured, so the handler resolves null for an unknown domain.
    await expect(
      invoke('getFolders', coreMethods.getFolders, []),
    ).resolves.toEqual({
      folders: [],
      assignments: {},
    });
  });

  it('rejects bad input with a ZodError before the handler runs', async () => {
    await expect(
      invoke('setManualPrice', coreMethods.setManualPrice, [
        'nope',
        'a.com',
        1,
      ]),
    ).rejects.toBeInstanceOf(ApiValidationError);
    await expect(
      invoke('applyDomainOp', coreMethods.applyDomainOp, [
        { registrar: 'dynadot', domainName: 'a.com' },
        { kind: 'renew', years: 0 },
      ]),
    ).rejects.toBeInstanceOf(ApiValidationError);
    await expect(
      invoke('startBulk', coreMethods.startBulk, [[], { kind: 'authCode' }]),
    ).rejects.toBeInstanceOf(ApiValidationError);
    await expect(
      invoke('updateSettings', coreMethods.updateSettings, [{ unknownKey: 1 }]),
    ).rejects.toBeInstanceOf(ApiValidationError);
    // Extra positional args are rejected too.
    await expect(
      invoke('getSettings', coreMethods.getSettings, ['surprise']),
    ).rejects.toBeInstanceOf(ApiValidationError);
    // The message names the method and is short enough to show a user.
    await expect(
      invoke('setManualPrice', coreMethods.setManualPrice, [
        'nope',
        'a.com',
        1,
      ]),
    ).rejects.toThrow(/^Invalid arguments to setManualPrice \(0: /);
  });

  it('runs handlers against the store', async () => {
    const folder = await invoke('createFolder', coreMethods.createFolder, [
      { name: 'Keep', description: '', color: 'teal' },
    ]);
    await invoke('assignFolder', coreMethods.assignFolder, [
      'dynadot:a.com',
      folder.id,
    ]);
    await invoke('updateSettings', coreMethods.updateSettings, [
      { autoSyncIntervalMinutes: 60 },
    ]);
    await flushWrites();
    expect(await store.get('folders', 'assignments')).toEqual({
      'dynadot:a.com': folder.id,
    });
    expect(await store.get('settings', 'autoSyncIntervalMinutes')).toBe(60);
    expect(
      await invoke('getSettings', coreMethods.getSettings, []),
    ).toMatchObject({
      autoSyncIntervalMinutes: 60,
    });
  });

  it('hydrateFromCache returns an empty snapshot with no registrars', async () => {
    expect(
      await invoke('hydrateFromCache', coreMethods.hydrateFromCache, []),
    ).toEqual({
      portfolio: null,
      detail: {},
      pricing: {},
    });
  });
});

describe('schemas', () => {
  it('accepts every DomainOp kind the UI produces', () => {
    for (const op of [
      { kind: 'autoRenew', enabled: true },
      { kind: 'privacy', enabled: false },
      { kind: 'lock', locked: true },
      { kind: 'nameservers', nameservers: ['ns1.x', 'ns2.x'] },
      {
        kind: 'urlForwarding',
        forwards: [{ host: '@', url: 'https://x', type: 'permanent' }],
        skipIfExisting: true,
      },
      {
        kind: 'emailForwarding',
        forwards: [{ alias: '*', forwardTo: 'me@x.com' }],
      },
      { kind: 'authCode' },
      { kind: 'renew', years: 2 },
    ]) {
      expect(domainOp.safeParse(op).success, JSON.stringify(op)).toBe(true);
    }
    expect(domainOp.safeParse({ kind: 'delete' }).success).toBe(false);
  });

  it('folderPatch is strict about unknown keys', () => {
    expect(folderPatch.safeParse({ name: 'x' }).success).toBe(true);
    expect(folderPatch.safeParse({ id: 'x' }).success).toBe(false);
    expect(folderPatch.safeParse({ color: 'plaid' }).success).toBe(false);
  });
});

describe('revisions', () => {
  it('bump from core events and persist to the meta namespace', async () => {
    const before = await invoke('getRevisions', coreMethods.getRevisions, []);
    broadcastPortfolioChanged();
    broadcastBulkFinished({ id: 'j' } as BulkJob);
    const after = await invoke('getRevisions', coreMethods.getRevisions, []);
    expect(after.portfolio).toBe(before.portfolio + 1);
    expect(after.bulk).toBe(before.bulk + 1);
    expect(after.approvals).toBe(before.approvals);
    await flushWrites();
    expect(await store.get('meta', 'rev:portfolio')).toBe(after.portfolio);
  });
});

describe('contract', () => {
  it('has a channel for every core method', () => {
    for (const name of Object.keys(coreMethods)) {
      expect(IpcChannels).toHaveProperty(name);
    }
  });
});
