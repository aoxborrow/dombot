import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DomainOp,
  DomainOpResult,
  DomainOpStatus,
  DomainTarget,
} from '../../shared/ipc';

// Mock the one op the runner calls and the three broadcasts it emits.
const applyDomainOp = vi.fn();
vi.mock('./domain-ops', () => ({
  applyDomainOp: (...a: unknown[]) => applyDomainOp(...a),
}));

const broadcastBulkProgress = vi.fn();
const broadcastBulkFinished = vi.fn();
const broadcastPortfolioChanged = vi.fn();
vi.mock('../events', () => ({
  broadcastBulkProgress: (...a: unknown[]) => broadcastBulkProgress(...a),
  broadcastBulkFinished: (...a: unknown[]) => broadcastBulkFinished(...a),
  broadcastPortfolioChanged: () => broadcastPortfolioChanged(),
}));

import {
  abandonInterruptedBulk,
  cancelBulk,
  driveBulk,
  getBulkJob,
  isBulkRunning,
  resetBulkForTests,
  setBulkAutoDrive,
  startBulk,
  stepBulk,
} from './bulk-jobs';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';

const AUTO_RENEW: DomainOp = { kind: 'autoRenew', enabled: true };
const targets = (registrar: DomainTarget['registrar'], ...names: string[]) =>
  names.map((domainName) => ({ registrar, domainName }));

// A canned result for a target, defaulting to ok.
const resultFor = (
  target: DomainTarget,
  status: DomainOpStatus = 'ok',
): DomainOpResult => ({ target, status, message: status });

let store: MemoryDocStore;
beforeEach(async () => {
  vi.clearAllMocks();
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
  resetBulkForTests();
  // These tests exercise the self-driving (desktop) mode unless they say so.
  setBulkAutoDrive(true);
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-06-01T00:00:00Z'));
  // Default: every op succeeds.
  applyDomainOp.mockImplementation(async (target: DomainTarget) =>
    resultFor(target, 'ok'),
  );
});

afterEach(() => {
  // Ensure no job leaks into the next test.
  if (isBulkRunning()) cancelBulk();
  vi.useRealTimers();
});

describe('startBulk guards', () => {
  it('throws when nothing is selected', () => {
    expect(() => startBulk([], AUTO_RENEW)).toThrow(/No domains selected/);
  });

  it('throws when a job is already running', async () => {
    startBulk(targets('dynadot', 'a.com', 'b.com'), AUTO_RENEW);
    expect(isBulkRunning()).toBe(true);
    expect(() => startBulk(targets('dynadot', 'c.com'), AUTO_RENEW)).toThrow(
      /already running/,
    );
    await vi.runAllTimersAsync();
  });

  it('returns an immediate running snapshot with zeroed counts and an id', () => {
    const job = startBulk(targets('dynadot', 'a.com', 'b.com'), AUTO_RENEW);
    expect(job.status).toBe('running');
    expect(job.total).toBe(2);
    expect(job.results).toEqual([]);
    expect(job.counts.ok).toBe(0);
    expect(job.id).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('progress accounting and terminal state', () => {
  it('records every item, counts them, and finishes done', async () => {
    startBulk(targets('dynadot', 'a.com', 'b.com', 'c.com'), AUTO_RENEW);
    await vi.runAllTimersAsync();

    const job = getBulkJob()!;
    expect(job.status).toBe('done');
    expect(job.finishedAt).toBeGreaterThan(0);
    expect(job.results).toHaveLength(3);
    expect(job.counts.ok).toBe(3);
    expect(broadcastBulkProgress).toHaveBeenCalledTimes(3);
    expect(broadcastBulkFinished).toHaveBeenCalledTimes(1);
  });

  it('emits progress with a monotonic done count', async () => {
    startBulk(targets('dynadot', 'a.com', 'b.com', 'c.com'), AUTO_RENEW);
    await vi.runAllTimersAsync();
    const dones = broadcastBulkProgress.mock.calls.map((c) => c[0].done);
    expect(dones).toEqual([1, 2, 3]);
    expect(
      broadcastBulkProgress.mock.calls.every((c) => c[0].total === 3),
    ).toBe(true);
  });

  it('tallies a mix of statuses and still finishes done', async () => {
    const map: Record<string, DomainOpStatus> = {
      'a.com': 'ok',
      'b.com': 'failed',
      'c.com': 'unsupported',
      'd.com': 'skipped',
    };
    applyDomainOp.mockImplementation(async (t: DomainTarget) =>
      resultFor(t, map[t.domainName]),
    );
    startBulk(
      targets('dynadot', 'a.com', 'b.com', 'c.com', 'd.com'),
      AUTO_RENEW,
    );
    await vi.runAllTimersAsync();

    const job = getBulkJob()!;
    expect(job.status).toBe('done');
    expect(job.counts).toMatchObject({
      ok: 1,
      failed: 1,
      unsupported: 1,
      skipped: 1,
    });
    expect(job.results).toHaveLength(4);
  });
});

describe('portfolioChanged broadcast', () => {
  it('fires once when at least one op succeeded', async () => {
    startBulk(targets('dynadot', 'a.com'), AUTO_RENEW);
    await vi.runAllTimersAsync();
    expect(broadcastPortfolioChanged).toHaveBeenCalledTimes(1);
  });

  it('does not fire when nothing succeeded', async () => {
    applyDomainOp.mockImplementation(async (t: DomainTarget) =>
      resultFor(t, 'failed'),
    );
    startBulk(targets('dynadot', 'a.com', 'b.com'), AUTO_RENEW);
    await vi.runAllTimersAsync();
    expect(broadcastPortfolioChanged).not.toHaveBeenCalled();
  });
});

describe('cancellation', () => {
  it('records remaining targets as cancelled without calling applyDomainOp', async () => {
    // Cancel from inside the first op so the rest of the lane sees the abort.
    applyDomainOp.mockImplementationOnce(async (t: DomainTarget) => {
      cancelBulk();
      return resultFor(t, 'ok');
    });
    startBulk(targets('dynadot', 'a.com', 'b.com', 'c.com'), AUTO_RENEW);
    await vi.runAllTimersAsync();

    const job = getBulkJob()!;
    expect(job.status).toBe('cancelled');
    expect(applyDomainOp).toHaveBeenCalledTimes(1);
    expect(job.counts.ok).toBe(1);
    expect(job.counts.cancelled).toBe(2);
    expect(job.results).toHaveLength(3);
  });
});

describe('rate-limit pause', () => {
  it('pauses the lane ~30s after a rate-limited result', async () => {
    const startTimes: number[] = [];
    applyDomainOp.mockImplementation(async (t: DomainTarget) => {
      startTimes.push(Date.now());
      return resultFor(t, t.domainName === 'a.com' ? 'rate-limited' : 'ok');
    });
    startBulk(targets('dynadot', 'a.com', 'b.com'), AUTO_RENEW);
    await vi.runAllTimersAsync();

    expect(startTimes).toHaveLength(2);
    // Second start waits out the 30s pause (dwarfing the 1s spacing).
    expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(30_000);
  });
});

describe('lane spacing', () => {
  it('spaces serialized starts by the registrar policy (dynadot 1s)', async () => {
    const startTimes: number[] = [];
    applyDomainOp.mockImplementation(async (t: DomainTarget) => {
      startTimes.push(Date.now());
      return resultFor(t, 'ok');
    });
    startBulk(targets('dynadot', 'a.com', 'b.com'), AUTO_RENEW);
    await vi.runAllTimersAsync();
    expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(1000);
  });

  it('runs different registrars in parallel lanes', async () => {
    const order: string[] = [];
    applyDomainOp.mockImplementation(async (t: DomainTarget) => {
      order.push(t.domainName);
      return resultFor(t, 'ok');
    });
    startBulk(
      [...targets('dynadot', 'a.com'), ...targets('porkbun', 'b.com')],
      AUTO_RENEW,
    );
    await vi.runAllTimersAsync();
    // Both ran; neither lane blocked the other.
    expect(order.sort()).toEqual(['a.com', 'b.com']);
  });
});

describe('snapshot isolation', () => {
  it('getBulkJob returns a copy that does not mutate the live job', async () => {
    startBulk(targets('dynadot', 'a.com'), AUTO_RENEW);
    await vi.runAllTimersAsync();

    const snap = getBulkJob()!;
    const originalLength = snap.results.length;
    snap.results.push(resultFor({ registrar: 'dynadot', domainName: 'x' }));
    snap.counts.ok = 999;

    const fresh = getBulkJob()!;
    expect(fresh.results).toHaveLength(originalLength);
    expect(fresh.counts.ok).toBe(1);
  });
});

describe('step-driven mode (no auto-drive)', () => {
  beforeEach(() => setBulkAutoDrive(false));

  it('startBulk does nothing until stepped; each step runs one slice per lane', async () => {
    const job = startBulk(
      targets('dynadot', 'a.com', 'b.com', 'c.com'),
      AUTO_RENEW,
    );
    expect(applyDomainOp).not.toHaveBeenCalled();

    const s1 = await stepBulk(job.id);
    expect(applyDomainOp).toHaveBeenCalledTimes(1); // dynadot: 1 lane
    expect(s1.job.results).toHaveLength(1);
    expect(s1.nextAt).toBe(Date.now() + 1000); // dynadot spacing

    // Too early: nothing runs, same nextAt.
    const s2 = await stepBulk(job.id);
    expect(applyDomainOp).toHaveBeenCalledTimes(1);
    expect(s2.nextAt).toBe(s1.nextAt);

    vi.setSystemTime(s1.nextAt!);
    await stepBulk(job.id);
    vi.setSystemTime(Date.now() + 1000);
    const s4 = await stepBulk(job.id);
    expect(s4.job.status).toBe('done');
    expect(s4.nextAt).toBeNull();
    expect(s4.job.counts.ok).toBe(3);
    expect(broadcastBulkFinished).toHaveBeenCalledTimes(1);
  });

  it('runs a slice across registrars in parallel, up to each lane count', async () => {
    const job = startBulk(
      [
        ...targets('namecheap', 'a.com', 'b.com', 'c.com'),
        ...targets('gandi', 'd.com'),
      ],
      AUTO_RENEW,
    );
    const s = await stepBulk(job.id);
    // namecheap: 2 lanes → 2 items; gandi: default 2 lanes → 1 item.
    expect(s.job.results).toHaveLength(3);
    expect(s.job.results.map((r) => r.target.domainName).sort()).toEqual([
      'a.com',
      'b.com',
      'd.com',
    ]);
  });

  it('clears inFlight in the store once a result is recorded (by value, not identity)', async () => {
    applyDomainOp.mockImplementation(async (target: DomainTarget) =>
      resultFor({ ...target }, 'ok'),
    );
    const job = startBulk(targets('dynadot', 'a.com'), AUTO_RENEW);
    await stepBulk(job.id);
    await flushWrites();
    const stored = (await store.get('bulk-jobs', 'job')) as {
      inFlight: unknown[];
    };
    expect(stored.inFlight).toEqual([]);
  });

  it('persists the job and reloads it after a "restart"', async () => {
    const job = startBulk(targets('dynadot', 'a.com', 'b.com'), AUTO_RENEW);
    await stepBulk(job.id);
    await flushWrites();

    resetBulkForTests(); // forget memory; the store is the truth now
    expect(getBulkJob()).toMatchObject({ id: job.id, status: 'running' });
    expect(isBulkRunning()).toBe(true);
    vi.setSystemTime(Date.now() + 1000);
    const s = await stepBulk(job.id);
    expect(s.job.status).toBe('done');
    expect(s.job.results.map((r) => r.target.domainName)).toEqual([
      'a.com',
      'b.com',
    ]);
  });

  it('never persists auth codes but keeps them in the session snapshot', async () => {
    applyDomainOp.mockImplementation(async (target: DomainTarget) => ({
      ...resultFor(target, 'ok'),
      data: { authCode: 'SECRET' },
    }));
    const job = startBulk(targets('dynadot', 'a.com'), { kind: 'authCode' });
    const s = await stepBulk(job.id);
    expect(s.job.results[0].data).toEqual({ authCode: 'SECRET' });
    await flushWrites();
    expect(JSON.stringify(await store.list('bulk-jobs'))).not.toContain(
      'SECRET',
    );
  });

  it('cancel marks the remainder cancelled on the next step', async () => {
    const job = startBulk(
      targets('dynadot', 'a.com', 'b.com', 'c.com'),
      AUTO_RENEW,
    );
    await stepBulk(job.id);
    cancelBulk(job.id);
    const s = await stepBulk(job.id);
    expect(s.job.status).toBe('cancelled');
    expect(s.job.counts).toMatchObject({ ok: 1, cancelled: 2 });
    expect(applyDomainOp).toHaveBeenCalledTimes(1);
  });

  it('a concurrent step call joins the slice in flight', async () => {
    let release!: (r: DomainOpResult) => void;
    applyDomainOp.mockImplementation(
      (target: DomainTarget) =>
        new Promise<DomainOpResult>((res) => {
          release = (r) => res(r ?? resultFor(target));
        }),
    );
    const job = startBulk(targets('dynadot', 'a.com', 'b.com'), AUTO_RENEW);
    const p1 = stepBulk(job.id);
    const p2 = stepBulk(job.id);
    release(resultFor({ registrar: 'dynadot', domainName: 'a.com' }));
    const [s1, s2] = await Promise.all([p1, p2]);
    expect(s1).toBe(s2);
    expect(applyDomainOp).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown job id', () => {
    expect(() => stepBulk('nope')).toThrow(/No such bulk job/);
  });

  it('driveBulk steps to completion honoring spacing', async () => {
    const job = startBulk(
      targets('dynadot', 'a.com', 'b.com', 'c.com'),
      AUTO_RENEW,
    );
    const done = driveBulk(job.id);
    await vi.runAllTimersAsync();
    await done;
    expect(getBulkJob()).toMatchObject({ status: 'done', counts: { ok: 3 } });
    expect(Date.now()).toBe(Date.parse('2026-06-01T00:00:00Z') + 2000);
  });
});

describe('abandonInterruptedBulk', () => {
  it('closes out a job left running by a crash, recording the rest as cancelled', async () => {
    setBulkAutoDrive(false);
    const job = startBulk(
      targets('dynadot', 'a.com', 'b.com', 'c.com'),
      AUTO_RENEW,
    );
    await stepBulk(job.id);
    await flushWrites();
    resetBulkForTests();

    abandonInterruptedBulk();
    const after = getBulkJob()!;
    expect(after.status).toBe('cancelled');
    expect(after.counts).toMatchObject({ ok: 1, cancelled: 2 });
    expect(after.results[1].message).toMatch(/Interrupted/);
    expect(isBulkRunning()).toBe(false);
    // Idempotent, and a finished job is left alone.
    abandonInterruptedBulk();
    expect(getBulkJob()!.counts.cancelled).toBe(2);
    // A new job can start afterwards.
    expect(() =>
      startBulk(targets('dynadot', 'z.com'), AUTO_RENEW),
    ).not.toThrow();
  });

  it('accounts for targets that were mid-request when the process died', async () => {
    setBulkAutoDrive(false);
    // The request never returns — the "process" dies with it in flight.
    applyDomainOp.mockImplementation(() => new Promise(() => {}));
    const job = startBulk(targets('dynadot', 'a.com', 'b.com'), AUTO_RENEW);
    void stepBulk(job.id);
    await flushWrites();
    const stored = (await store.get('bulk-jobs', 'job')) as {
      pending: unknown[];
      inFlight: unknown[];
    };
    expect(stored.inFlight).toHaveLength(1);
    expect(stored.pending).toHaveLength(1);

    resetBulkForTests();
    abandonInterruptedBulk();
    const after = getBulkJob()!;
    expect(after.results).toHaveLength(2); // every selected domain reported
    expect(after.results.map((r) => [r.target.domainName, r.message])).toEqual([
      ['a.com', expect.stringMatching(/outcome unknown/)],
      ['b.com', expect.stringMatching(/before this item ran/)],
    ]);
    expect(after.counts.cancelled).toBe(2);
  });

  it('a stepping host (web) reconciles orphans before continuing', async () => {
    setBulkAutoDrive(false);
    applyDomainOp.mockImplementationOnce(() => new Promise(() => {}));
    const job = startBulk(targets('dynadot', 'a.com', 'b.com'), AUTO_RENEW);
    void stepBulk(job.id);
    await flushWrites();
    resetBulkForTests(); // new isolate: nothing in flight here
    vi.setSystemTime(Date.now() + 1000);
    const s = await stepBulk(job.id);
    expect(s.job.results.map((r) => [r.target.domainName, r.status])).toEqual([
      ['a.com', 'cancelled'],
      ['b.com', 'ok'],
    ]);
    expect(s.job.status).toBe('done');
    expect(applyDomainOp).toHaveBeenCalledTimes(2);
  });

  it('is a no-op with no job', () => {
    expect(() => abandonInterruptedBulk()).not.toThrow();
    expect(getBulkJob()).toBeNull();
  });
});
