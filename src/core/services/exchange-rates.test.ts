import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExchangeRates, type Rates } from '../../shared/exchange-rates';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { clearAll } from './cache';
import {
  enableRateFetch,
  getExchangeRateRows,
  parseDailyXml,
  parseMonthlyCsv,
  ratesNeeded,
  refreshExchangeRates,
  resetRateFetch,
} from './exchange-rates';
import { setListPrices } from './list-prices';
import { updateSettings } from './settings';

// Dates follow the shipped archive, so a rebuild doesn't break these:
// `archived` is its newest month, `current` the one after (no average yet),
// `next` the one after that (by then `current`'s average is out).
const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
const archived = new ExchangeRates().newestMonth!;
const current = shift(archived, 1);
const next = shift(archived, 2);
/** Noon UTC on a day of `month`. */
const at = (month: string, day: number) =>
  new Date(`${month}-${String(day).padStart(2, '0')}T12:00:00Z`);
const dayOf = (month: string, day: number) =>
  `${month}-${String(day).padStart(2, '0')}`;
const HOUR = 60 * 60 * 1000;

const xml = (days: Record<string, Rates>) =>
  '<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope><Cube>' +
  Object.entries(days)
    .map(
      ([day, rates]) =>
        `<Cube time="${day}">` +
        Object.entries(rates)
          .map(([c, r]) => `<Cube currency="${c}" rate="${r}"/>`)
          .join('') +
        '</Cube>',
    )
    .join('\n') +
  '</Cube></gesmes:Envelope>';

const csv = (rows: [currency: string, month: string, value: number][]) =>
  'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n' +
  rows
    .map(([c, m, v]) => `EXR.M.${c}.EUR.SP00.A,M,${c},EUR,SP00,A,${m},${v}`)
    .join('\n');

describe('parsers', () => {
  it('reads monthly averages to six significant digits', () => {
    const months = parseMonthlyCsv(
      csv([
        ['USD', '2026-09', 1.17012345],
        ['JPY', '2026-09', 172.987654],
        ['USD', '2026-10', 1.16],
        ['TWD', '2026-09', 35],
      ]),
    );
    expect(months).toEqual(
      new Map([
        ['2026-09', { USD: 1.17012, JPY: 172.988 }],
        ['2026-10', { USD: 1.16 }],
      ]),
    );
    expect(parseMonthlyCsv('')).toEqual(new Map());
    expect(() => parseMonthlyCsv('A,B\n1,2')).toThrow('unexpected format');
  });

  it('reads the daily and the 90-day files', () => {
    const daily = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope>
	<Cube>
		<Cube time='2026-10-29'>
			<Cube currency='USD' rate='1.1130'/>
			<Cube currency='IDR' rate='20193.16'/>
		</Cube>
	</Cube>
</gesmes:Envelope>`;
    expect(parseDailyXml(daily)).toEqual(
      new Map([['2026-10-29', { USD: 1.113, IDR: 20193.16 }]]),
    );
    expect(
      parseDailyXml(
        xml({ '2026-10-29': { USD: 1.113 }, '2026-10-28': { GBP: 0.83785 } }),
      ),
    ).toEqual(
      new Map([
        ['2026-10-29', { USD: 1.113 }],
        ['2026-10-28', { GBP: 0.83785 }],
      ]),
    );
  });
});

describe('refreshExchangeRates', () => {
  const fetchMock = vi.fn();
  let store: MemoryDocStore;
  /** An asking price in euros, so a USD portfolio needs rates. */
  const holdEuros = (currency: string | null = 'EUR') =>
    setListPrices([
      {
        domainName: 'euro.com',
        amount: currency ? '100' : null,
        minOffer: null,
        floor: null,
        currency,
      },
    ]);
  beforeEach(async () => {
    await flushWrites().catch(() => {});
    store = new MemoryDocStore();
    configureStore(store);
    await hydrateStores();
    resetRateFetch();
    holdEuros();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Answers the Data Portal with `months` and the 90-day file with `days`. */
  const serve = (months: string, days: string) =>
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('data-api.ecb.europa.eu')
        ? new Response(months)
        : new Response(days),
    );
  const urls = () => fetchMock.mock.calls.map(([url]) => String(url));
  const DAYS_URL =
    'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';

  it('does nothing until the host turns it on', async () => {
    expect(await refreshExchangeRates(at(current, 15))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never fetches for a portfolio all in your currency', async () => {
    enableRateFetch();
    expect(ratesNeeded()).toBe(true);
    holdEuros(null);
    expect(ratesNeeded()).toBe(false);
    holdEuros('USD');
    expect(ratesNeeded()).toBe(false);
    expect(await refreshExchangeRates(at(next, 15))).toBe(false);
    // Euros are your currency now: nothing to convert either.
    holdEuros();
    updateSettings({ preferredCurrency: 'EUR' });
    expect(ratesNeeded()).toBe(false);
    // A currency outside the 30 can't be converted, so it needs nothing.
    updateSettings({ preferredCurrency: 'USD' });
    holdEuros(null);
    await store.put('domain-list-prices', 'old.com', {
      amount: '500',
      currency: 'TWD',
      updatedAt: 1,
    });
    await hydrateStores();
    expect(ratesNeeded()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the days of the month with no average, then waits a week', async () => {
    enableRateFetch();
    serve(
      '',
      xml({
        [dayOf(current, 14)]: { USD: 1.12, GBP: 0.84 },
        [dayOf(current, 1)]: { USD: 1.1 },
        [dayOf(archived, 28)]: { USD: 1.05 },
      }),
    );
    expect(await refreshExchangeRates(at(current, 15))).toBe(true);
    // The archive is current, so only the days were fetched.
    expect(urls()).toEqual([DAYS_URL]);
    expect(getExchangeRateRows()).toEqual({
      [dayOf(current, 14)]: { rates: { USD: 1.12, GBP: 0.84 } },
      [dayOf(current, 1)]: { rates: { USD: 1.1 } },
    });
    await flushWrites();
    expect(Object.keys(await store.list('exchange-rates')).sort()).toEqual([
      dayOf(current, 1),
      dayOf(current, 14),
    ]);

    await refreshExchangeRates(at(current, 15));
    await refreshExchangeRates(at(current, 21));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await refreshExchangeRates(at(current, 22));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetches nothing in the first week after the newest average', async () => {
    enableRateFetch();
    serve('', xml({}));
    expect(await refreshExchangeRates(at(current, 6))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the month that ended, then drops its days', async () => {
    enableRateFetch();
    serve('', xml({ [dayOf(current, 19)]: { USD: 1.1 } }));
    await refreshExchangeRates(at(current, 20));
    expect(Object.keys(getExchangeRateRows())).toEqual([dayOf(current, 19)]);

    fetchMock.mockReset();
    serve(
      csv([
        ['USD', current, 1.11],
        ['GBP', current, 0.85],
      ]),
      xml({
        [dayOf(next, 9)]: { USD: 1.2 },
        [dayOf(current, 19)]: { USD: 1.1 },
      }),
    );
    expect(await refreshExchangeRates(at(next, 10))).toBe(true);
    expect(urls()[0]).toContain(`?startPeriod=${current}&`);
    expect(getExchangeRateRows()).toEqual({
      [current]: { rates: { USD: 1.11, GBP: 0.85 } },
      [dayOf(next, 9)]: { rates: { USD: 1.2 } },
    });
    const fx = new ExchangeRates(getExchangeRateRows());
    expect(fx.convert(100, 'EUR', 'USD', dayOf(current, 20))).toEqual({
      amount: 111,
      period: current,
      provisional: false,
    });
  });

  it('waits a day before asking again for an average that isn’t out', async () => {
    enableRateFetch();
    const now = at(next, 2);
    serve('', xml({ [dayOf(current, 30)]: { USD: 1.2 } }));
    await refreshExchangeRates(now);
    const monthCalls = () =>
      urls().filter((url) => url.includes('data-api')).length;
    expect(monthCalls()).toBe(1);

    await refreshExchangeRates(new Date(now.getTime() + 12 * HOUR));
    expect(monthCalls()).toBe(1);
    await refreshExchangeRates(new Date(now.getTime() + 25 * HOUR));
    expect(monthCalls()).toBe(2);
  });

  it('keeps what it holds when the ECB fails, and retries a day later', async () => {
    enableRateFetch();
    const now = at(current, 15);
    serve('', xml({ [dayOf(current, 1)]: { USD: 1.1 } }));
    await refreshExchangeRates(now);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }));
    expect(await refreshExchangeRates(at(current, 16))).toBe(false);
    expect(Object.keys(getExchangeRateRows())).toEqual([dayOf(current, 1)]);
    expect(console.error).toHaveBeenCalledWith(
      '[exchange-rates] days failed:',
      'the ECB answered 503',
    );
    await refreshExchangeRates(new Date(at(current, 16).getTime() + HOUR));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await refreshExchangeRates(at(current, 17));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('drops a fetched month that the archive now ships', async () => {
    await store.put('exchange-rates', archived, { rates: { USD: 1 } });
    await hydrateStores();
    enableRateFetch();
    serve('', xml({ [dayOf(current, 14)]: { USD: 1.2 } }));
    await refreshExchangeRates(at(current, 15));
    expect(Object.keys(getExchangeRateRows())).toEqual([dayOf(current, 14)]);
  });

  it('runs once for overlapping calls, and Clear cache empties it', async () => {
    enableRateFetch();
    serve('', xml({ [dayOf(current, 14)]: { USD: 1.2 } }));
    const [a, b] = await Promise.all([
      refreshExchangeRates(at(current, 15)),
      refreshExchangeRates(at(current, 15)),
    ]);
    expect([a, b]).toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clearAll();
    expect(getExchangeRateRows()).toEqual({});
  });
});
