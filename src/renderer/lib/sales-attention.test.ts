import { describe, expect, it } from 'vitest';
import type { ListPrice } from '../../shared/ipc';
import type { MarketListing } from '../../shared/markets';
import type { SaleRecord } from '../../shared/sales';
import { GROUP_OVER, needsAttention } from './sales-attention';

const NOW = Date.parse('2026-10-29T12:00:00Z');

function listing(
  name: string,
  over: Partial<MarketListing> = {},
): MarketListing {
  return {
    market: 'afternic',
    accountId: 'acc',
    name,
    displayName: null,
    status: 'active',
    statusRaw: 'ACTIVE',
    forSale: true,
    price: '1000',
    buyNow: true,
    minOffer: null,
    floor: null,
    discount: null,
    currency: 'USD',
    leaseToOwn: null,
    tier: null,
    listedAt: '2026-10-01T00:00:00Z',
    updatedAt: null,
    extra: {} as MarketListing['extra'],
    ...over,
  };
}

const price = (amount: string): ListPrice => ({
  amount,
  currency: 'USD',
  updatedAt: 0,
});

function record(over: Partial<SaleRecord>): SaleRecord {
  return {
    id: 'x',
    name: 'a.com',
    soldOn: '2026-10-20',
    source: 'afternic',
    eventId: null,
    marketSale: 'acc:1',
    marketAccountId: 'acc',
    marketSaleId: '1',
    status: 'in_progress',
    step: 'auth_code',
    kind: 'buy_now',
    currency: 'USD',
    price: '100',
    fees: null,
    feesEstimated: false,
    net: null,
    paidOutOn: null,
    installments: null,
    registrarAccountId: null,
    acquiredOn: null,
    cost: null,
    holdingDays: null,
    profit: null,
    awaitingTransfer: false,
    ...over,
  };
}

const base = {
  records: [] as SaleRecord[],
  liveMarketAccounts: new Set(['acc']),
  listings: {} as Record<string, MarketListing[]>,
  listPrices: {} as Record<string, ListPrice>,
  owned: new Set<string>(),
  markets: ['afternic' as const],
  now: NOW,
};

describe('needsAttention', () => {
  it('lists sales waiting on you, only through connected accounts', () => {
    const items = needsAttention({
      ...base,
      records: [
        record({ id: 'a' }),
        record({ id: 'b', marketAccountId: 'gone' }),
        record({ id: 'c', step: null }),
        record({ id: 'd', status: 'completed', step: null }),
      ],
    });
    expect(items.map((i) => i.key)).toEqual(['sale:a']);
  });

  it('lists rejected, stuck and below-price listings one by one', () => {
    const items = needsAttention({
      ...base,
      owned: new Set(['r.com', 's.com', 'b.com', 'ok.com', 'fresh.com']),
      listings: {
        'r.com': [listing('r.com', { status: 'rejected' })],
        's.com': [listing('s.com', { status: 'pending' })],
        'fresh.com': [
          listing('fresh.com', {
            status: 'pending',
            listedAt: '2026-10-27T00:00:00Z',
          }),
        ],
        'b.com': [listing('b.com', { price: '800' })],
        'ok.com': [listing('ok.com')],
      },
      listPrices: { 'b.com': price('1000'), 'ok.com': price('1000') },
    });
    expect(items.map((i) => i.key)).toEqual([
      'listing:rejected:afternic:r.com',
      'listing:stuck:afternic:s.com',
      'listing:below:afternic:b.com',
    ]);
  });

  it('groups past a few names, and counts priced names not listed', () => {
    const names = Array.from({ length: GROUP_OVER + 1 }, (_, i) => `n${i}.com`);
    const items = needsAttention({
      ...base,
      owned: new Set([...names, 'priced.com', 'bare.com']),
      listings: Object.fromEntries(
        names.map((n) => [n, [listing(n, { status: 'rejected' })]]),
      ),
      listPrices: { 'priced.com': price('500') },
    });
    expect(items).toMatchObject([
      {
        kind: 'group',
        reason: 'rejected',
        count: GROUP_OVER + 1,
        link: '/?markets=afternic&states=rejected',
      },
      {
        kind: 'group',
        reason: 'unlisted',
        count: 1,
        link: '/?markets=afternic&states=none&asking=forSale',
      },
    ]);
  });
});
