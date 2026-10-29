import { describe, expect, it } from 'vitest';
import {
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
      },
    ]);
    expect(salesTotal(years)).toMatchObject({
      sold: 3,
      gross: '3828.09',
      net: '2753.62',
      average: '1276.03',
    });
  });

  it('keeps to one currency', () => {
    expect(
      salesByYear([{ ...sale('a.com', '2026-01-01', '10'), currency: 'EUR' }]),
    ).toEqual([]);
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
    const l = (name: string, days30: number | null) =>
      ({
        name,
        extra: {
          market: 'afternic',
          searches:
            days30 === null
              ? null
              : { total: { days30 }, unique: { days30: 1 } },
        },
      }) as unknown as MarketListing;
    const t = (leads365: number, views365: number) => ({
      leads365,
      views365,
      views30: 0,
    });
    const rows = namesOfInterest(
      { 'a.com': t(2, 10), 'b.com': t(0, 50), 'quiet.com': t(0, 0) },
      [l('a.com', 5), l('c.com', 40), l('d.com', null), l('e.com', 0)],
    );
    expect(rows.map((r) => [r.name, r.searches30])).toEqual([
      ['a.com', 5],
      ['b.com', null],
      ['c.com', 40],
    ]);
  });
});
