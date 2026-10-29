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
// Amounts are summed in cents, so totals are exact decimal strings.

const cents = (amount: string | null | undefined) =>
  amount ? Math.round(Number(amount) * 100) : 0;
const decimal = (n: number) => (n / 100).toFixed(2);

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
}

/**
 * Completed sales per year in one currency, newest year first. In-progress
 * and cancelled sales are counted beside them, not in the money.
 */
export function salesByYear(
  sales: readonly MarketSale[],
  currency = 'USD',
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
    }
  >();
  for (const s of sales) {
    if (!s.soldOn || s.currency !== currency) continue;
    const year = s.soldOn.slice(0, 4);
    const y = years.get(year) ?? {
      sold: 0,
      inProgress: 0,
      cancelled: 0,
      gross: 0,
      commission: 0,
      net: 0,
    };
    if (s.status === 'completed') {
      y.sold++;
      y.gross += cents(s.price);
      y.commission += cents(s.commission);
      y.net +=
        s.net != null ? cents(s.net) : cents(s.price) - cents(s.commission);
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
      gross: decimal(y.gross),
      commission: decimal(y.commission),
      net: decimal(y.net),
      average: y.sold ? decimal(Math.round(y.gross / y.sold)) : null,
    }));
}

/** The whole history's totals, as one row. */
export function salesTotal(
  years: readonly SalesYear[],
): Omit<SalesYear, 'year'> {
  const sum = (f: 'gross' | 'commission' | 'net') =>
    years.reduce((n, y) => n + cents(y[f]), 0);
  const sold = years.reduce((n, y) => n + y.sold, 0);
  return {
    sold,
    inProgress: years.reduce((n, y) => n + y.inProgress, 0),
    cancelled: years.reduce((n, y) => n + y.cancelled, 0),
    gross: decimal(sum('gross')),
    commission: decimal(sum('commission')),
    net: decimal(sum('net')),
    average: sold ? decimal(Math.round(sum('gross') / sold)) : null,
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
 */
export function sellThrough(
  sales: readonly MarketSale[],
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
  views30: number;
  /** GoDaddy searches, last 30 days; null without search data. */
  searches30: number | null;
}

/**
 * The names with the most interest: by leads, then views, then searches
 * (Discount Domain Club Domain Pro only), so a name buyers search for shows
 * even before any visits.
 */
export function namesOfInterest(
  traffic: Readonly<
    Record<string, { leads365: number; views365: number; views30: number }>
  >,
  listings: readonly MarketListing[],
  limit = 15,
): NameInterest[] {
  const searches = new Map<string, number>();
  for (const l of listings) {
    const n = searchesOf(l)?.total.days30;
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
      views30: traffic[name]?.views30 ?? 0,
      searches30: searches.get(name) ?? null,
    }))
    .sort(
      (a, b) =>
        b.leads365 - a.leads365 ||
        b.views365 - a.views365 ||
        (b.searches30 ?? 0) - (a.searches30 ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}
