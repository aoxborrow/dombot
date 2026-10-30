import { describe, expect, it } from 'vitest';
import type { DomainEvent } from './domain-events';
import { ExchangeRates } from './exchange-rates';
import type { MarketSale } from './markets';
import {
  buildSaleRecords,
  filterSaleRecords,
  groupSaleRecords,
  NO_SALE_FILTER,
  recordIn,
  saleRecordsCsv,
  saleTld,
  saleTotals,
  saleTotalsIn,
  salesByMonth,
} from './sales';

// 1 EUR = 1.25 USD in January 2025 and 1.2 in January 2026; February 2026
// has only a day's rate (no average yet).
const fx = new ExchangeRates(
  { '2026-02-10': { rates: { USD: 1.3 } } },
  new Map([
    ['2025-01', { USD: 1.25 }],
    ['2026-01', { USD: 1.2 }],
  ]),
);

// Adapted from PR #183's sales-analytics tests (julianengel), plus market
// sales and their join.

function event(
  id: string,
  type: DomainEvent['type'],
  date: string | null,
  amount: string | null = null,
  extra: Partial<DomainEvent> = {},
): DomainEvent {
  return {
    id,
    type,
    date,
    ...(amount ? { amount, currency: 'USD' as const } : {}),
    domain: 'example.com',
    source: 'user',
    createdAt: Date.parse(date ?? '2026-02-01'),
    updatedAt: null,
    ...extra,
  };
}

function marketSale(over: Partial<MarketSale> = {}): MarketSale {
  return {
    market: 'afternic',
    accountId: 'acc',
    id: 't1',
    name: 'example.com',
    soldOn: '2026-01-01',
    status: 'completed',
    statusRaw: 'COMPLETED',
    kind: 'buy_now',
    price: '1000.00',
    commission: '200.00',
    commissionEstimated: false,
    net: '800.00',
    currency: 'USD',
    installments: null,
    paidOutOn: '2026-01-20',
    action: null,
    ...over,
  };
}

const purchase = event('01', 'purchased', '2025-01-01', '100.00');
const sale = event('02', 'sold', '2026-01-01', '1000.00', { fees: '100.00' });
const build = (
  events: DomainEvent[],
  sales: MarketSale[] = [],
  held: string[] = [],
  rates?: ExchangeRates,
) =>
  buildSaleRecords({
    events,
    marketSales: sales,
    held: new Set(held),
    today: '2026-03-01',
    fx: rates,
  });

describe('buildSaleRecords', () => {
  it('works out net, profit and holding period from complete facts', () => {
    const [r] = build([sale, purchase]);
    expect(r).toMatchObject({
      source: 'private',
      status: 'completed',
      price: '1000.00',
      fees: '100.00',
      net: '900.00',
      cost: '100.00',
      profit: '800.00',
      acquiredOn: '2025-01-01',
      holdingDays: 365,
      eventId: '02',
    });
    expect(saleTotals([r])[0]).toMatchObject({
      currency: 'USD',
      sold: 1,
      gross: '1000.00',
      net: '900.00',
      average: '1000.00',
      profit: '800.00',
      profitCount: 1,
      roi: 8,
      holdingDays: 365,
    });
  });

  it('keeps unknown fees and costs unknown, and zero explicit', () => {
    const [r] = build([purchase, { ...sale, fees: null }]);
    expect(r).toMatchObject({ fees: null, net: null, profit: null });
    expect(build([{ ...sale, fees: '0.00' }])[0]).toMatchObject({
      net: '1000.00',
      cost: null,
      profit: null,
    });
    expect(
      build([event('01', 'purchased', '2025-01-01', '0.00'), sale])[0].profit,
    ).toBe('900.00');
    expect(
      saleTotals(
        build([event('01', 'purchased', '2025-01-01', '0.00'), sale]),
      )[0].roi,
    ).toBeNull();
  });

  it('pairs each sale with its own holding: a buyback starts a new one', () => {
    const rows = build([
      purchase,
      sale,
      event('03', 'purchased', '2026-02-01', '300.00'),
      event('04', 'sold', '2026-03-01', '1000.00', { fees: '0.00' }),
      event('05', 'sold', '2026-04-01', '1000.00', { fees: '0.00' }),
    ]);
    // Newest first.
    expect(rows.map((r) => [r.id, r.cost, r.holdingDays])).toEqual([
      ['05', null, null],
      ['04', '300.00', 28],
      ['02', '100.00', 365],
    ]);
  });

  it('converts a cost paid in another currency at the purchase date', () => {
    const euro = { ...purchase, currency: 'EUR' as const };
    expect(build([euro, sale], [], [], fx)[0]).toMatchObject({
      cost: '125.00',
      costPaid: { amount: '100.00', currency: 'EUR' },
      profit: '775.00',
    });
    // Without rates, or in one DomBot can't convert, the cost is unknown.
    expect(build([euro, sale])[0]).toMatchObject({ cost: null, profit: null });
    const twd = { ...purchase, currency: 'TWD' as const };
    expect(build([twd, sale], [], [], fx)[0].cost).toBeNull();
    // In the sale's own currency, nothing's converted.
    expect(build([purchase, sale], [], [], fx)[0].costPaid).toBeNull();
  });

  it('never makes up a holding period from an undated purchase', () => {
    expect(
      build([event('01', 'purchased', null, '100.00'), sale])[0].holdingDays,
    ).toBeNull();
  });

  it('labels imported sales', () => {
    expect(build([{ ...sale, source: 'import' }])[0].source).toBe('imported');
  });

  it('joins a market sale to its event for commission, net and payout', () => {
    const linked = {
      ...sale,
      fees: undefined,
      source: 'sync' as const,
      marketSale: 'acc:t1',
    };
    const [r] = build([purchase, linked], [marketSale()]);
    expect(r).toMatchObject({
      id: '02',
      source: 'afternic',
      marketSale: 'acc:t1',
      fees: '200.00',
      net: '800.00',
      paidOutOn: '2026-01-20',
      cost: '100.00',
      profit: '700.00',
    });
  });

  it('works net out again when you recorded a different price', () => {
    const linked = { ...sale, amount: '1100.00', marketSale: 'acc:t1' };
    expect(build([linked], [marketSale()])[0].net).toBe('900.00');
  });

  it('lists market sales no event records: in progress, cancelled, bought back', () => {
    const rows = build(
      [purchase],
      [
        marketSale({
          id: 'a',
          status: 'in_progress',
          action: 'auth_code',
          soldOn: '2026-02-20',
          paidOutOn: null,
        }),
        marketSale({ id: 'b', status: 'cancelled', soldOn: '2026-02-10' }),
        marketSale({ id: 'c', soldOn: '2025-06-01' }),
      ],
    );
    expect(rows.map((r) => [r.id, r.status, r.step])).toEqual([
      ['market:acc:a', 'in_progress', 'auth_code'],
      ['market:acc:b', 'cancelled', null],
      ['market:acc:c', 'completed', null],
    ]);
    // The completed one ends the holding it sold from.
    expect(rows[2].cost).toBe('100.00');
    expect(rows[0].cost).toBeNull();
  });

  it('a market sale whose account is gone keeps its event as a market sale', () => {
    const orphan = { ...sale, marketSale: 'gone:t9', source: 'sync' as const };
    expect(build([orphan])[0].source).toBe('market');
  });

  it('a recent sale of a name an account still holds awaits transfer', () => {
    const recent = event('02', 'sold', '2026-02-15', '1000.00');
    expect(build([recent], [], ['example.com'])[0].awaitingTransfer).toBe(true);
    expect(build([recent])[0].awaitingTransfer).toBe(false);
    // Old, or bought back since: you have it again.
    expect(
      build([{ ...sale, date: '2025-10-01' }], [], ['example.com'])[0]
        .awaitingTransfer,
    ).toBe(false);
    expect(
      build(
        [recent, event('03', 'purchased', '2026-02-20', '5.00')],
        [],
        ['example.com'],
      )[0].awaitingTransfer,
    ).toBe(false);
  });

  it('leaves a sale you marked handed over, though an account has it', () => {
    const [r] = build([{ ...sale, transferred: true }], [], ['example.com']);
    expect(r.awaitingTransfer).toBe(false);
  });

  it('remembers the registrar account that held the name', () => {
    const rows = build([
      { ...event('00', 'added', '2024-12-01'), accountId: 'first' },
      sale,
      { ...event('03', 'moved', '2026-02-01'), toAccountId: 'second' },
    ]);
    expect(rows[0].registrarAccountId).toBe('first');
  });
});

describe('filterSaleRecords', () => {
  const rows = build([sale, event('03', 'sold', null, '200.00')]);

  it('keeps undated sales with no bounds, and counts them when it drops them', () => {
    expect(filterSaleRecords(rows, NO_SALE_FILTER).records).toHaveLength(2);
    expect(
      filterSaleRecords(rows, {
        ...NO_SALE_FILTER,
        from: '2026-01-01',
        to: '2026-01-01',
      }),
    ).toMatchObject({ undated: 1 });
    expect(
      filterSaleRecords(rows, { ...NO_SALE_FILTER, from: '2026-01-02' })
        .records,
    ).toHaveLength(0);
  });

  it('filters by source and currency', () => {
    expect(
      filterSaleRecords(rows, { ...NO_SALE_FILTER, sources: ['afternic'] })
        .records,
    ).toHaveLength(0);
    expect(
      filterSaleRecords(rows, { ...NO_SALE_FILTER, currency: 'EUR' }).records,
    ).toHaveLength(0);
  });
});

describe('totals and groups', () => {
  const euro = event('03', 'sold', '2026-01-02', '200.00', {
    domain: 'euro.io',
    currency: 'EUR',
  });

  it('keeps currencies apart', () => {
    const totals = saleTotals(build([sale, euro]));
    expect(totals.map((t) => [t.currency, t.gross])).toEqual([
      ['EUR', '200.00'],
      ['USD', '1000.00'],
    ]);
  });

  it('counts sales in progress and cancelled beside the money', () => {
    const [t] = saleTotals(
      build(
        [],
        [
          marketSale({ status: 'in_progress' }),
          marketSale({ id: 'x', status: 'cancelled' }),
        ],
      ),
    );
    expect(t).toMatchObject({
      sold: 0,
      inProgress: 1,
      cancelled: 1,
      gross: '0.00',
    });
  });

  it('groups by TLD, one row per currency', () => {
    expect(
      groupSaleRecords(build([sale, euro]), saleTld).map((g) => [
        g.label,
        g.currency,
        g.sold,
      ]),
    ).toEqual([
      ['com', 'USD', 1],
      ['io', 'EUR', 1],
    ]);
  });

  it('adds up months, with empty ones', () => {
    const months = salesByMonth(build([sale]), 'USD', '2026-03-15', 3);
    expect(months).toEqual([
      { month: '2026-01', sold: 1, gross: '1000.00' },
      { month: '2026-02', sold: 0, gross: '0.00' },
      { month: '2026-03', sold: 0, gross: '0.00' },
    ]);
    // With rates, the euro sale is in dollars too.
    expect(
      salesByMonth(build([sale, euro]), 'USD', '2026-01-15', 1, fx),
    ).toEqual([{ month: '2026-01', sold: 2, gross: '1240.00' }]);
  });
});

describe('totals in one currency', () => {
  const euro = event('03', 'sold', '2026-01-02', '200.00', {
    domain: 'euro.io',
    currency: 'EUR',
    fees: '20.00',
  });
  const recent = event('04', 'sold', '2026-02-12', '100.00', {
    domain: 'recent.io',
    currency: 'EUR',
  });
  const twd = event('05', 'sold', '2026-01-03', '9000', {
    domain: 'twd.tw',
    currency: 'TWD',
  });

  it('converts each sale at its month’s average, and says how many', () => {
    const t = saleTotalsIn(build([sale, euro]), 'USD', fx);
    expect(t).toMatchObject({
      currency: 'USD',
      sold: 2,
      gross: '1240.00',
      fees: '124.00',
      net: '1116.00',
      average: '620.00',
      converted: 1,
      convertedFrom: ['EUR'],
      provisional: false,
      leftOut: [],
    });
    // In euros, the dollar sale is the converted one.
    expect(saleTotalsIn(build([sale, euro]), 'EUR', fx).gross).toBe('1033.33');
  });

  it('marks a recent rate provisional, and leaves out what it can’t convert', () => {
    const t = saleTotalsIn(build([sale, recent, twd]), 'USD', fx);
    expect(t).toMatchObject({
      sold: 2,
      gross: '1130.00',
      provisional: true,
      leftOut: [{ currency: 'TWD', count: 1 }],
    });
  });

  it('keeps a record as it is in its own currency, or with no price', () => {
    const [usd] = build([sale]);
    expect(recordIn(usd, 'USD', fx)).toEqual({
      record: usd,
      provisional: false,
    });
    const [unpriced] = build([event('06', 'sold', '2026-01-05')]);
    expect(recordIn(unpriced, 'EUR', fx)?.record).toBe(unpriced);
    expect(recordIn(build([twd])[0], 'USD', fx)).toBeNull();
  });

  it('groups in one currency', () => {
    expect(
      groupSaleRecords(build([sale, euro]), () => 'all', {
        currency: 'USD',
        fx,
      }).map((g) => [g.label, g.currency, g.sold, g.gross]),
    ).toEqual([['all', 'USD', 2, '1240.00']]);
  });
});

describe('saleRecordsCsv', () => {
  it('leaves unknowns blank and guards formulas', () => {
    const csv = saleRecordsCsv(build([sale]), {
      source: () => '=Private',
      registrar: () => '',
    });
    const [head, row] = csv.split('\r\n');
    expect(head).toMatch(/^Domain,Sold on,Source/);
    expect(row).toBe(
      "example.com,2026-01-01,'=Private,completed,,USD,1000.00,100.00,900.00,,,,,,",
    );
  });
});
