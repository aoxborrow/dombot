import { describe, expect, it } from 'vitest';
import {
  accountSyncState,
  syncBaseline,
  syncProgress,
  syncSummary,
  syncingText,
  type SyncAccount,
} from './sync-state';

const DAY = 86_400_000;
const account = (patch: Partial<SyncAccount>): SyncAccount => ({
  kind: 'registrar',
  id: 'a',
  name: 'A',
  lastSyncedAt: Date.now() - 60_000,
  lastError: null,
  lastAttemptAt: Date.now() - 60_000,
  ...patch,
});

describe('accountSyncState', () => {
  it('reads failed, stale, unsynced and synced', () => {
    expect(accountSyncState(account({ lastError: 'Bad key' }))).toBe('failed');
    expect(
      accountSyncState(account({ lastSyncedAt: Date.now() - 8 * DAY })),
    ).toBe('stale');
    expect(accountSyncState(account({ lastSyncedAt: null }))).toBe('unsynced');
    expect(accountSyncState(account({}))).toBe('synced');
  });
});

describe('syncSummary', () => {
  it('is green when every account synced', () => {
    const s = syncSummary(
      [account({}), account({ kind: 'market', id: 'm' })],
      'accounts',
    );
    expect(s).toMatchObject({
      level: 'ok',
      label: '2/2 accounts synced',
      short: '2/2 synced',
      title: 'All accounts synced',
    });
  });

  it('is red when one failed, whatever else', () => {
    const s = syncSummary(
      [
        account({ kind: 'market', lastError: 'Login failed' }),
        account({ lastSyncedAt: null }),
        account({}),
      ],
      'accounts',
    );
    expect(s).toMatchObject({
      level: 'error',
      failed: 1,
      label: '1 of 3 accounts failed',
      title: '1 account failed to sync',
    });
  });

  it('is amber while one is stale or never synced', () => {
    expect(
      syncSummary(
        [account({ lastSyncedAt: Date.now() - 8 * DAY }), account({})],
        'registrars',
      ),
    ).toMatchObject({ level: 'warn', label: '1 of 2 registrars stale' });
    expect(
      syncSummary([account({ lastSyncedAt: null }), account({})], 'accounts'),
    ).toMatchObject({
      level: 'warn',
      label: '1/2 accounts synced',
      title: '1 account not synced yet',
    });
  });

  it('is amber with nothing to sync', () => {
    expect(syncSummary([], 'registrars')).toMatchObject({
      level: 'warn',
      label: 'No registrars to sync',
    });
  });
});

describe('sync progress', () => {
  it('counts the accounts whose last attempt moved since the Sync began', () => {
    const before = [
      account({ id: 'a', name: 'Dynadot', lastAttemptAt: 100 }),
      account({ id: 'b', name: 'GoDaddy', lastAttemptAt: null }),
      account({ id: 'c', name: 'Sedo', kind: 'market', lastAttemptAt: 200 }),
    ];
    const baseline = syncBaseline(before);
    expect(syncProgress(before, baseline)).toEqual({
      done: 0,
      total: 3,
      current: 'Dynadot',
    });
    // a synced (its clock may be behind the browser's: it only has to move),
    // b tried for the first time and failed; c is still going.
    const now = [
      account({ id: 'a', name: 'Dynadot', lastAttemptAt: 50 }),
      account({
        id: 'b',
        name: 'GoDaddy',
        lastAttemptAt: 300,
        lastError: 'Bad key',
      }),
      account({ id: 'c', name: 'Sedo', kind: 'market', lastAttemptAt: 200 }),
    ];
    expect(syncProgress(now, baseline)).toEqual({
      done: 2,
      total: 3,
      current: 'Sedo',
    });
  });

  it('names the first account still going, in sync order', () => {
    const baseline = syncBaseline([
      account({ id: 'a', name: 'Dynadot', lastAttemptAt: 1 }),
      account({ id: 'b', name: 'Namecheap', lastAttemptAt: 1 }),
      account({ id: 'c', name: 'Afternic', kind: 'market', lastAttemptAt: 1 }),
    ]);
    // Registrars sync at once: a later one can finish first.
    const now = [
      account({ id: 'a', name: 'Dynadot', lastAttemptAt: 1 }),
      account({ id: 'b', name: 'Namecheap', lastAttemptAt: 2 }),
      account({ id: 'c', name: 'Afternic', kind: 'market', lastAttemptAt: 1 }),
    ];
    expect(syncProgress(now, baseline).current).toBe('Dynadot');
    const all = now.map((a) => ({ ...a, lastAttemptAt: 3 }));
    expect(syncProgress(all, baseline).current).toBeNull();
  });

  it('leaves out accounts the Sync doesn’t cover', () => {
    const baseline = syncBaseline([account({ id: 'a', lastAttemptAt: 1 })]);
    const now = [
      account({ id: 'a', lastAttemptAt: 2 }),
      account({ id: 'x', lastAttemptAt: 9 }),
    ];
    expect(syncProgress(now, baseline)).toEqual({
      done: 1,
      total: 1,
      current: null,
    });
  });

  it('says how far along it is, or just Syncing', () => {
    const progress = { done: 15, total: 17, current: 'Dynadot' };
    expect(syncingText(progress, 'accounts')).toBe(
      'Syncing Dynadot (15/17 accounts)…',
    );
    // The short form, for buttons, leaves the name out.
    expect(syncingText(progress)).toBe('Syncing 15/17…');
    expect(syncingText({ ...progress, current: null }, 'accounts')).toBe(
      'Syncing 15/17 accounts…',
    );
    expect(syncingText(null, 'accounts')).toBe('Syncing…');
  });
});
