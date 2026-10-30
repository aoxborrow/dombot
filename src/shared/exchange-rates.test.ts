import { describe, expect, it } from 'vitest';
import archiveData from '../../data/exchange-rates.json';
import { RATE_CURRENCIES } from './currencies';
import {
  ExchangeRates,
  archiveMonths,
  roundTo,
  type RateArchive,
  type Rates,
} from './exchange-rates';

const archive = archiveData as RateArchive;

// A small archive so the expected numbers are easy to check by hand.
const months = (entries: Record<string, Rates>) =>
  new Map(Object.entries(entries));
const sample = months({
  '2024-02': { USD: 1.08, GBP: 0.855, JPY: 161 },
  '2024-03': { USD: 1.1, GBP: 0.85, JPY: 160 },
});

describe('the archive', () => {
  it('holds the 29 the ECB quotes against the euro', () => {
    expect(archive.base).toBe('EUR');
    expect(archive.currencies).toEqual(
      RATE_CURRENCIES.filter((code) => code !== 'EUR'),
    );
  });

  it('runs month by month from 2000-01 without a gap', () => {
    const keys = Object.keys(archive.months);
    expect(keys[0]).toBe('2000-01');
    keys.forEach((key, i) => {
      const year = 2000 + Math.floor(i / 12);
      const month = String((i % 12) + 1).padStart(2, '0');
      expect(key).toBe(`${year}-${month}`);
      expect(archive.months[key]).toHaveLength(archive.currencies.length);
    });
  });

  it('has a rate for every currency every month, but ISK from 2009 to 2018', () => {
    const isk = archive.currencies.indexOf('ISK');
    for (const [month, values] of Object.entries(archive.months)) {
      values.forEach((value, i) => {
        const gap = i === isk && month >= '2009-01' && month <= '2018-01';
        if (gap) expect(value, `ISK ${month}`).toBeNull();
        else
          expect(value, `${archive.currencies[i]} ${month}`).toBeGreaterThan(0);
      });
    }
  });
});

describe('convert', () => {
  it('needs no rate for the same currency, and rounds to its minor units', () => {
    const fx = new ExchangeRates({}, sample);
    expect(fx.convert('19.999', 'USD', 'USD', '1990-01-01')).toEqual({
      amount: 20,
      period: null,
      provisional: false,
    });
    expect(fx.convert(1500.4, 'JPY', 'JPY')?.amount).toBe(1500);
  });

  it("uses the date's month average, through the euro", () => {
    const fx = new ExchangeRates({}, sample);
    expect(fx.convert(100, 'EUR', 'USD', '2024-03-15')).toEqual({
      amount: 110,
      period: '2024-03',
      provisional: false,
    });
    expect(fx.convert(110, 'USD', 'EUR', '2024-03-01')?.amount).toBe(100);
    // 100 GBP → 100 × 1.1 / 0.85
    expect(fx.convert(100, 'GBP', 'USD', '2024-03-31')?.amount).toBe(129.41);
    expect(fx.convert('1000', 'USD', 'JPY', '2024-02-10')?.amount).toBe(149074);
  });

  it('prefers a fetched month to the archive’s', () => {
    const fx = new ExchangeRates(
      { '2024-03': { rates: { USD: 1.2, GBP: 0.85, JPY: 160 } } },
      sample,
    );
    expect(fx.convert(100, 'EUR', 'USD', '2024-03-15')?.amount).toBe(120);
  });

  it('uses the day itself in a month with no average yet, else the nearest earlier day, else the nearest later', () => {
    const fx = new ExchangeRates(
      {
        '2024-04-03': { rates: { USD: 1.2 } },
        '2024-04-05': { rates: { USD: 1.3 } },
        '2024-04-08': { rates: { USD: 1.4 } },
      },
      sample,
    );
    expect(fx.convert(100, 'EUR', 'USD', '2024-04-05')).toEqual({
      amount: 130,
      period: '2024-04-05',
      provisional: true,
    });
    // A weekend: the Friday before.
    expect(fx.convert(100, 'EUR', 'USD', '2024-04-07')?.period).toBe(
      '2024-04-05',
    );
    // Before the first day held in its month: the first one.
    expect(fx.convert(100, 'EUR', 'USD', '2024-04-01')?.period).toBe(
      '2024-04-03',
    );
  });

  it('uses the newest rate held for a date past everything held', () => {
    const days = new ExchangeRates(
      { '2024-04-05': { rates: { USD: 1.3 } } },
      sample,
    );
    expect(days.convert(100, 'EUR', 'USD', '2024-06-20')).toEqual({
      amount: 130,
      period: '2024-04-05',
      provisional: true,
    });
    const monthsOnly = new ExchangeRates({}, sample);
    expect(monthsOnly.convert(100, 'EUR', 'USD', '2024-06-20')).toEqual({
      amount: 110,
      period: '2024-03',
      provisional: true,
    });
  });

  it('uses the newest rate before a month that was never fetched', () => {
    const fx = new ExchangeRates(
      {
        '2024-05': { rates: { USD: 1.5 } },
        '2024-06-03': { rates: { USD: 1.6 } },
      },
      sample,
    );
    expect(fx.convert(100, 'EUR', 'USD', '2024-04-10')).toEqual({
      amount: 110,
      period: '2024-03',
      provisional: true,
    });
  });

  it('uses the newest rate held for a forward-looking amount', () => {
    const fx = new ExchangeRates(
      {
        '2024-03-28': { rates: { USD: 1.05 } },
        '2024-04-05': { rates: { USD: 1.3 } },
      },
      sample,
    );
    expect(fx.convert(100, 'EUR', 'USD')).toEqual({
      amount: 130,
      period: '2024-04-05',
      provisional: true,
    });
    // A leftover day in a month that has its average doesn't beat it.
    const settled = new ExchangeRates(
      { '2024-03-28': { rates: { USD: 1.05 } } },
      sample,
    );
    expect(settled.convert(100, 'EUR', 'USD', null)?.period).toBe('2024-03');
  });

  it('converts nothing before the first rate, outside the 30, or in a gap', () => {
    const fx = new ExchangeRates({}, sample);
    expect(fx.convert(100, 'EUR', 'USD', '2024-01-31')).toBeNull();
    expect(fx.convert(100, 'TWD', 'USD', '2024-03-01')).toBeNull();
    expect(fx.convert(100, 'USD', 'KES', '2024-03-01')).toBeNull();
    expect(fx.convert('abc', 'USD', 'EUR', '2024-03-01')).toBeNull();
    // Not in that month's rates.
    expect(fx.convert(100, 'EUR', 'CHF', '2024-03-01')).toBeNull();

    const real = new ExchangeRates();
    expect(real.convert(100, 'ISK', 'USD', '2012-06-01')).toBeNull();
    expect(real.convert(100, 'ISK', 'USD', '2008-12-01')?.period).toBe(
      '2008-12',
    );
    expect(real.convert(100, 'EUR', 'USD', '1999-12-31')).toBeNull();
    expect(real.convert(100, 'EUR', 'USD', '2000-01-03')?.period).toBe(
      '2000-01',
    );
  });

  it('reports the newest month and day held', () => {
    const fx = new ExchangeRates(
      {
        '2024-05': { rates: { USD: 1.5 } },
        '2024-06-03': { rates: { USD: 1.6 } },
        '2024-06-04': { rates: { USD: 1.6 } },
      },
      sample,
    );
    expect(fx.newestMonth).toBe('2024-05');
    expect(fx.newestDay).toBe('2024-06-04');
    expect(fx.hasMonth('2024-02')).toBe(true);
    expect(new ExchangeRates({}, new Map()).newestMonth).toBeNull();
  });
});

describe('archiveMonths', () => {
  it('reads each month in the archive’s currency order, skipping gaps', () => {
    expect(
      archiveMonths({
        base: 'EUR',
        currencies: ['USD', 'ISK', 'XYZ'],
        months: { '2012-01': [1.29, null, 5] },
      }),
    ).toEqual(new Map([['2012-01', { USD: 1.29 }]]));
  });
});

describe('roundTo', () => {
  it('rounds to the currency’s decimal places', () => {
    expect(roundTo(1.005 * 1000, 'KRW')).toBe(1005);
    expect(roundTo(12.345, 'USD')).toBe(12.35);
    expect(roundTo(12.3456, 'BHD')).toBe(12.346);
    expect(roundTo(12.3456, 'ZZZ')).toBe(12.35);
  });
});
