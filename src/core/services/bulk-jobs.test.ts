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
  cancelBulk,
  getBulkJob,
  isBulkRunning,
  startBulk,
} from './bulk-jobs';

const AUTO_RENEW: DomainOp = { kind: 'autoRenew', enabled: true };
const targets = (registrar: DomainTarget['registrar'], ...names: string[]) =>
  names.map((domainName) => ({ registrar, domainName }));

// A canned result for a target, defaulting to ok.
const resultFor = (
  target: DomainTarget,
  status: DomainOpStatus = 'ok',
): DomainOpResult => ({ target, status, message: status });

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(broadcastBulkProgress.mock.calls.every((c) => c[0].total === 3)).toBe(
      true,
    );
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
    startBulk(targets('dynadot', 'a.com', 'b.com', 'c.com', 'd.com'), AUTO_RENEW);
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
