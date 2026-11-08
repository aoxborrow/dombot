import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MarketListing,
  MarketSale,
  MarketStatsDay,
} from '../../../shared/markets';
import {
  DomainEventSource,
  DomainEventType,
} from '../../../shared/domain-events';
import { MemoryDocStore } from '../../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../../storage/namespace';
import { clearAll, clearRegistrarCaches } from '../cache';
import { listEvents, newEvent, putEvents } from '../domain-events';
import { AFTERNIC_CAPABILITIES } from './afternic';

// A fake market behind the real registry contract.
const fake = {
  listings: [] as MarketListing[],
  complete: true,
  sales: [] as MarketSale[],
  stats: [] as MarketStatsDay[],
  fail: null as Error | null,
  testFails: false,
  /** The [since, until] of each sales read. */
  salesRanges: [] as [string | undefined, string | undefined][],
  /** Afternic filters sales by date; unset, the market reads like Atom. */
  historyFrom: '2000-01-01' as string | undefined,
  /** An error for a sales read, by its range. */
  salesFail: null as ((since?: string, until?: string) => Error | null) | null,
  statsDays: [] as number[],
  asyncInsert: false,
  /** What a single sale read says about the auth code, by sale id. */
  saleCodes: new Map<string, boolean>(),
  saleReads: [] as string[],
  /** Names per call: 1 reads like Atom, one name at a time. */
  writeBatch: AFTERNIC_CAPABILITIES.writeBatch,
  /** The names each getListings call asked for. */
  asked: [] as string[][],
  /**
   * Set, the market takes a listing only once it has verified the name
   * (Dynadot): these names are verified, and each `listVerified` call's
   * names are kept in `listedVerified`.
   */
  verifiedNames: null as Set<string> | null,
  listedVerified: [] as string[][],
};
vi.mock('./registry', async () => {
  const { AFTERNIC_CONFIG_FIELDS } = await import('./afternic');
  const info = {
    id: 'afternic',
    name: 'Afternic',
    configFields: AFTERNIC_CONFIG_FIELDS,
  };
  return {
    isMarketId: (v: unknown) => v === 'afternic',
    marketInfo: () => info,
    buildAdapter: (_market: string, accountId: string) => ({
      market: 'afternic',
      accountId,
      get salesHistoryFrom() {
        return fake.historyFrom;
      },
      get capabilities() {
        return {
          ...AFTERNIC_CAPABILITIES,
          asyncInsert: fake.asyncInsert,
          writeBatch: fake.writeBatch,
        };
      },
      test: async () => {
        if (fake.testFails) throw new Error('Bad key');
        return { listings: fake.listings.length, notes: ['note'] };
      },
      allListings: async () => {
        if (fake.fail) throw fake.fail;
        return {
          listings: fake.listings.map((l) => ({ ...l, accountId })),
          complete: fake.complete,
        };
      },
      getListings: async (names: readonly string[]) => {
        fake.asked.push([...names]);
        if (fake.fail) throw fake.fail;
        return fake.listings
          .filter((l) => names.includes(l.name))
          .map((l) => ({ ...l, accountId }));
      },
      allSales: async (since?: string, until?: string) => {
        fake.salesRanges.push([since, until]);
        const failure = fake.salesFail?.(since, until);
        if (failure) throw failure;
        return fake.sales
          .filter(
            (s) =>
              !s.soldOn ||
              ((!since || s.soldOn >= since) && (!until || s.soldOn < until)),
          )
          .map((s) => ({ ...s, accountId }));
      },
      // The list never says whether Afternic has the auth code; one sale does.
      getSale: async (id: string) => {
        fake.saleReads.push(id);
        const s = fake.sales.find((x) => x.id === id);
        return s
          ? { ...s, accountId, authCodeSent: fake.saleCodes.get(id) ?? false }
          : null;
      },
      accountStats: async (days: number) => {
        fake.statsDays.push(days);
        return fake.stats.map((d) => ({ ...d, accountId }));
      },
      get listVerified() {
        const verified = fake.verifiedNames;
        if (!verified) return undefined;
        return async (rows: readonly MarketListing[]) => {
          fake.listedVerified.push(rows.map((r) => r.name));
          return rows.map((row) => {
            const listed = verified.has(row.name);
            return {
              name: row.name,
              ok: true,
              pending: !listed,
              saved: listed ? { ...row, status: 'active' } : row,
              adjusted: [],
              error: null,
            };
          });
        };
      },
    }),
  };
});
const held = new Set<string>();
vi.mock('../registrars', () => ({
  getCachedPortfolio: () => ({
    domains: [...held].map((domainName) => ({ domainName })),
  }),
}));

const {
  connectMarketAccount,
  marketAccountViews,
  removeMarketAccount,
  setMarketSyncState,
} = await import('./accounts');
const {
  isShownSale,
  marketAccountStats,
  marketListings,
  marketSale,
  marketSales,
  putMarketListings,
  refreshMarketListings,
  syncMarketAccount,
} = await import('./sync');

function listing(name: string): MarketListing {
  return {
    market: 'afternic',
    accountId: '',
    name,
    displayName: null,
    status: 'active',
    statusRaw: 'ACTIVE',
    forSale: true,
    price: '2500',
    buyNow: true,
    minOffer: '100',
    floor: null,
    discount: null,
    currency: 'USD',
    leaseToOwn: null,
    tier: null,
    listedAt: null,
    updatedAt: null,
    extra: {} as MarketListing['extra'],
  };
}

function sale(
  id: string,
  name: string,
  soldOn: string,
  status: MarketSale['status'] = 'completed',
): MarketSale {
  return {
    market: 'afternic',
    accountId: '',
    id,
    name,
    soldOn,
    status,
    statusRaw: 'COMPLETED',
    kind: 'buy_now',
    price: '499',
    commission: '149.7',
    commissionEstimated: false,
    net: '349.3',
    currency: 'USD',
    installments: null,
    // Completed sales are paid out; one without a payout is a purchase.
    paidOutOn: status === 'completed' ? soldOn : null,
    action: null,
  };
}

const ACCOUNT = '00000000-0000-4000-8000-000000000001';
const connect = () =>
  connectMarketAccount(
    'afternic',
    { apiKey: ' k ', apiSecret: 's' },
    '',
    ACCOUNT,
  );
const sold = () => listEvents().filter((e) => e.type === DomainEventType.Sold);

/** The year-at-a-time reads of a whole history, newest first, from `year`. */
function yearsBack(year: number, to = 2000): [string, string | undefined][] {
  const out: [string, string | undefined][] = [];
  for (let y = year; y >= to; y--) {
    out.push([`${y}-01-01`, y === 2026 ? undefined : `${y + 1}-01-01`]);
  }
  return out;
}

beforeEach(async () => {
  await flushWrites().catch(() => {});
  configureStore(new MemoryDocStore());
  await hydrateStores();
  Object.assign(fake, {
    listings: [],
    complete: true,
    sales: [],
    stats: [],
    fail: null,
    testFails: false,
    salesRanges: [],
    historyFrom: '2000-01-01',
    salesFail: null,
    asyncInsert: false,
    statsDays: [],
    saleCodes: new Map(),
    saleReads: [],
    writeBatch: AFTERNIC_CAPABILITIES.writeBatch,
    asked: [],
    verifiedNames: null,
    listedVerified: [],
  });
  held.clear();
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-10-28T12:00:00Z'));
});

describe('market accounts', () => {
  it('tests the key before saving anything', async () => {
    fake.testFails = true;
    await expect(connect()).rejects.toThrow('Bad key');
    expect(marketAccountViews()).toEqual([]);
  });

  it('saves the account, trimmed credentials and what the test found', async () => {
    fake.listings = [listing('example.com')];
    const view = await connect();
    expect(view).toMatchObject({
      id: ACCOUNT,
      market: 'afternic',
      label: 'Afternic',
      enabled: true,
      configured: true,
      sync: { listings: 1, lastError: null, notes: ['note'] },
    });
  });
});

describe('syncMarketAccount', () => {
  it('stores listings, replacing names that left', async () => {
    await connect();
    fake.listings = [listing('a.com'), listing('b.com')];
    await syncMarketAccount(ACCOUNT);
    fake.listings = [listing('b.com')];
    await syncMarketAccount(ACCOUNT);
    expect(marketListings().map((l) => l.name)).toEqual(['b.com']);
    expect(marketAccountViews()[0].sync).toMatchObject({
      listings: 1,
      incomplete: false,
    });
  });

  it('keeps every name when the read may be torn', async () => {
    await connect();
    fake.listings = [listing('a.com'), listing('b.com')];
    await syncMarketAccount(ACCOUNT);
    fake.listings = [listing('b.com')];
    fake.complete = false;
    await syncMarketAccount(ACCOUNT);
    expect(
      marketListings()
        .map((l) => l.name)
        .sort(),
    ).toEqual(['a.com', 'b.com']);
    expect(marketAccountViews()[0].sync?.incomplete).toBe(true);
  });

  it('records a failure on the account and keeps what it had', async () => {
    await connect();
    fake.listings = [listing('a.com')];
    await syncMarketAccount(ACCOUNT);
    fake.fail = new Error('Afternic is down');
    await syncMarketAccount(ACCOUNT);
    expect(marketListings()).toHaveLength(1);
    expect(marketAccountViews()[0].sync?.lastError).toBe(
      'Afternic: Afternic is down',
    );
  });

  it('reads the history a year at a time once, then a window back from the newest', async () => {
    await connect();
    fake.sales = [
      sale('t1', 'gone.com', '2026-10-01'),
      sale('t0', 'old.com', '2003-02-03'),
    ];
    await syncMarketAccount(ACCOUNT);
    expect(fake.salesRanges).toEqual(yearsBack(2026));
    expect(marketAccountViews()[0].sync?.salesRead).toEqual({
      from: '2000-01-01',
      to: '2026-10-28',
    });
    fake.salesRanges = [];
    await syncMarketAccount(ACCOUNT);
    expect(fake.salesRanges).toEqual([['2026-08-17', undefined]]);
    expect(marketSales().map((s) => s.id)).toEqual(['t1', 't0']);
  });

  it('reads all sales once on a market that takes no dates', async () => {
    fake.historyFrom = undefined;
    await connect();
    fake.sales = [sale('t1', 'gone.com', '2026-10-01')];
    await syncMarketAccount(ACCOUNT);
    await syncMarketAccount(ACCOUNT);
    expect(fake.salesRanges).toEqual([
      [undefined, undefined],
      ['2026-08-17', undefined],
    ]);
    expect(marketSales()).toHaveLength(1);
    expect(marketAccountViews()[0].sync?.salesRead).toBeUndefined();
  });

  it('pauses the history at a year that fails, and carries on from there', async () => {
    await connect();
    fake.listings = [listing('a.com')];
    fake.sales = [
      sale('t3', 'new.com', '2026-10-01'),
      sale('t2', 'mid.com', '2024-06-01'),
      sale('t1', 'old.com', '2021-03-04'),
    ];
    fake.salesFail = (since) =>
      since === '2023-01-01'
        ? new Error('Afternic did not respond in time.')
        : null;
    await syncMarketAccount(ACCOUNT);
    // The years before it failed are kept, and so is the rest of the sync.
    expect(marketSales().map((s) => s.id)).toEqual(['t3', 't2']);
    expect(fake.statsDays).toEqual([365]);
    const paused = marketAccountViews()[0].sync;
    expect(paused).toMatchObject({
      lastError: null,
      listings: 1,
      salesRead: { from: '2024-01-01', to: '2026-10-28' },
    });
    expect(paused?.notes).toContain(
      'Sales history read back to 2024, then paused: Afternic did not respond in time. The next sync carries on.',
    );

    fake.salesFail = null;
    fake.salesRanges = [];
    vi.setSystemTime(Date.parse('2026-10-29T12:00:00Z'));
    await syncMarketAccount(ACCOUNT);
    expect(fake.salesRanges).toEqual([
      ['2026-08-17', undefined],
      ...yearsBack(2023),
    ]);
    expect(marketSales().map((s) => s.id)).toEqual(['t3', 't2', 't1']);
    const done = marketAccountViews()[0].sync;
    expect(done?.salesRead).toEqual({ from: '2000-01-01', to: '2026-10-29' });
    expect(done?.notes.some((n) => n.startsWith('Sales history'))).toBe(false);
  });

  it('keeps the history read so far when the whole sync fails', async () => {
    await connect();
    fake.sales = [sale('t1', 'gone.com', '2026-10-01')];
    fake.salesFail = (since) =>
      since === '2025-01-01'
        ? new Error('Afternic did not respond in time.')
        : null;
    await syncMarketAccount(ACCOUNT);
    fake.fail = new Error('Afternic is down');
    await syncMarketAccount(ACCOUNT);
    expect(marketAccountViews()[0].sync).toMatchObject({
      lastError: 'Afternic: Afternic is down',
      salesRead: { from: '2026-01-01', to: '2026-10-28' },
    });
  });

  it('starts the history over while a failing first year has found nothing', async () => {
    await connect();
    fake.salesFail = () => new Error('Afternic did not respond in time.');
    await syncMarketAccount(ACCOUNT);
    expect(fake.salesRanges).toEqual([['2026-01-01', undefined]]);
    expect(marketAccountViews()[0].sync?.notes).toContain(
      'Sales history paused: Afternic did not respond in time. The next sync carries on.',
    );
    fake.salesFail = null;
    fake.salesRanges = [];
    await syncMarketAccount(ACCOUNT);
    expect(fake.salesRanges).toEqual(yearsBack(2026));
  });

  it('reads from the last read on an account with no sales at all', async () => {
    await connect();
    await syncMarketAccount(ACCOUNT);
    fake.salesRanges = [];
    vi.setSystemTime(Date.parse('2026-12-20T12:00:00Z'));
    await syncMarketAccount(ACCOUNT);
    expect(fake.salesRanges).toEqual([['2026-10-28', undefined]]);
    expect(marketAccountViews()[0].sync?.salesRead).toEqual({
      from: '2000-01-01',
      to: '2026-12-20',
    });
  });

  it('treats an account synced before the yearly reads as read in full', async () => {
    fake.historyFrom = undefined;
    await connect();
    fake.sales = [sale('t1', 'gone.com', '2026-10-01')];
    await syncMarketAccount(ACCOUNT);
    fake.historyFrom = '2000-01-01';
    fake.salesRanges = [];
    await syncMarketAccount(ACCOUNT);
    expect(fake.salesRanges).toEqual([['2026-08-17', undefined]]);
    expect(marketAccountViews()[0].sync?.salesRead).toEqual({
      from: '2000-01-01',
      to: '2026-10-28',
    });
  });

  it('reads sales under way one by one until the market has the auth code', async () => {
    await connect();
    fake.sales = [
      {
        ...sale('t1', 'sold.com', '2026-10-27', 'in_progress'),
        action: 'auth_code',
      },
      sale('t2', 'done.com', '2026-10-01'),
    ];
    await syncMarketAccount(ACCOUNT);
    expect(fake.saleReads).toEqual(['t1']);
    expect(marketSale(ACCOUNT, 't1')?.authCodeSent).toBe(false);

    // The code went in (from anywhere): the list moves on and still doesn't
    // say, the single read does.
    fake.sales[0] = { ...fake.sales[0], action: 'transfer' };
    fake.saleCodes.set('t1', true);
    await syncMarketAccount(ACCOUNT);
    expect(marketSale(ACCOUNT, 't1')).toMatchObject({
      action: 'transfer',
      authCodeSent: true,
    });

    // Known now, so the list's silence keeps it and no more reads.
    await syncMarketAccount(ACCOUNT);
    expect(fake.saleReads).toEqual(['t1', 't1']);
    expect(marketSale(ACCOUNT, 't1')?.authCodeSent).toBe(true);
  });

  it('joins a sync already under way instead of reading twice', async () => {
    await connect();
    fake.sales = [sale('t1', 'gone.com', '2026-10-01')];
    const first = syncMarketAccount(ACCOUNT);
    expect(syncMarketAccount(ACCOUNT)).toBe(first);
    await first;
    expect(fake.salesRanges).toEqual(yearsBack(2026));
    // Once it's done, the next one runs.
    fake.salesRanges = [];
    await syncMarketAccount(ACCOUNT);
    expect(fake.salesRanges).toEqual([['2026-08-17', undefined]]);
  });

  it('reads a year of stats first, then a week, merged by day', async () => {
    await connect();
    const day = (date: string, views: number) =>
      ({ date, views, leads: 0, source: 'market' }) as MarketStatsDay;
    fake.stats = [day('2026-10-26', 1), day('2026-10-27', 2)];
    await syncMarketAccount(ACCOUNT);
    fake.stats = [day('2026-10-27', 5), day('2026-10-28', 3)];
    await syncMarketAccount(ACCOUNT);
    expect(fake.statsDays).toEqual([365, 7]);
    expect(marketAccountStats(ACCOUNT).map((d) => [d.date, d.views])).toEqual([
      ['2026-10-26', 1],
      ['2026-10-27', 5],
      ['2026-10-28', 3],
    ]);
  });

  it('keeps listings when only registrar caches are cleared', async () => {
    await connect();
    fake.listings = [listing('a.com')];
    await syncMarketAccount(ACCOUNT);
    // What launch does when no registrar is configured.
    clearRegistrarCaches();
    expect(marketListings()).toHaveLength(1);
    // "Clear cache": the next sync refetches them.
    clearAll();
    expect(marketListings()).toHaveLength(0);
  });

  it('removing an account drops its listings and keeps its sales', async () => {
    await connect();
    fake.listings = [listing('a.com')];
    fake.sales = [sale('t1', 'gone.com', '2026-10-01')];
    await syncMarketAccount(ACCOUNT);
    await removeMarketAccount(ACCOUNT);
    expect(marketAccountViews()).toEqual([]);
    expect(marketListings()).toEqual([]);
    expect(marketSales()).toHaveLength(1);
    expect(sold()).toHaveLength(1);
  });
});

describe('reconnecting an account', () => {
  const AGAIN = '00000000-0000-4000-8000-000000000002';
  const reconnect = () =>
    connectMarketAccount(
      'afternic',
      { apiKey: 'k', apiSecret: 's' },
      '',
      AGAIN,
    );

  it('keeps one sale and one sold event, relinked to the new account', async () => {
    await connect();
    fake.sales = [sale('t1', 'gone.com', '2026-10-01')];
    await syncMarketAccount(ACCOUNT);
    await removeMarketAccount(ACCOUNT);
    await reconnect();
    await syncMarketAccount(AGAIN);
    expect(marketSales()).toEqual([
      expect.objectContaining({ accountId: AGAIN, id: 't1' }),
    ]);
    expect(sold()).toEqual([
      expect.objectContaining({
        domain: 'gone.com',
        marketSale: `${AGAIN}:t1`,
      }),
    ]);
  });

  it('finds the old sale even when a later sync reads only a window back', async () => {
    await connect();
    fake.sales = [
      sale('old', 'gone.com', '2021-05-04'),
      sale('new', 'recent.com', '2026-10-01'),
    ];
    await syncMarketAccount(ACCOUNT);
    await removeMarketAccount(ACCOUNT);
    await reconnect();
    // An earlier build's first sync wrote both under the new id; a later
    // one only reads recent sales.
    await syncMarketAccount(AGAIN);
    fake.sales = [sale('new', 'recent.com', '2026-10-01')];
    await syncMarketAccount(AGAIN);
    expect(
      marketSales()
        .map((s) => `${s.accountId === AGAIN ? 'new' : 'old'}:${s.id}`)
        .sort(),
    ).toEqual(['new:new', 'new:old']);
  });

  it('folds sold events already written twice into one', async () => {
    await connect();
    fake.sales = [sale('t1', 'gone.com', '2026-10-01')];
    await syncMarketAccount(ACCOUNT);
    // As an earlier build left it: a second event for the same sale under
    // the new account, the old account's event and record still there.
    await removeMarketAccount(ACCOUNT);
    await reconnect();
    putEvents([
      newEvent({
        domain: 'gone.com',
        type: DomainEventType.Sold,
        source: DomainEventSource.Sync,
        date: '2026-10-01',
        amount: '499.00',
        currency: 'USD',
        marketSale: `${AGAIN}:t1`,
      }),
    ]);
    expect(sold()).toHaveLength(2);
    await syncMarketAccount(AGAIN);
    expect(sold()).toEqual([
      expect.objectContaining({ marketSale: `${AGAIN}:t1` }),
    ]);
    expect(marketSales()).toHaveLength(1);
  });
});

describe('sales as sold events', () => {
  it('writes one sold event per completed sale, once', async () => {
    await connect();
    fake.sales = [
      sale('t1', 'gone.com', '2021-05-04'),
      sale('t2', 'moving.com', '2026-10-20', 'in_progress'),
    ];
    await syncMarketAccount(ACCOUNT);
    await syncMarketAccount(ACCOUNT);
    expect(sold()).toEqual([
      expect.objectContaining({
        domain: 'gone.com',
        source: DomainEventSource.Sync,
        date: '2021-05-04',
        amount: '499.00',
        currency: 'USD',
        marketSale: `${ACCOUNT}:t1`,
      }),
    ]);
  });

  it("doesn't archive a name you hold again after an old sale", async () => {
    held.add('dns.tools');
    held.add('fresh.com');
    await connect();
    fake.sales = [
      sale('old', 'dns.tools', '2021-05-04'),
      sale('new', 'fresh.com', '2026-10-08'),
    ];
    await syncMarketAccount(ACCOUNT);
    expect(sold().map((e) => e.domain)).toEqual(['fresh.com']);
  });

  it("doesn't record a sale you've bought the name back since", async () => {
    putEvents([
      newEvent({
        domain: 'back.com',
        type: DomainEventType.Purchased,
        source: DomainEventSource.User,
        date: '2023-01-01',
      }),
    ]);
    await connect();
    fake.sales = [sale('t1', 'back.com', '2022-06-01')];
    await syncMarketAccount(ACCOUNT);
    expect(sold()).toEqual([]);
  });

  it('answers a removal sync wrote before it knew of the sale under way', async () => {
    putEvents([
      newEvent({
        domain: 'going.com',
        type: DomainEventType.Removed,
        source: DomainEventSource.Sync,
        accountId: 'dynadot',
        date: '2026-10-27',
      }),
      newEvent({
        domain: 'left.com',
        type: DomainEventType.Removed,
        source: DomainEventSource.Sync,
        accountId: 'dynadot',
        date: '2026-10-27',
      }),
    ]);
    await connect();
    fake.sales = [
      // Still at the transfer: no sold event yet, so the removal is answered.
      {
        ...sale('t1', 'going.com', '2026-10-26', 'in_progress'),
        action: 'transfer',
      },
    ];
    await syncMarketAccount(ACCOUNT);
    const removal = (name: string) =>
      listEvents().find((e) => e.domain === name && e.type === 'removed');
    expect(removal('going.com')?.dismissed).toBe(true);
    // No sale: still one to review.
    expect(removal('left.com')?.dismissed).toBeUndefined();
    // Under way, so no sold event yet.
    expect(sold()).toEqual([]);
  });

  it('records a sale once its name has moved, not a purchase or a name you hold', async () => {
    const left = (domain: string) =>
      newEvent({
        domain,
        type: DomainEventType.Removed,
        source: DomainEventSource.Sync,
        accountId: 'dynadot',
        date: '2026-10-27',
        dismissed: true,
      });
    putEvents([left('moved.com'), left('kept.com')]);
    held.add('kept.com');
    await connect();
    const payout = (id: string, name: string) => ({
      ...sale(id, name, '2026-10-26', 'in_progress'),
      action: 'payout' as const,
    });
    fake.sales = [
      payout('t1', 'moved.com'),
      // A purchase in the market's sales: it never left your accounts.
      payout('t2', 'bought.com'),
      // Back in an account (or never gone): not the buyer's yet.
      payout('t3', 'kept.com'),
    ];
    await syncMarketAccount(ACCOUNT);
    expect(sold().map((e) => [e.domain, e.date, e.source])).toEqual([
      ['moved.com', '2026-10-26', 'sync'],
    ]);
  });

  it('links your own sale of the name and fills in its price', async () => {
    putEvents([
      newEvent({
        domain: 'mine.com',
        type: DomainEventType.Sold,
        source: DomainEventSource.User,
        date: '2026-10-10',
        amount: null,
        currency: null,
      }),
    ]);
    await connect();
    fake.sales = [sale('t1', 'mine.com', '2026-10-08')];
    await syncMarketAccount(ACCOUNT);
    expect(sold()).toEqual([
      expect.objectContaining({
        source: DomainEventSource.User,
        date: '2026-10-10',
        amount: '499.00',
        marketSale: `${ACCOUNT}:t1`,
      }),
    ]);
  });

  it('answers the name’s open removed alert', async () => {
    const removed = newEvent({
      domain: 'left.com',
      type: DomainEventType.Removed,
      source: DomainEventSource.Sync,
      date: '2026-10-12',
    });
    putEvents([removed]);
    await connect();
    fake.sales = [sale('t1', 'left.com', '2026-10-08')];
    await syncMarketAccount(ACCOUNT);
    expect(sold()[0].resolves).toBe(removed.id);
  });
});

describe('listings a market is still checking', () => {
  const DAY = 86_400_000;
  const pending = (name: string, daysAgo: number): MarketListing => ({
    ...listing(name),
    accountId: ACCOUNT,
    status: 'pending',
    listedAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
  });

  it('keeps a pending insert the market doesn’t list yet, for a week', async () => {
    fake.asyncInsert = true;
    await connect();
    fake.listings = [listing('live.com')];
    putMarketListings(ACCOUNT, [pending('new.com', 2), pending('old.com', 9)]);
    await syncMarketAccount(ACCOUNT);
    expect(
      marketListings()
        .map((l) => [l.name, l.status])
        .sort(),
    ).toEqual([
      ['live.com', 'active'],
      ['new.com', 'pending'],
    ]);
    const note = marketAccountViews()[0].sync?.notes.find((n) =>
      n.startsWith('Not listed after a week'),
    );
    expect(note).toMatch(/1 name DomBot sent/);
  });

  it('replaces the pending row once the market lists the name', async () => {
    fake.asyncInsert = true;
    await connect();
    putMarketListings(ACCOUNT, [pending('new.com', 1)]);
    fake.listings = [listing('new.com')];
    await syncMarketAccount(ACCOUNT);
    expect(marketListings().map((l) => l.status)).toEqual(['active']);
  });

  it('keeps a name pending while the market lists it but not for sale', async () => {
    fake.asyncInsert = true;
    await connect();
    putMarketListings(ACCOUNT, [pending('new.com', 1)]);
    fake.listings = [{ ...listing('new.com'), forSale: false }];
    await syncMarketAccount(ACCOUNT);
    // It keeps the for-sale choice it was listed with, so a later sync
    // still holds it while the market keeps it off sale.
    expect(marketListings()[0]).toMatchObject({
      status: 'pending',
      forSale: true,
    });
    await syncMarketAccount(ACCOUNT);
    expect(marketListings()[0]).toMatchObject({
      status: 'pending',
      forSale: true,
    });
    expect(marketAccountViews()[0].sync?.notes).toContainEqual(
      expect.stringMatching(
        /^Waiting on ownership checks: 1 name DomBot listed/,
      ),
    );

    // Once the market puts it up for sale, it's an ordinary listing.
    fake.listings = [listing('new.com')];
    await syncMarketAccount(ACCOUNT);
    expect(marketListings()[0]).toMatchObject({ status: 'active' });
    expect(
      marketAccountViews()[0].sync?.notes.some((n) =>
        n.startsWith('Waiting on ownership checks'),
      ),
    ).toBe(false);
  });

  it('leaves a name the seller took off sale alone', async () => {
    fake.asyncInsert = true;
    await connect();
    putMarketListings(ACCOUNT, [
      { ...listing('parked.com'), accountId: ACCOUNT, forSale: false },
    ]);
    fake.listings = [{ ...listing('parked.com'), forSale: false }];
    await syncMarketAccount(ACCOUNT);
    expect(marketListings()[0].status).toBe('active');
  });

  it('lists pending names once the market has verified them, and holds the rest', async () => {
    fake.asyncInsert = true;
    fake.verifiedNames = new Set(['ready.com']);
    await connect();
    fake.listings = [listing('live.com')];
    // Still waiting after more than a week: the market says why.
    putMarketListings(ACCOUNT, [
      pending('ready.com', 1),
      pending('wait.com', 9),
    ]);
    await syncMarketAccount(ACCOUNT);
    expect(fake.listedVerified).toEqual([['ready.com', 'wait.com']]);
    expect(
      marketListings()
        .map((l) => [l.name, l.status])
        .sort(),
    ).toEqual([
      ['live.com', 'active'],
      ['ready.com', 'active'],
      ['wait.com', 'pending'],
    ]);
    const notes = marketAccountViews()[0].sync?.notes ?? [];
    expect(notes).toContainEqual(
      expect.stringMatching(/^Waiting on ownership checks: 1 name/),
    );
    expect(notes.some((n) => n.startsWith('Not listed after a week'))).toBe(
      false,
    );
  });

  it('drops pending rows on markets that list names straight away', async () => {
    await connect();
    putMarketListings(ACCOUNT, [pending('new.com', 1)]);
    await syncMarketAccount(ACCOUNT);
    expect(marketListings()).toEqual([]);
  });
});

describe('refreshMarketListings', () => {
  const stored = (name: string, patch: Partial<MarketListing> = {}) => ({
    ...listing(name),
    accountId: ACCOUNT,
    ...patch,
  });
  const names = () =>
    marketListings()
      .map((l) => [l.name, l.price, l.status])
      .sort();

  it('stores what the market lists for the names, drops what it no longer does, and leaves other names alone', async () => {
    await connect();
    putMarketListings(ACCOUNT, [
      stored('a.com'),
      stored('b.com'),
      stored('other.com'),
    ]);
    fake.listings = [{ ...listing('a.com'), price: '9000' }];
    expect(await refreshMarketListings(['a.com', 'b.com'])).toEqual({
      failed: [],
    });
    expect(fake.asked).toEqual([['a.com', 'b.com']]);
    expect(names()).toEqual([
      ['a.com', '9000', 'active'],
      ['other.com', '2500', 'active'],
    ]);
  });

  it('picks up a name listed on the market’s site', async () => {
    await connect();
    fake.listings = [listing('new.com')];
    await refreshMarketListings(['NEW.com']);
    expect(names()).toEqual([['new.com', '2500', 'active']]);
  });

  it('keeps a pending insert the market doesn’t list yet', async () => {
    fake.asyncInsert = true;
    await connect();
    putMarketListings(ACCOUNT, [stored('new.com', { status: 'pending' })]);
    await refreshMarketListings(['new.com']);
    expect(names()).toEqual([['new.com', '2500', 'pending']]);
  });

  it('asks only for names it lists when the market reads one name a call', async () => {
    fake.writeBatch = 1;
    await connect();
    putMarketListings(ACCOUNT, [stored('a.com')]);
    fake.listings = [listing('a.com')];
    await refreshMarketListings(['a.com', 'b.com']);
    expect(fake.asked).toEqual([['a.com']]);
    await refreshMarketListings(['b.com']);
    expect(fake.asked).toHaveLength(1);
  });

  it('keeps an account’s rows when it can’t be read, and names it', async () => {
    await connect();
    putMarketListings(ACCOUNT, [stored('a.com')]);
    fake.fail = new Error('Down');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await refreshMarketListings(['a.com'])).toEqual({
      failed: ['Afternic'],
    });
    expect(names()).toEqual([['a.com', '2500', 'active']]);
  });
});

describe('purchases in the sales list', () => {
  it('leaves out completed sales with no payout, and undoes their sold events', async () => {
    await connect();
    const bought = {
      ...sale('p1', 'bought.com', '2022-04-28'),
      paidOutOn: null,
    };
    // A sync from before the rule recorded it as sold.
    putEvents([
      newEvent({
        domain: 'bought.com',
        type: DomainEventType.Sold,
        source: DomainEventSource.Sync,
        date: '2022-04-28',
        amount: '4995.00',
        currency: 'USD',
        marketSale: `${ACCOUNT}:p1`,
      }),
    ]);
    fake.sales = [bought, sale('t1', 'sold.com', '2021-05-04')];
    await syncMarketAccount(ACCOUNT);
    expect(marketSales().map((s) => s.name)).toEqual(['sold.com']);
    expect(sold().map((e) => e.domain)).toEqual(['sold.com']);
    expect(marketAccountViews()[0].sync?.sales).toBe(1);
  });

  it('keeps leases and sales still under way, which have no payout yet', async () => {
    await connect();
    fake.sales = [
      {
        ...sale('l1', 'lease.com', '2024-11-19'),
        kind: 'lease',
        paidOutOn: null,
      },
      sale('w1', 'waiting.com', '2026-10-20', 'in_progress'),
    ];
    await syncMarketAccount(ACCOUNT);
    expect(
      marketSales()
        .map((s) => s.name)
        .sort(),
    ).toEqual(['lease.com', 'waiting.com']);
  });

  it('only reads Afternic’s list that way: SellerHub’s has no payout dates', () => {
    const checkoutLink: MarketSale = {
      ...sale('s1', 'sold.com', '2026-10-02'),
      market: 'spaceship',
      paidOutOn: null,
    };
    expect(isShownSale(checkoutLink)).toBe(true);
    expect(isShownSale({ ...checkoutLink, market: 'afternic' })).toBe(false);
  });
});

describe('account status on the card', () => {
  it('flags Discount Domain Club Domain Pro from the listings, and drops the old note', async () => {
    await connect();
    setMarketSyncState(ACCOUNT, {
      ...marketAccountViews()[0].sync!,
      notes: [
        'No search data on this account (Discount Domain Club Domain Pro only).',
        'note',
      ],
    });
    fake.listings = [listing('plain.com')];
    await syncMarketAccount(ACCOUNT);
    let sync = marketAccountViews()[0].sync!;
    expect(sync.status).toEqual([
      { label: 'Discount Domain Club Domain Pro', on: false },
    ]);
    expect(sync.notes).toEqual(['note']);

    fake.listings = [
      {
        ...listing('searched.com'),
        extra: {
          market: 'afternic',
          searches: { total: {}, unique: {} },
        } as unknown as MarketListing['extra'],
      },
    ];
    await syncMarketAccount(ACCOUNT);
    sync = marketAccountViews()[0].sync!;
    expect(sync.status).toEqual([
      { label: 'Discount Domain Club Domain Pro', on: true },
    ]);
  });
});
