import { currencyDecimals, isCurrencyCode } from './currencies';
import type { ExchangeRates } from './exchange-rates';
import {
  searchesOf,
  type MarketListing,
  type MarketSale,
  type MarketStatsDay,
} from './markets';

// Market reporting (docs/afternic-api.md, "Reporting"): sales by year, traffic
// by month, sell-through and search demand, from what market sync stored.
// Pure, so the Markets page and the MCP tools compute the same numbers.
//
// Amounts are summed in thousandths, enough for every currency's minor unit,
// so totals are exact decimal strings in the currency's own places ("1500"
// in yen, "1500.00" in dollars). Money is in one currency: a sale in another
// is converted at its own month's average (docs/exchange-rates.md), and one
// DomBot can't convert is left out and counted.

const SCALE = 1000;
const units = (amount: string | null | undefined) =>
  amount ? Math.round(Number(amount) * SCALE) : 0;
/** Thousandths as a decimal in the currency's places, rounded in its minor
 *  units (so 989.045 is 989.05, not the float's 989.04). */
function decimal(n: number, currency: string): string {
  const places = isCurrencyCode(currency) ? currencyDecimals(currency) : 2;
  const minor = Math.round(n / (SCALE / 10 ** places));
  return (minor / 10 ** places).toFixed(places);
}

/** A sale's amounts in `currency`, in thousandths, or null when they can't
 *  be converted. Dated by `soldOn`; one with no date takes the newest rate. */
function saleUnits(
  s: MarketSale,
  currency: string,
  fx: ExchangeRates | undefined,
): {
  of: (amount: string | null | undefined) => number;
  provisional: boolean;
} | null {
  if (s.currency === currency) return { of: units, provisional: false };
  const probe = fx?.convert(0, s.currency, currency, s.soldOn);
  if (!fx || !probe) return null;
  return {
    of: (amount) =>
      amount
        ? Math.round(
            fx.convert(amount, s.currency, currency, s.soldOn)!.amount * SCALE,
          )
        : 0,
    provisional: probe.provisional,
  };
}

export interface CurrencyCount {
  currency: string;
  count: number;
}

/** What you were paid: the market's net, else price less commission. */
function netOf(
  s: MarketSale,
  of: (amount: string | null | undefined) => number,
): number {
  return s.net != null ? of(s.net) : of(s.price) - of(s.commission);
}

function addCount(counts: CurrencyCount[], currency: string, n = 1): void {
  const c = counts.find((x) => x.currency === currency);
  if (c) c.count += n;
  else counts.push({ currency, count: n });
  counts.sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface SalesYear {
  year: string;
  /** Completed sales. */
  sold: number;
  /** Sales still under way (transfer, payout). */
  inProgress: number;
  cancelled: number;
  gross: string;
  commission: string;
  net: string;
  /** Gross ÷ sold; null with no sales. */
  average: string | null;
  /** Some of the money uses a recent rate until its month's average
   *  is out. */
  provisional: boolean;
  /** Completed sales DomBot can't convert, left out of `sold` and the money. */
  leftOut: CurrencyCount[];
}

/**
 * Completed sales per year in `currency`, newest year first, each converted
 * at its month's average with `fx` when it's in another currency (without
 * `fx`, only sales already in `currency` count). In-progress and cancelled
 * sales are counted beside them, in any currency, not in the money.
 */
export function salesByYear(
  sales: readonly MarketSale[],
  currency = 'USD',
  fx?: ExchangeRates,
): SalesYear[] {
  const years = new Map<
    string,
    {
      sold: number;
      inProgress: number;
      cancelled: number;
      gross: number;
      commission: number;
      net: number;
      provisional: boolean;
      leftOut: CurrencyCount[];
    }
  >();
  for (const s of sales) {
    if (!s.soldOn) continue;
    const year = s.soldOn.slice(0, 4);
    const y = years.get(year) ?? {
      sold: 0,
      inProgress: 0,
      cancelled: 0,
      gross: 0,
      commission: 0,
      net: 0,
      provisional: false,
      leftOut: [],
    };
    if (s.status === 'completed') {
      const money = saleUnits(s, currency, fx);
      if (money) {
        y.sold++;
        y.gross += money.of(s.price);
        y.commission += money.of(s.commission);
        y.net += netOf(s, money.of);
        y.provisional ||= money.provisional;
      } else addCount(y.leftOut, s.currency);
    } else if (s.status === 'cancelled') y.cancelled++;
    else if (s.status === 'in_progress') y.inProgress++;
    years.set(year, y);
  }
  return [...years]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([year, y]) => ({
      year,
      sold: y.sold,
      inProgress: y.inProgress,
      cancelled: y.cancelled,
      gross: decimal(y.gross, currency),
      commission: decimal(y.commission, currency),
      net: decimal(y.net, currency),
      average: y.sold ? decimal(Math.round(y.gross / y.sold), currency) : null,
      provisional: y.provisional,
      leftOut: y.leftOut,
    }));
}

/** The whole history's totals, as one row, in the years' `currency`. */
export function salesTotal(
  years: readonly SalesYear[],
  currency = 'USD',
): Omit<SalesYear, 'year'> {
  const sum = (f: 'gross' | 'commission' | 'net') =>
    years.reduce((n, y) => n + units(y[f]), 0);
  const sold = years.reduce((n, y) => n + y.sold, 0);
  const leftOut: CurrencyCount[] = [];
  for (const y of years)
    for (const c of y.leftOut) addCount(leftOut, c.currency, c.count);
  return {
    sold,
    inProgress: years.reduce((n, y) => n + y.inProgress, 0),
    cancelled: years.reduce((n, y) => n + y.cancelled, 0),
    gross: decimal(sum('gross'), currency),
    commission: decimal(sum('commission'), currency),
    net: decimal(sum('net'), currency),
    average: sold ? decimal(Math.round(sum('gross') / sold), currency) : null,
    provisional: years.some((y) => y.provisional),
    leftOut,
  };
}

export interface ConvertedTotals {
  currency: string;
  price: string;
  commission: string;
  net: string;
  /** Some amounts use a recent rate until their month's average is out. */
  provisional: boolean;
  /** Sales DomBot can't convert, left out of the sums. */
  leftOut: CurrencyCount[];
}

/** Price, commission and net over `sales`, all in `currency`. A sale with no
 *  net counts price less commission, as `salesByYear` does. */
export function convertedTotals(
  sales: readonly MarketSale[],
  currency: string,
  fx: ExchangeRates,
): ConvertedTotals {
  let price = 0;
  let commission = 0;
  let net = 0;
  let provisional = false;
  const leftOut: CurrencyCount[] = [];
  for (const s of sales) {
    const money = saleUnits(s, currency, fx);
    if (!money) {
      addCount(leftOut, s.currency);
      continue;
    }
    price += money.of(s.price);
    commission += money.of(s.commission);
    net += netOf(s, money.of);
    provisional ||= money.provisional;
  }
  return {
    currency,
    price: decimal(price, currency),
    commission: decimal(commission, currency),
    net: decimal(net, currency),
    provisional,
    leftOut,
  };
}

export interface TrafficMonth {
  /** YYYY-MM. */
  month: string;
  views: number;
  leads: number;
}

/** Daily stats summed by month, oldest first; several accounts add up. */
export function trafficByMonth(
  days: readonly MarketStatsDay[],
): TrafficMonth[] {
  const months = new Map<string, TrafficMonth>();
  for (const d of days) {
    const month = d.date.slice(0, 7);
    const m = months.get(month) ?? { month, views: 0, leads: 0 };
    m.views += d.views ?? 0;
    m.leads += d.leads ?? 0;
    months.set(month, m);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface SellThrough {
  /** Names sold in the last 12 months. */
  sold: number;
  /** Listed now, plus what sold: what could have sold. */
  available: number;
  /** sold ÷ available; null with nothing listed. */
  rate: number | null;
}

/**
 * How much of the listed portfolio sold in the last 12 months: completed
 * sales over the names listed now plus the ones that sold (they've left the
 * listings). An estimate: listings that came and went unsold aren't known.
 * `sales` can be market sales or every sale record (src/shared/sales.ts).
 */
export function sellThrough(
  sales: readonly Pick<MarketSale, 'name' | 'status' | 'soldOn'>[],
  listings: readonly MarketListing[],
  today: string,
): SellThrough {
  const since = new Date(Date.parse(today) - 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const sold = new Set(
    sales
      .filter((s) => s.status === 'completed' && s.soldOn && s.soldOn >= since)
      .map((s) => s.name),
  );
  const listed = new Set(listings.map((l) => l.name));
  const available = new Set([...listed, ...sold]).size;
  return {
    sold: sold.size,
    available,
    rate: available ? sold.size / available : null,
  };
}

/** One name's interest: its traffic, and its searches where they come. */
export interface NameInterest {
  name: string;
  leads365: number;
  views365: number;
  /** GoDaddy searches, last 365 days; null without search data. */
  searches365: number | null;
}

/**
 * The names with the most interest: by leads, then views, then searches
 * (Discount Domain Club Domain Pro only), so a name buyers search for shows
 * even before any visits.
 */
export function namesOfInterest(
  traffic: Readonly<Record<string, { leads365: number; views365: number }>>,
  listings: readonly MarketListing[],
  limit = 15,
): NameInterest[] {
  const searches = new Map<string, number>();
  for (const l of listings) {
    const n = searchesOf(l)?.total.days365;
    if (n != null) searches.set(l.name, Math.max(n, searches.get(l.name) ?? 0));
  }
  const names = new Set([
    ...Object.entries(traffic)
      .filter(([, t]) => t.views365 || t.leads365)
      .map(([name]) => name),
    ...[...searches].filter(([, n]) => n > 0).map(([name]) => name),
  ]);
  return [...names]
    .map((name) => ({
      name,
      leads365: traffic[name]?.leads365 ?? 0,
      views365: traffic[name]?.views365 ?? 0,
      searches365: searches.get(name) ?? null,
    }))
    .sort(
      (a, b) =>
        b.leads365 - a.leads365 ||
        b.views365 - a.views365 ||
        (b.searches365 ?? 0) - (a.searches365 ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}
