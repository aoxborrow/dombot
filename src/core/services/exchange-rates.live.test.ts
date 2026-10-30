import { beforeEach, describe, expect, it } from 'vitest';
import { RATE_CURRENCIES } from '../../shared/currencies';
import { ExchangeRates } from '../../shared/exchange-rates';
import { MemoryDocStore } from '../storage/doc-store';
import { configureStore, hydrateStores } from '../storage/namespace';
import {
  enableRateFetch,
  getExchangeRateRows,
  parseDailyXml,
  parseMonthlyCsv,
  refreshExchangeRates,
  resetRateFetch,
} from './exchange-rates';
import { setListPrices } from './list-prices';

// Against the real ECB; no credentials. Catches a change in either format.

const QUOTED = RATE_CURRENCIES.filter((code) => code !== 'EUR');

describe('ECB rates (live)', () => {
  beforeEach(async () => {
    configureStore(new MemoryDocStore());
    await hydrateStores();
    resetRateFetch();
  });

  it('reads every currency from the 90-day file and the Data Portal', async () => {
    const days = parseDailyXml(
      await (
        await fetch(
          'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',
        )
      ).text(),
    );
    expect(days.size).toBeGreaterThan(55);
    const newest = [...days.keys()].sort().at(-1)!;
    expect(Object.keys(days.get(newest)!).sort()).toEqual(QUOTED);

    const months = parseMonthlyCsv(
      await (
        await fetch(
          `https://data-api.ecb.europa.eu/service/data/EXR/M.${QUOTED.join('+')}.EUR.SP00.A` +
            '?startPeriod=2024-01&endPeriod=2024-01&format=csvdata&detail=dataonly',
        )
      ).text(),
    );
    expect(Object.keys(months.get('2024-01')!).sort()).toEqual(QUOTED);
    // Within a cent of the archive's figure for the same month.
    const archived = new ExchangeRates().convert(100, 'EUR', 'USD', '2024-01');
    expect(months.get('2024-01')!.USD! * 100).toBeCloseTo(archived!.amount, 1);
  });

  it('brings what DomBot holds to within a week', async () => {
    // A euro amount in a USD portfolio, so there's something to convert.
    setListPrices([
      {
        domainName: 'euro.com',
        amount: '100',
        minOffer: null,
        floor: null,
        currency: 'EUR',
      },
    ]);
    enableRateFetch();
    const now = new Date();
    await refreshExchangeRates(now);
    const fx = new ExchangeRates(getExchangeRateRows());
    const today = fx.convert(100, 'GBP', 'JPY', now.toISOString().slice(0, 10));
    expect(today?.provisional).toBe(true);
    expect(today!.amount).toBeGreaterThan(1000);
    // A day in the last ten, or last month's average early in a month.
    const tenDaysAgo = new Date(now.getTime() - 10 * 864e5).toISOString();
    expect(today!.period! >= tenDaysAgo.slice(0, 7)).toBe(true);
  });
});
