import { beforeEach, describe, expect, it } from 'vitest';
import type { MarketListing, MarketStatsDay } from '../../../shared/markets';
import { MemoryDocStore } from '../../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../../storage/namespace';
import type { AnyMarketAdapter } from './registry';
import {
  searchHistory,
  snapshotSearches,
  syncDomainTraffic,
  trafficQueue,
  trafficTotals,
} from './traffic';

const A = 'acct';
const listing = (name: string, searches30?: number): MarketListing =>
  ({
    name,
    extra: {
      market: 'afternic',
      searches:
        searches30 === undefined
          ? null
          : {
              total: { days30: searches30, days90: null, days365: null },
              unique: { days30: 1, days90: null, days365: null },
            },
    },
  }) as MarketListing;

/** A fake adapter whose stats are `views` on the given days, and records calls. */
function adapter(
  byName: Record<string, Record<string, number>>,
  failOn?: string,
) {
  const calls: [string, number][] = [];
  const fake = {
    accountId: A,
    domainStats: async (name: string, days: number) => {
      calls.push([name, days]);
      if (name === failOn) throw new Error('Too many requests');
      return Object.entries(byName[name] ?? {}).map(
        ([date, views]) =>
          ({ date, views, leads: views > 5 ? 1 : 0 }) as MarketStatsDay,
      );
    },
  } as unknown as AnyMarketAdapter;
  return { fake, calls };
}

const NOW = Date.parse('2026-10-28T12:00:00');
const HOUR = 3_600_000;

beforeEach(async () => {
  await flushWrites().catch(() => {});
  configureStore(new MemoryDocStore());
  await hydrateStores();
});

describe('syncDomainTraffic', () => {
  it('fetches a year first, then a week, keeping only days with traffic', async () => {
    const { fake, calls } = adapter({
      'a.com': { '2026-10-01': 3, '2026-10-02': 0, '2026-10-27': 8 },
    });
    await syncDomainTraffic(fake, [listing('a.com')], 10, NOW);
    await syncDomainTraffic(fake, [listing('a.com')], 10, NOW + 21 * HOUR);
    expect(calls).toEqual([
      ['a.com', 365],
      ['a.com', 7],
    ]);
    expect(trafficTotals(new Set([A]), 30, '2026-10-28')).toEqual(
      new Map([['a.com', { views: 11, leads: 1, known: true }]]),
    );
    expect(trafficTotals(new Set([A]), 7, '2026-10-28').get('a.com')).toEqual({
      views: 8,
      leads: 1,
      known: true,
    });
  });

  it('takes never-fetched names first, then the stalest, within the budget', async () => {
    const { fake } = adapter({});
    await syncDomainTraffic(fake, [listing('old.com')], 10, NOW - 48 * HOUR);
    await syncDomainTraffic(fake, [listing('mid.com')], 10, NOW - 30 * HOUR);
    const names = ['mid.com', 'new.com', 'old.com', 'fresh.com'].map((n) =>
      listing(n),
    );
    await syncDomainTraffic(fake, [listing('fresh.com')], 10, NOW - HOUR);
    expect(trafficQueue(A, names, 3, NOW)).toEqual([
      'new.com',
      'old.com',
      'mid.com',
    ]);
  });

  it('stops at an error and keeps what it fetched', async () => {
    const { fake, calls } = adapter({ 'a.com': { '2026-10-27': 1 } }, 'b.com');
    const result = await syncDomainTraffic(
      fake,
      ['a.com', 'b.com', 'c.com'].map((n) => listing(n)),
      10,
      NOW,
    );
    expect(result).toEqual({ fetched: 1, error: 'Too many requests' });
    expect(calls.map(([n]) => n)).toEqual(['a.com', 'b.com']);
    // b.com wasn't recorded, so it's first next time.
    expect(
      trafficQueue(A, [listing('a.com'), listing('b.com')], 5, NOW),
    ).toEqual(['b.com']);
  });
});

describe('syncDomainTraffic with snapshot counters (Atom)', () => {
  it('takes the first read as a baseline, then a day’s views from the difference', async () => {
    const totals = [100, 130, 130];
    let read = 0;
    const fake = {
      accountId: A,
      capabilities: { domainStats: 'snapshot' },
      domainCounters: async (name: string) => ({
        name,
        views: totals[read++],
        shortlists: 2,
        trackers: 1,
      }),
    } as unknown as AnyMarketAdapter;
    await syncDomainTraffic(fake, [listing('a.com')], 10, NOW);
    expect(trafficTotals(new Set([A]), 30, '2026-10-28').get('a.com')).toEqual({
      views: 0,
      leads: 0,
      known: true,
    });
    await syncDomainTraffic(fake, [listing('a.com')], 10, NOW + 21 * HOUR);
    await syncDomainTraffic(fake, [listing('a.com')], 10, NOW + 42 * HOUR);
    expect(trafficTotals(new Set([A]), 30, '2026-10-30').get('a.com')).toEqual({
      views: 30,
      leads: 0,
      known: true,
    });
  });
});

describe('snapshotSearches', () => {
  it('keeps a weekly snapshot for names with search data', () => {
    const names = [listing('a.com', 40), listing('b.com')];
    snapshotSearches(A, names, '2026-10-01');
    snapshotSearches(A, [listing('a.com', 55)], '2026-10-05');
    snapshotSearches(A, [listing('a.com', 60)], '2026-10-08');
    expect(
      searchHistory(A, 'a.com').map((s) => [s.date, s.counts.total.days30]),
    ).toEqual([
      ['2026-10-01', 40],
      ['2026-10-08', 60],
    ]);
    expect(searchHistory(A, 'b.com')).toEqual([]);
  });
});
