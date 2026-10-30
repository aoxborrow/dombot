import { RATE_CURRENCIES, isRateCurrency } from '../../shared/currencies';
import {
  ExchangeRates,
  isDayKey,
  isMonthKey,
  type RateRow,
  type RateRows,
  type Rates,
} from '../../shared/exchange-rates';
import { userAgentHeaders } from '../app-info';
import { Namespace } from '../storage/namespace';

// Keeps the European Central Bank rates DomBot converts with current
// (docs/exchange-rates.md): the months whose average came out after the
// shipped archive was built, and the days of any month whose average isn't
// out yet. Runs on the host (Electron main, the Worker) when DomBot syncs,
// never blocking a view; offline, conversions use what's held. The renderer
// reads the rows through the API and converts with the same shared module.
//
// Off until a host turns it on, so the demo and tests never reach the network.

const store = new Namespace<RateRow>('exchange-rates', { cache: true });

const QUOTED = RATE_CURRENCIES.filter((code) => code !== 'EUR');
const DAYS_URL =
  'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
const monthsUrl = (from: string) =>
  `https://data-api.ecb.europa.eu/service/data/EXR/M.${QUOTED.join('+')}.EUR.SP00.A` +
  `?startPeriod=${from}&format=csvdata&detail=dataonly`;

const TIMEOUT_MS = 10_000;
/** After a fetch that didn't bring what it expected (a holiday, an average
 *  that isn't out yet, an error), the next try waits this long. */
const RETRY_MS = 6 * 60 * 60 * 1000;
/** The ECB publishes around 16:00 CET; by this hour UTC a weekday's is out. */
const PUBLISHED_BY_UTC_HOUR = 16;

let enabled = false;
const missedAt = { months: 0, days: 0 };
let inFlight: Promise<boolean> | null = null;

/** Lets this host fetch rates (desktop, the Worker). */
export function enableRateFetch(): void {
  enabled = true;
}

/** Test hook: back to off, nothing missed. */
export function resetRateFetch(): void {
  enabled = false;
  missedAt.months = 0;
  missedAt.days = 0;
  inFlight = null;
}

/** The fetched rows, as stored. */
export function getExchangeRateRows(): RateRows {
  return store.all();
}

/** The archive plus what's been fetched, for converting in core (MCP). */
export function exchangeRates(): ExchangeRates {
  return new ExchangeRates(store.all());
}

function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** The newest business day whose rates are out by `now`. Only weekends are
 *  known; a TARGET holiday just costs one fetch that finds nothing new. */
export function expectedDay(now: Date): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  if (now.getUTCHours() < PUBLISHED_BY_UTC_HOUR)
    d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
    d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The ECB Data Portal's monthly averages (`csvdata`, `detail=dataonly`, so
 *  no field is quoted), six significant digits like the archive. */
export function parseMonthlyCsv(text: string): Map<string, Rates> {
  const months = new Map<string, Rates>();
  const [head, ...lines] = text.trim().split(/\r?\n/);
  if (!head) return months;
  const header = head.split(',');
  const [code, period, value] = ['CURRENCY', 'TIME_PERIOD', 'OBS_VALUE'].map(
    (name) => header.indexOf(name),
  );
  if (code < 0 || period < 0 || value < 0)
    throw new Error("The ECB's monthly rates came in an unexpected format");
  for (const line of lines) {
    const fields = line.split(',');
    const currency = fields[code];
    const month = fields[period];
    const rate = Number(fields[value]);
    if (!isRateCurrency(currency) || currency === 'EUR') continue;
    if (!isMonthKey(month) || !Number.isFinite(rate) || rate <= 0) continue;
    const rates = months.get(month) ?? {};
    rates[currency] = Number(rate.toPrecision(6));
    months.set(month, rates);
  }
  return months;
}

/** The ECB's eurofxref XML (the daily or the 90-day file), by day. */
export function parseDailyXml(text: string): Map<string, Rates> {
  const days = new Map<string, Rates>();
  const dayCubes =
    /<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']\s*>(.*?)<\/Cube>/gs;
  const rateCubes = /currency=["']([A-Z]{3})["']\s+rate=["']([\d.]+)["']/g;
  for (const [, day, body] of text.matchAll(dayCubes)) {
    const rates: Rates = {};
    for (const [, currency, value] of body.matchAll(rateCubes)) {
      const rate = Number(value);
      if (isRateCurrency(currency) && currency !== 'EUR' && rate > 0)
        rates[currency] = rate;
    }
    if (Object.keys(rates).length > 0) days.set(day, rates);
  }
  return days;
}

async function get(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: userAgentHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // The Data Portal answers 404 for a period with nothing in it yet.
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`the ECB answered ${res.status}`);
  return res.text();
}

/**
 * Fetches what's missing, best effort:
 *
 * 1. Months: when the newest average held (archive or fetched) is older than
 *    last month, every month after it.
 * 2. Days: when the newest day held is older than the newest business day
 *    whose rates are out, the 90-day file, keeping the days of months with
 *    no average.
 * 3. Prune: days of months that now have an average, and fetched months the
 *    archive already has (after an update ships a newer one).
 *
 * Returns true when it changed what's held. One run at a time.
 */
export function refreshExchangeRates(now = new Date()): Promise<boolean> {
  if (!enabled) return Promise.resolve(false);
  inFlight ??= refresh(now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function refresh(now: Date): Promise<boolean> {
  const time = now.getTime();
  const lastMonth = shiftMonth(now.toISOString().slice(0, 7), -1);
  let changed = false;

  const before = new ExchangeRates(store.all());
  const newestMonth = before.newestMonth;
  if (
    (!newestMonth || newestMonth < lastMonth) &&
    time - missedAt.months >= RETRY_MS
  ) {
    try {
      const from = newestMonth ? shiftMonth(newestMonth, 1) : '2000-01';
      const months = parseMonthlyCsv(await get(monthsUrl(from)));
      for (const [month, rates] of months) {
        // A month still running (the Portal can publish one early) waits.
        if (month > lastMonth) continue;
        void store.set(month, { rates });
        changed = true;
      }
      if (!months.has(lastMonth)) missedAt.months = time;
    } catch (err) {
      missedAt.months = time;
      console.error('[exchange-rates] months failed:', errorText(err));
    }
  }

  const held = new ExchangeRates(store.all());
  const expected = expectedDay(now);
  if ((held.newestDay ?? '') < expected && time - missedAt.days >= RETRY_MS) {
    try {
      const days = parseDailyXml(await get(DAYS_URL));
      for (const [day, rates] of days) {
        if (held.hasMonth(day.slice(0, 7)) || store.has(day)) continue;
        void store.set(day, { rates });
        changed = true;
      }
      if (!days.has(expected)) missedAt.days = time;
    } catch (err) {
      missedAt.days = time;
      console.error('[exchange-rates] days failed:', errorText(err));
    }
  }

  const archive = new ExchangeRates();
  for (const key of Object.keys(store.all())) {
    const stale = isDayKey(key)
      ? held.hasMonth(key.slice(0, 7))
      : archive.hasMonth(key);
    if (stale) {
      void store.delete(key);
      changed = true;
    }
  }
  return changed;
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError')
    return 'the ECB did not answer in time';
  return err instanceof Error ? err.message : String(err);
}
