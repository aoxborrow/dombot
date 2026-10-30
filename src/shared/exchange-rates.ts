import archiveData from '../../data/exchange-rates.json';
import {
  CURRENCIES,
  isCurrencyCode,
  isRateCurrency,
  type RateCurrency,
} from './currencies';

// Converts amounts between the 30 currencies DomBot converts, with the
// European Central Bank's euro reference rates (docs/exchange-rates.md). Past
// months use their average: the archive that ships with the app
// (data/exchange-rates.json, `npm run rates:build`) plus any month fetched
// since. A month whose average isn't out yet uses the days fetched so far.
//
// Pure: the hosts fetch and store the rows (core/services/exchange-rates.ts),
// the renderer gets them from the API, and both convert with this module, so
// they agree. Nothing converted is ever stored.

/** Units of each currency per euro on one period. EUR itself (1) is left out. */
export type Rates = Partial<Record<RateCurrency, number>>;

/** A stored row, keyed `YYYY-MM` (a month's average) or `YYYY-MM-DD` (a day). */
export interface RateRow {
  rates: Rates;
}

export type RateRows = Record<string, RateRow>;

/** data/exchange-rates.json: one array per month, in `currencies` order. */
export interface RateArchive {
  base: 'EUR';
  currencies: string[];
  months: Record<string, (number | null)[]>;
}

export interface Conversion {
  /** In the target currency, rounded to its minor units. */
  amount: number;
  /** The rate used: a month (`2024-03`) or a day (`2026-10-28`); null when
   *  both currencies were the same. */
  period: string | null;
  /** Anything but the amount's own month's average: it changes once that
   *  average is out. */
  provisional: boolean;
}

interface Pick {
  period: string;
  rates: Rates;
  provisional: boolean;
}

export const isMonthKey = (key: string) => /^\d{4}-\d{2}$/.test(key);
export const isDayKey = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(key);

/** The archive's months as rates, dropping the currencies a month has none for. */
export function archiveMonths(archive: RateArchive): Map<string, Rates> {
  const months = new Map<string, Rates>();
  for (const [month, values] of Object.entries(archive.months)) {
    const rates: Rates = {};
    archive.currencies.forEach((code, i) => {
      const value = values[i];
      if (isRateCurrency(code) && typeof value === 'number' && value > 0)
        rates[code] = value;
    });
    months.set(month, rates);
  }
  return months;
}

const ARCHIVE = archiveMonths(archiveData as RateArchive);

/** Rounds to the currency's minor units (JPY to whole yen, USD to cents). */
export function roundTo(amount: number, currency: string): number {
  const decimals = isCurrencyCode(currency) ? CURRENCIES[currency] : 2;
  const factor = 10 ** decimals;
  return Math.round(amount * factor) / factor;
}

export class ExchangeRates {
  private readonly months: Map<string, Rates>;
  /** Day keys, oldest first. */
  private readonly days: string[];
  private readonly dayRates = new Map<string, Rates>();

  /** `rows`: what's been fetched; a fetched month wins over the archive's. */
  constructor(rows: RateRows = {}, archive: Map<string, Rates> = ARCHIVE) {
    this.months = new Map(archive);
    for (const [key, row] of Object.entries(rows)) {
      if (isMonthKey(key)) this.months.set(key, row.rates);
      else if (isDayKey(key)) this.dayRates.set(key, row.rates);
    }
    this.days = [...this.dayRates.keys()].sort();
  }

  /** The newest month with an average, archived or fetched. */
  get newestMonth(): string | null {
    let newest: string | null = null;
    for (const month of this.months.keys())
      if (!newest || month > newest) newest = month;
    return newest;
  }

  /** The newest day held, or null. */
  get newestDay(): string | null {
    return this.days.at(-1) ?? null;
  }

  hasMonth(month: string): boolean {
    return this.months.has(month);
  }

  /**
   * The rates for an amount dated `date` (`YYYY-MM-DD`), or for a
   * forward-looking one (null: next year's renewal, an asking price):
   *
   * 1. The date's month has an average: that.
   * 2. Days held in its month: its own, else the nearest earlier one, else
   *    the nearest later one. Provisional.
   * 3. Nothing held for its month (past everything held, or a month that was
   *    never fetched): the newest rate held before it. Provisional.
   * 4. Nothing before it (before 2000): null.
   */
  ratesFor(date?: string | null): Pick | null {
    if (!date) return this.newestBefore(null);
    const month = date.slice(0, 7);
    const average = this.months.get(month);
    if (average) return { period: month, rates: average, provisional: false };
    const inMonth = this.days.filter((day) => day.startsWith(month));
    if (inMonth.length > 0) {
      const day = inMonth.findLast((d) => d <= date) ?? inMonth[0];
      return { period: day, rates: this.dayRates.get(day)!, provisional: true };
    }
    return this.newestBefore(date);
  }

  /**
   * `amount` in `from`, in `to`: `amount × rate[to] / rate[from]` from one
   * period's rates (see `ratesFor`), rounded to `to`'s minor units. Null when
   * either currency isn't one of the 30, or the period has no rate for it
   * (ISK from 2009-01 to 2018-01).
   */
  convert(
    amount: number | string,
    from: string,
    to: string,
    date?: string | null,
  ): Conversion | null {
    const value = typeof amount === 'string' ? Number(amount) : amount;
    if (!Number.isFinite(value)) return null;
    if (from === to)
      return { amount: roundTo(value, to), period: null, provisional: false };
    if (!isRateCurrency(from) || !isRateCurrency(to)) return null;
    const pick = this.ratesFor(date);
    if (!pick) return null;
    const rateOf = (code: RateCurrency) =>
      code === 'EUR' ? 1 : pick.rates[code];
    const a = rateOf(from);
    const b = rateOf(to);
    if (!a || !b) return null;
    return {
      amount: roundTo((value * b) / a, to),
      period: pick.period,
      provisional: pick.provisional,
    };
  }

  /** The newest period held before `date` (null: the newest of all). A day
   *  wins only when it's in a later month than the newest average. */
  private newestBefore(date: string | null): Pick | null {
    const month = date?.slice(0, 7);
    let average: string | null = null;
    for (const m of this.months.keys())
      if ((!month || m < month) && (!average || m > average)) average = m;
    const day = date ? this.days.findLast((d) => d < date) : this.days.at(-1);
    if (day && (!average || day.slice(0, 7) > average))
      return { period: day, rates: this.dayRates.get(day)!, provisional: true };
    if (average)
      return {
        period: average,
        rates: this.months.get(average)!,
        provisional: true,
      };
    return null;
  }
}
