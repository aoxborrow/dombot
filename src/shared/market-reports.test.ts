import { describe, expect, it } from 'vitest';
import { ExchangeRates } from './exchange-rates';
import {
  convertedTotals,
  namesOfInterest,
  salesByYear,
  salesTotal,
  sellThrough,
  trafficByMonth,
} from './market-reports';
import type { MarketListing, MarketSale, MarketStatsDay } from './markets';

const sale = (
  name: string,
  soldOn: string,
  price: string,
  status: MarketSale['status'] = 'completed',
  commission = '0',
) =>
  ({
    name,
    soldOn,
    price,
    commission,
    net: null,
    status,
    currency: 'USD',
  }) as MarketSale;

describe('salesByYear', () => {
  it('sums completed sales per year exactly, newest first', () => {
    const years = salesByYear([
      sale('a.com', '2026-10-08', '499', 'completed', '149.70'),
      sale('b.com', '2026-01-14', '1479.09', 'completed', '369.77'),
      sale('c.com', '2026-10-20', '899', 'in_progress'),
      sale('d.com', '2024-04-19', '850', 'cancelled'),
      sale('e.com', '2024-12-28', '1850', 'completed', '555'),
    ]);
    expect(years).toEqual([
      {
        year: '2026',
        sold: 2,
        inProgress: 1,
        cancelled: 0,
        gross: '1978.09',
        commission: '519.47',
        net: '1458.62',
        average: '989.05',
        provisional: false,
        leftOut: [],
      },
      {
        year: '2024',
        sold: 1,
        inProgress: 0,
        cancelled: 1,
        gross: '1850.00',
        commission: '555.00',
        net: '1295.00',
        average: '1850.00',
        provisional: false,
        leftOut: [],
      },
    ]);
    expect(salesTotal(years)).toMatchObject({
      sold: 3,
      gross: '3828.09',
      net: '2753.62',
      average: '1276.03',
    });
  });

  // 1 EUR = 1.25 USD in March; April has days only.
  const fx = new ExchangeRates(
    { '2026-04-02': { rates: { USD: 1.3 } } },
    new Map([['2026-03', { USD: 1.25 }]]),
  );
  const eur = (name: string, soldOn: string, price: string, commission = '0') =>
    ({
      ...sale(name, soldOn, price, 'completed', commission),
      currency: 'EUR',
    }) as MarketSale;

  it('converts a sale in another currency at its month’s average', () => {
    const [year] = salesByYear(
      [
        sale('a.com', '2026-03-01', '100'),
        eur('b.com', '2026-03-20', '800', '160'),
      ],
      'USD',
      fx,
    );
    expect(year).toMatchObject({
      sold: 2,
      gross: '1100.00',
      commission: '200.00',
      net: '900.00',
      average: '550.00',
      provisional: false,
      leftOut: [],
    });
    // In euros, the dollar sale is the converted one.
    expect(
      salesByYear([sale('a.com', '2026-03-01', '100')], 'EUR', fx)[0].gross,
    ).toBe('80.00');
  });

  it('marks a year provisional, and leaves out what it can’t convert', () => {
    const years = salesByYear(
      [
        eur('a.com', '2026-04-03', '100'),
        {
          ...sale('b.com', '2026-04-04', '9000'),
          currency: 'TWD',
        } as MarketSale,
        { ...sale('c.com', '2025-02-01', '50'), currency: 'TWD' } as MarketSale,
        {
          ...eur('d.com', '2026-04-05', '70'),
          status: 'in_progress',
        } as MarketSale,
      ],
      'USD',
      fx,
    );
    expect(years).toMatchObject([
      {
        year: '2026',
        sold: 1,
        inProgress: 1,
        gross: '130.00',
        provisional: true,
        leftOut: [{ currency: 'TWD', count: 1 }],
      },
      {
        year: '2025',
        sold: 0,
        gross: '0.00',
        leftOut: [{ currency: 'TWD', count: 1 }],
      },
    ]);
    expect(salesTotal(years)).toMatchObject({
      sold: 1,
      provisional: true,
      leftOut: [{ currency: 'TWD', count: 2 }],
    });
  });

  it('without rates, counts only sales already in the currency', () => {
    expect(salesByYear([eur('a.com', '2026-01-01', '10')])).toMatchObject([
      { sold: 0, gross: '0.00', leftOut: [{ currency: 'EUR', count: 1 }] },
    ]);
  });
});

describe('currency places', () => {
  it('reports each currency in its own decimal places', () => {
    const yen = {
      ...sale('a.com', '2026-03-01', '150000'),
      currency: 'JPY',
    } as MarketSale;
    const years = salesByYear([yen], 'JPY');
    expect(years[0]).toMatchObject({ gross: '150000', average: '150000' });
    expect(salesTotal(years, 'JPY')).toMatchObject({ gross: '150000' });
    const fx = new ExchangeRates({}, new Map([['2026-03', { JPY: 160 }]]));
    expect(convertedTotals([yen], 'EUR', fx).price).toBe('937.50');
    expect(
      convertedTotals(
        [sale('b.com', '2026-03-01', '10')],
        'JPY',
        new ExchangeRates({}, new Map([['2026-03', { JPY: 160, USD: 1.25 }]])),
      ).price,
    ).toBe('1280');
  });
});

describe('convertedTotals', () => {
  it('counts a sale with no net as price less commission, as salesByYear does', () => {
    const fx = new ExchangeRates({}, new Map([['2026-03', { USD: 1.25 }]]));
    const noNet = sale('a.com', '2026-03-01', '100', 'completed', '20');
    expect(convertedTotals([noNet], 'USD', fx).net).toBe('80.00');
    expect(salesByYear([noNet], 'USD', fx)[0].net).toBe('80.00');
  });

  it('sums every sale in one currency', () => {
    const fx = new ExchangeRates({}, new Map([['2026-03', { USD: 1.25 }]]));
    expect(
      convertedTotals(
        [
          {
            ...sale('a.com', '2026-03-01', '100', 'completed', '20'),
            net: '80',
          },
          {
            ...sale('b.com', '2026-03-02', '40', 'in_progress', '8'),
            currency: 'EUR',
            net: '32',
          } as MarketSale,
          {
            ...sale('c.com', '2026-03-03', '5'),
            currency: 'TWD',
          } as MarketSale,
        ],
        'USD',
        fx,
      ),
    ).toEqual({
      currency: 'USD',
      price: '150.00',
      commission: '30.00',
      net: '120.00',
      provisional: false,
      leftOut: [{ currency: 'TWD', count: 1 }],
    });
  });
});

describe('trafficByMonth', () => {
  it('sums days into months across accounts', () => {
    const day = (date: string, views: number, leads = 0) =>
      ({ date, views, leads }) as MarketStatsDay;
    expect(
      trafficByMonth([
        day('2026-09-30', 2),
        day('2026-10-01', 3, 1),
        day('2026-10-01', 4),
      ]),
    ).toEqual([
      { month: '2026-09', views: 2, leads: 0 },
      { month: '2026-10', views: 7, leads: 1 },
    ]);
  });
});

describe('sellThrough', () => {
  it('counts the last year’s sales over what could have sold', () => {
    const listings = ['a.com', 'b.com', 'c.com'].map(
      (name) => ({ name }) as MarketListing,
    );
    expect(
      sellThrough(
        [
          sale('sold.com', '2026-10-08', '499'),
          sale('old.com', '2024-01-01', '499'),
          sale('pending.com', '2026-10-20', '499', 'in_progress'),
        ],
        listings,
        '2026-10-28',
      ),
    ).toEqual({ sold: 1, available: 4, rate: 0.25 });
    expect(sellThrough([], [], '2026-10-28').rate).toBeNull();
  });
});

describe('namesOfInterest', () => {
  it('ranks by leads, then views, then searches, names with searches only included', () => {
    const l = (name: string, days365: number | null) =>
      ({
        name,
        extra: {
          market: 'afternic',
          searches:
            days365 === null
              ? null
              : { total: { days365 }, unique: { days365: 1 } },
        },
      }) as unknown as MarketListing;
    const t = (leads365: number, views365: number) => ({
      leads365,
      views365,
    });
    const rows = namesOfInterest(
      { 'a.com': t(2, 10), 'b.com': t(0, 50), 'quiet.com': t(0, 0) },
      [l('a.com', 5), l('c.com', 40), l('d.com', null), l('e.com', 0)],
    );
    expect(rows.map((r) => [r.name, r.searches365])).toEqual([
      ['a.com', 5],
      ['b.com', null],
      ['c.com', 40],
    ]);
  });
});
