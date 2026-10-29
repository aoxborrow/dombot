import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MarketListing, MarketSale } from '../../shared/markets';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { AFTERNIC_CAPABILITIES } from '../services/markets/afternic';

// A fake market behind the real storage and sync, so the tools read what a
// real sync would have stored.
const fake = {
  listings: [] as MarketListing[],
  sales: [] as MarketSale[],
  domainStatsFor: [] as string[],
  writes: [] as unknown[],
  messages: [] as [string, string][],
  defaults: [] as unknown[],
  /** Names per write call; 1 makes the fake behave like Atom for bulk. */
  writeBatch: 500,
};
vi.mock('../services/markets/registry', async () => {
  const { AFTERNIC_CONFIG_FIELDS } =
    await import('../services/markets/afternic');
  const info = {
    id: 'afternic',
    name: 'Afternic',
    configFields: AFTERNIC_CONFIG_FIELDS,
    capabilities: AFTERNIC_CAPABILITIES,
  };
  return {
    isMarketId: (v: unknown) => v === 'afternic',
    marketInfo: () => info,
    buildAdapter: (_m: string, accountId: string) => ({
      market: 'afternic',
      accountId,
      capabilities: { ...AFTERNIC_CAPABILITIES, writeBatch: fake.writeBatch },
      test: async () => ({ listings: 0, notes: [] }),
      allListings: async () => ({
        listings: fake.listings.map((l) => ({ ...l, accountId })),
        complete: true,
      }),
      allSales: async () => fake.sales.map((s) => ({ ...s, accountId })),
      accountStats: async () => [
        { date: '2026-10-27', views: 4, leads: 1, source: 'market' },
        { date: '2026-10-28', views: 6, leads: 0, source: 'market' },
      ],
      domainStats: async (name: string) => {
        fake.domainStatsFor.push(name);
        return [{ date: '2026-10-28', views: 2, leads: 1, source: 'market' }];
      },
      getListingDefaults: async () => ({ maxLeasePeriod: 60 }),
      setListingDefaults: async (settings: unknown) => {
        fake.defaults.push(settings);
      },
      writeListings: async (changes: { name: string; price?: string }[]) => {
        fake.writes.push(changes);
        return changes.map((c) => ({
          name: c.name,
          ok: true,
          pending: true,
          saved: null,
          adjusted:
            c.name === 'capped.com'
              ? [{ field: 'leaseToOwn.maxPayments', asked: 36, saved: 12 }]
              : [],
          error: null,
        }));
      },
      deleteListings: async (names: string[]) =>
        names.map((name) => ({
          name,
          ok: true,
          pending: false,
          saved: null,
          adjusted: [],
          error: null,
        })),
      sendSaleMessage: async (saleId: string, message: string) => {
        fake.messages.push([saleId, message]);
      },
    }),
  };
});
vi.mock('../services/registrars', () => ({
  getCachedPortfolio: () => ({ domains: [] }),
}));

const { connectMarketAccount } = await import('../services/markets/accounts');
const { syncMarketAccount } = await import('../services/markets/sync');
const { registerMarketTools } = await import('./market-tools');

type Handler = (args: unknown) => Promise<{ content: { text: string }[] }>;
const tools = new Map<string, Handler>();
registerMarketTools({
  registerTool: (name: string, _config: unknown, handler: Handler) => {
    tools.set(name, handler);
  },
} as unknown as McpServer);

async function call(name: string, args: unknown = {}) {
  const res = await tools.get(name)!(args);
  return JSON.parse(res.content[0].text);
}

function listing(
  name: string,
  price: string | null,
  status: MarketListing['status'] = 'active',
): MarketListing {
  return {
    market: 'afternic',
    accountId: '',
    name,
    displayName: null,
    status,
    statusRaw: status.toUpperCase(),
    forSale: true,
    price,
    buyNow: price != null,
    minOffer: '100',
    floor: null,
    discount: null,
    currency: 'USD',
    leaseToOwn: null,
    tier: null,
    listedAt: null,
    updatedAt: null,
    extra: { searches: null } as MarketListing['extra'],
  };
}

function sale(id: string, name: string, soldOn: string, price: string) {
  return {
    market: 'afternic',
    accountId: '',
    id,
    name,
    soldOn,
    status: 'completed',
    statusRaw: 'COMPLETED',
    kind: 'buy_now',
    price,
    commission: '10.50',
    commissionEstimated: false,
    net: String(Number(price) - 10.5),
    currency: 'USD',
    installments: null,
    paidOutOn: soldOn,
    action: null,
  } as MarketSale;
}

const ID = '00000000-0000-4000-8000-0000000000b1';

beforeEach(async () => {
  await flushWrites().catch(() => {});
  configureStore(new MemoryDocStore());
  await hydrateStores();
  fake.listings = [
    listing('alpha.com', '2500'),
    listing('beta.io', '900', 'pending'),
    listing('gamma.com', null),
  ];
  fake.sales = [
    sale('t1', 'sold-one.com', '2026-09-01', '499'),
    sale('t2', 'sold-two.com', '2025-01-01', '1000.25'),
  ];
  fake.domainStatsFor = [];
  fake.writes = [];
  fake.messages = [];
  fake.defaults = [];
  fake.writeBatch = 500;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00'));
  await connectMarketAccount(
    'afternic',
    { apiKey: 'k', apiSecret: 's' },
    'Main',
    ID,
  );
  await syncMarketAccount(ID);
  // Sync fetched each listing's traffic; tests count their own calls.
  fake.domainStatsFor = [];
});

describe('market tools', () => {
  it('lists accounts without secrets', async () => {
    const result = await call('market_list');
    expect(result.accounts).toEqual([
      expect.objectContaining({
        accountId: ID,
        market: 'afternic',
        label: 'Main',
        configured: true,
        enabled: true,
      }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/apiSecret|"s"/);
  });

  it('filters, sorts and pages listings', async () => {
    const byPrice = await call('market_listings', {
      sort: 'price',
      order: 'desc',
    });
    expect(byPrice.rows.map((r: MarketListing) => r.name)).toEqual([
      'alpha.com',
      'beta.io',
      'gamma.com',
    ]);
    const pending = await call('market_listings', { status: ['pending'] });
    expect(pending.total).toBe(1);
    const com = await call('market_listings', { tld: '.com', limit: 1 });
    expect(com).toMatchObject({ total: 2, rows: [{ name: 'alpha.com' }] });
    const cheap = await call('market_listings', { priceMax: 1000 });
    expect(cheap.rows.map((r: MarketListing) => r.name)).toEqual(['beta.io']);
  });

  it('gets one name’s listings', async () => {
    expect(await call('domain_listing_get', { domain: 'Alpha.COM' })).toEqual({
      domain: 'alpha.com',
      listings: [expect.objectContaining({ price: '2500' })],
    });
    expect(
      (await call('domain_listing_get', { domain: 'nope.com' })).listings,
    ).toEqual([]);
  });

  it('lists sales with totals over every match', async () => {
    const all = await call('market_sales', { limit: 1 });
    expect(all.total).toBe(2);
    expect(all.rows).toHaveLength(1);
    expect(all.totals).toEqual({
      price: { USD: '1499.25' },
      commission: { USD: '21.00' },
      net: { USD: '1478.25' },
    });
    const recent = await call('market_sales', { from: '2026-01-01' });
    expect(recent.rows.map((s: MarketSale) => s.name)).toEqual([
      'sold-one.com',
    ]);
  });

  it('reads stored account stats and live domain stats', async () => {
    expect(await call('market_stats_get', { accountId: ID, days: 1 })).toEqual({
      accountId: ID,
      days: [expect.objectContaining({ date: '2026-10-28', views: 6 })],
      totals: { views: 6, leads: 0 },
    });
    const domain = await call('domain_stats_get', { domain: 'alpha.com' });
    expect(fake.domainStatsFor).toEqual(['alpha.com']);
    expect(domain.accounts[0].totals).toEqual({ views: 2, leads: 1 });
    await expect(
      call('domain_stats_get', { domain: 'unlisted.com' }),
    ).rejects.toThrow(/isn't listed/);
  });

  it('reads listing defaults', async () => {
    expect(await call('market_settings_get', { accountId: ID })).toEqual({
      maxLeasePeriod: 60,
    });
  });

  it('says Sedo-only reads aren’t supported for Afternic', async () => {
    await expect(
      call('market_payments_get', { accountId: ID, month: '2026-09-01' }),
    ).rejects.toThrow(/not supported for afternic/);
    await expect(
      call('market_categories_get', { accountId: ID }),
    ).rejects.toThrow(/not supported for afternic/);
  });
});

describe('market write tools', () => {
  it('passes Sedo settings through, and refuses both markets’ settings', async () => {
    await call('domain_listing_set', {
      domain: 'alpha.com',
      price: '500',
      sedo: { categories: [104], language: 'de' },
    });
    expect(fake.writes.at(-1)).toEqual([
      {
        name: 'alpha.com',
        price: '500',
        extra: { market: 'sedo', categories: [104], language: 'de' },
      },
    ]);
    await expect(
      call('domain_listing_set', {
        domain: 'alpha.com',
        afternic: { featured: true },
        sedo: { language: 'de' },
      }),
    ).rejects.toThrow(/one market’s settings/);
  });

  it('sets one listing, numbers and all, and reports adjustments', async () => {
    const result = await call('domain_listing_set', {
      domain: 'Capped.com',
      price: 2500,
      floor: null,
      leaseToOwn: { enabled: true, maxPayments: 36 },
      afternic: { intakeStyle: 'BUYNOW' },
    });
    expect(fake.writes).toEqual([
      [
        {
          name: 'capped.com',
          price: '2500',
          floor: null,
          leaseToOwn: { enabled: true, maxPayments: 36 },
          extra: { market: 'afternic', intakeStyle: 'BUYNOW' },
        },
      ],
    ]);
    expect(result).toMatchObject({
      accountId: ID,
      ok: true,
      pending: true,
      adjusted: [{ field: 'leaseToOwn.maxPayments', saved: 12 }],
    });
  });

  it('writes many from explicit changes and says what to pass otherwise', async () => {
    const result = await call('market_listings_set', {
      accountId: ID,
      changes: [
        { name: 'a.com', price: '10' },
        { name: 'b.com', minOffer: 25 },
      ],
    });
    expect(result).toMatchObject({ ok: 2, failed: 0 });
    await expect(
      call('market_listings_set', { accountId: ID }),
    ).rejects.toThrow(/Pass `changes`/);
  });

  it('delists many', async () => {
    const result = await call('market_listings_delete', {
      accountId: ID,
      domains: ['alpha.com'],
    });
    expect(result).toMatchObject({ ok: 1, failed: 0 });
    expect(
      (await call('domain_listing_get', { domain: 'alpha.com' })).listings,
    ).toEqual([]);
  });

  it('runs a big write on a one-name-a-call market as a job', async () => {
    const { resetBulkMemory } = await import('../services/bulk-jobs');
    resetBulkMemory();
    fake.writeBatch = 1;
    const domains = Array.from({ length: 11 }, (_, i) => `n${i}.com`);
    const started = await call('market_listings_set', {
      accountId: ID,
      changes: domains.map((name) => ({ name, price: '500' })),
    });
    expect(started.job).toMatchObject({
      status: 'running',
      total: 11,
      done: 0,
    });
    expect(fake.writes).toEqual([]);
    const stopped = await call('market_job_get', { cancel: true });
    expect(stopped.job).toMatchObject({ status: 'cancelled', done: 11 });
    expect(stopped.job.counts.cancelled).toBe(11);
  });

  it('says Atom-only actions aren’t supported for Afternic', async () => {
    await expect(
      call('domain_listing_discount_set', { domain: 'alpha.com', amount: 50 }),
    ).rejects.toThrow(/not supported for afternic/);
    await expect(
      call('domain_listing_verify', { domain: 'alpha.com' }),
    ).rejects.toThrow(/not supported for afternic/);
    await expect(call('market_grading_get', { accountId: ID })).rejects.toThrow(
      /not supported for afternic/,
    );
    await expect(
      call('domain_appraisal_get', { domain: 'alpha.com' }),
    ).rejects.toThrow(/No connected market account can appraise/);
  });

  it('sends a sale message and saves listing defaults', async () => {
    await call('market_sale_message_send', {
      accountId: ID,
      saleId: 't1',
      message: 'The transfer is under way.',
    });
    expect(fake.messages).toEqual([['t1', 'The transfer is under way.']]);
    await call('market_settings_set', { accountId: ID, maxLeasePeriod: 24 });
    expect(fake.defaults).toEqual([{ maxLeasePeriod: 24 }]);
  });
});

describe('report tools', () => {
  it('ranks listings by stored traffic, with coverage', async () => {
    const result = await call('market_traffic', { days: 30 });
    expect(result.coverage).toEqual({ withTraffic: 3, listed: 3 });
    expect(result.rows[0]).toEqual({ domain: 'alpha.com', views: 2, leads: 1 });
  });

  it('reports sales by year, sell-through and monthly traffic', async () => {
    const report = await call('market_report_get');
    expect(report.salesByYear.map((y: { year: string }) => y.year)).toEqual([
      '2026',
      '2025',
    ]);
    expect(report.salesTotal).toMatchObject({ sold: 2, gross: '1499.25' });
    expect(report.sellThrough).toEqual({ sold: 1, available: 4, rate: 0.25 });
    expect(report.trafficByMonth).toEqual([
      { month: '2026-10', views: 10, leads: 1 },
    ]);
  });
});
