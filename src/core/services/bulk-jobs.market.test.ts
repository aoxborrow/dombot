vi.mock('./registrars', () => ({
  resolveDomainAccount: (registrar: string, _domain: string, id?: string) => ({
    registrar,
    id: id ?? registrar,
    label: 'Default',
  }),
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketWriteResult } from '../../shared/markets';

// The bulk runner's market lanes ("Market jobs" in bulk-jobs.ts), with the
// market write service mocked: one name per account per step, outcomes
// mapped to statuses, rate-limited names re-queued, and resume on restart.

const applyDomainOp = vi.fn();
vi.mock('./domain-ops', () => ({
  applyDomainOp: (...a: unknown[]) => applyDomainOp(...a),
}));
const broadcastPortfolioChanged = vi.fn();
vi.mock('../events', () => ({
  broadcastBulkProgress: () => {},
  broadcastBulkFinished: () => {},
  broadcastPortfolioChanged: () => broadcastPortfolioChanged(),
}));
vi.mock('./markets/accounts', () => ({
  marketAccount: (id: string) => {
    if (id === 'missing') throw new Error('No such market account.');
    return { id, market: 'atom', label: id, enabled: true };
  },
}));
vi.mock('./markets/registry', () => ({
  marketInfo: () => ({ capabilities: { rateLimit: null } }),
}));

const writeMarketListings = vi.fn();
const pushAskingPrices = vi.fn();
const deleteMarketListings = vi.fn();
vi.mock('./markets/writes', () => ({
  writeMarketListings: (...a: unknown[]) => writeMarketListings(...a),
  pushAskingPrices: (...a: unknown[]) => pushAskingPrices(...a),
  deleteMarketListings: (...a: unknown[]) => deleteMarketListings(...a),
}));

import {
  abandonInterruptedBulk,
  advanceMarketBulk,
  cancelMarketBulk,
  getMarketBulkJob,
  resetBulkMemory,
  setBulkAutoDrive,
  startBulk,
  startMarketBulk,
  stepMarketBulk,
  getBulkJob,
} from './bulk-jobs';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';

const ok = (name: string, extra: Partial<MarketWriteResult> = {}) => ({
  name,
  ok: true,
  pending: false,
  saved: null,
  adjusted: [],
  error: null,
  ...extra,
});
const failed = (name: string, code: string) => ({
  ...ok(name),
  ok: false,
  error: { code, message: `${code} for ${name}` },
});

const push = (accountId: string, ...names: string[]) =>
  names.map((name) => ({ accountId, name }));

let store: MemoryDocStore;
beforeEach(async () => {
  vi.clearAllMocks();
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
  resetBulkMemory();
  setBulkAutoDrive(false);
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-10-28T12:00:00Z'));
  pushAskingPrices.mockImplementation(async (_a: string, [name]: string[]) => [
    ok(name),
  ]);
  writeMarketListings.mockImplementation(
    async (_a: string, [c]: { name: string }[]) => [ok(c.name)],
  );
  deleteMarketListings.mockImplementation(
    async (_a: string, [name]: string[]) => [ok(name)],
  );
});

describe('market jobs', () => {
  it('runs one name per account per step, in parallel across accounts', async () => {
    const job = startMarketBulk(
      [...push('a1', 'one.com', 'two.com'), ...push('a2', 'three.com')],
      { kind: 'pushAskingPrices' },
    );
    expect(job.total).toBe(3);
    const first = await stepMarketBulk(job.id);
    expect(pushAskingPrices.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['a1', ['one.com']],
      ['a2', ['three.com']],
    ]);
    expect(pushAskingPrices.mock.calls[0][2]).toEqual({
      silent: true,
      skipUnchanged: true,
    });
    // Lanes are spaced a second apart (no published rate).
    expect(first.nextAt).toBe(Date.now() + 1000);
    expect((await stepMarketBulk(job.id)).job.results).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    const last = await stepMarketBulk(job.id);
    expect(last.job.status).toBe('done');
    expect(last.job.counts.ok).toBe(3);
    expect(broadcastPortfolioChanged).toHaveBeenCalledTimes(1);
  });

  it('maps outcomes to statuses', async () => {
    pushAskingPrices.mockImplementation(
      async (_a: string, [name]: string[]) => [
        name === 'same.com'
          ? ok(name, { unchanged: true })
          : name === 'euro.com'
            ? failed(name, 'CURRENCY')
            : failed(name, 'REJECTED'),
      ],
    );
    const job = startMarketBulk(push('a1', 'same.com', 'euro.com', 'bad.com'), {
      kind: 'pushAskingPrices',
    });
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(1000);
      await stepMarketBulk(job.id);
    }
    const done = getMarketBulkJob()!;
    expect(done.results.map((r) => [r.name, r.status, r.code])).toEqual([
      ['same.com', 'skipped', null],
      ['euro.com', 'unsupported', 'CURRENCY'],
      ['bad.com', 'failed', 'REJECTED'],
    ]);
  });

  it('puts a rate-limited name back in the queue, up to three times', async () => {
    let n = 0;
    pushAskingPrices.mockImplementation(
      async (_a: string, [name]: string[]) => [
        ++n <= 2 ? failed(name, 'RATE_LIMITED') : ok(name),
      ],
    );
    const job = startMarketBulk(push('a1', 'busy.com'), {
      kind: 'pushAskingPrices',
    });
    const after429 = await stepMarketBulk(job.id);
    expect(after429.job.results).toHaveLength(0);
    expect(after429.nextAt).toBe(Date.now() + 30_000);
    for (let i = 0; i < 2; i++) {
      vi.advanceTimersByTime(30_000);
      await stepMarketBulk(job.id);
    }
    expect(getMarketBulkJob()!.counts.ok).toBe(1);

    pushAskingPrices.mockImplementation(
      async (_a: string, [name]: string[]) => [failed(name, 'RATE_LIMITED')],
    );
    const again = startMarketBulk(push('a1', 'busy.com'), {
      kind: 'pushAskingPrices',
    });
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(30_000);
      await stepMarketBulk(again.id);
    }
    expect(pushAskingPrices).toHaveBeenCalledTimes(3 + 4);
    expect(getMarketBulkJob()!.counts['rate-limited']).toBe(1);
  });

  it('passes each target’s change to a write job, and needs one', async () => {
    expect(() =>
      startMarketBulk(push('a1', 'one.com'), { kind: 'write' }),
    ).toThrow(/No change/);
    const job = startMarketBulk(
      [
        {
          accountId: 'a1',
          name: 'One.com',
          change: { name: 'x', price: '900' },
        },
      ],
      { kind: 'write' },
    );
    await stepMarketBulk(job.id);
    expect(writeMarketListings).toHaveBeenCalledWith(
      'a1',
      [{ name: 'one.com', price: '900' }],
      { silent: true, skipUnchanged: true },
    );
  });

  it('refuses an unknown account, and a second job while one runs', () => {
    expect(() =>
      startMarketBulk(push('missing', 'a.com'), { kind: 'delete' }),
    ).toThrow(/No such market account/);
    startMarketBulk(push('a1', 'a.com'), { kind: 'delete' });
    expect(() =>
      startMarketBulk(push('a1', 'b.com'), { kind: 'delete' }),
    ).toThrow(/already running/);
  });

  it('runs alongside a registrar bulk job', () => {
    startMarketBulk(push('a1', 'a.com'), { kind: 'delete' });
    const registrar = startBulk(
      [{ registrar: 'dynadot', domainName: 'b.com', accountId: 'dynadot' }],
      { kind: 'autoRenew', enabled: true },
    );
    expect(registrar.status).toBe('running');
    expect(getBulkJob()?.status).toBe('running');
    expect(getMarketBulkJob()?.status).toBe('running');
  });

  it('cancels the names not yet sent', async () => {
    const job = startMarketBulk(push('a1', 'a.com', 'b.com', 'c.com'), {
      kind: 'delete',
    });
    await stepMarketBulk(job.id);
    cancelMarketBulk(job.id);
    const { job: after } = await stepMarketBulk(job.id);
    expect(after.status).toBe('cancelled');
    expect(after.counts).toMatchObject({ ok: 1, cancelled: 2 });
  });

  it('resumes after a restart, never re-sending a name that was mid-request', async () => {
    const job = startMarketBulk(push('a1', 'a.com', 'b.com', 'c.com'), {
      kind: 'delete',
    });
    await stepMarketBulk(job.id);
    // A crash with b.com sent and no answer recorded.
    const stored = getMarketBulkJob()!;
    await store.put('bulk-jobs', 'market-job', {
      ...((await store.get('bulk-jobs', 'market-job')) as object),
      pending: [{ accountId: 'a1', name: 'c.com' }],
      inFlight: [{ accountId: 'a1', name: 'b.com' }],
    });
    await flushWrites();
    resetBulkMemory();
    await hydrateStores();
    expect(stored.results).toHaveLength(1);

    abandonInterruptedBulk(); // startup: no auto-drive here, so step by hand
    vi.advanceTimersByTime(1000);
    const resumed = await advanceMarketBulk(5000);
    expect(resumed?.status).toBe('done');
    expect(resumed?.results.map((r) => [r.name, r.status])).toEqual([
      ['a.com', 'ok'],
      ['b.com', 'cancelled'],
      ['c.com', 'ok'],
    ]);
    expect(deleteMarketListings.mock.calls.map((c) => c[1][0])).toEqual([
      'a.com',
      'c.com',
    ]);
  });
});
