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
      account({ id: 'a', lastAttemptAt: 100 }),
      account({ id: 'b', lastAttemptAt: null }),
      account({ id: 'c', kind: 'market', lastAttemptAt: 200 }),
    ];
    const baseline = syncBaseline(before);
    expect(syncProgress(before, baseline)).toEqual({ done: 0, total: 3 });
    // a synced (its clock may be behind the browser's: it only has to move),
    // b tried for the first time and failed; c is still going.
    const now = [
      account({ id: 'a', lastAttemptAt: 50 }),
      account({ id: 'b', lastAttemptAt: 300, lastError: 'Bad key' }),
      account({ id: 'c', kind: 'market', lastAttemptAt: 200 }),
    ];
    expect(syncProgress(now, baseline)).toEqual({ done: 2, total: 3 });
  });

  it('leaves out accounts the Sync doesn’t cover', () => {
    const baseline = syncBaseline([account({ id: 'a', lastAttemptAt: 1 })]);
    const now = [
      account({ id: 'a', lastAttemptAt: 2 }),
      account({ id: 'x', lastAttemptAt: 9 }),
    ];
    expect(syncProgress(now, baseline)).toEqual({ done: 1, total: 1 });
  });

  it('says how far along it is, or just Syncing', () => {
    expect(syncingText({ done: 15, total: 17 }, 'accounts')).toBe(
      'Syncing 15/17 accounts…',
    );
    expect(syncingText({ done: 15, total: 17 })).toBe('Syncing 15/17…');
    expect(syncingText(null, 'accounts')).toBe('Syncing…');
  });
});
