import { domainKey } from '../../shared/account-key';
// Pure aggregation over the portfolio + renewal pricing, for the Renewals
// dashboard. No React, no IPC — just numbers in, numbers out. A price keeps
// its own currency; totals are in your preferred currency, with every other
// price converted at the newest exchange rate held (docs/exchange-rates.md).
// A price DomBot can't convert (outside the 30) is left out of the totals and
// listed (`leftOut`).

import type { ExchangeRates } from '../../shared/exchange-rates';
import type { Domain, RenewalPricing } from '../../shared/ipc';

/** Stable per-domain key, matching the store's `pricing` map keys. */
export function priceKey(d: Domain): string {
  return domainKey(d);
}

/** The pricing record for a domain, if fetched. */
export function priceOf(
  d: Domain,
  pricing: Record<string, RenewalPricing>,
): RenewalPricing | undefined {
  return pricing[priceKey(d)];
}

/**
 * A price's yearly renewal in `currency`: its own, or converted at the newest
 * rate in `fx` (a renewal is ahead of you). Null when there's no price, or
 * it's in a currency `fx` can't convert (or there's no `fx`).
 */
function inCurrency(
  p: RenewalPricing | undefined,
  currency: string,
  fx?: ExchangeRates,
): number | null {
  if (p?.renewal == null) return null;
  if (p.currency === currency) return p.renewal;
  return fx?.convert(p.renewal, p.currency, currency)?.amount ?? null;
}

/** A domain's known yearly renewal in `currency`, else null. */
function renewalOf(
  d: Domain,
  pricing: Record<string, RenewalPricing>,
  currency: string,
  fx?: ExchangeRates,
): number | null {
  return inCurrency(priceOf(d, pricing), currency, fx);
}

export interface CurrencyTotal {
  currency: string;
  /** Names priced in this currency. */
  count: number;
  /** Sum of their known annual renewals, in this currency. */
  yearly: number;
}

/** Adds a renewal DomBot can't convert to `totals` (largest count first). */
function addLeftOut(totals: CurrencyTotal[], currency: string, amount: number) {
  const t = totals.find((o) => o.currency === currency);
  if (t) {
    t.count += 1;
    t.yearly += amount;
  } else totals.push({ currency, count: 1, yearly: amount });
  totals.sort(
    (a, b) => b.count - a.count || a.currency.localeCompare(b.currency),
  );
}

/** A price with its currency symbol and up to two decimals, e.g. "$12.99" or "€9". */
export function priceMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`;
  }
}

/** A whole amount with its currency symbol, e.g. "$1,240" or "€45". */
export function wholeMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(Math.round(n));
  } catch {
    return `${Math.round(n).toLocaleString('en-US')} ${currency}`;
  }
}

/** Compact whole amount: "$820", "$4.2k", "$23.1k", "€120k". */
export function compactMoney(n: number, currency: string): string {
  if (n < 1000) return wholeMoney(n, currency);
  const k = n / 1000;
  const symbol = wholeMoney(0, currency).replace(/[\d\s.,]/g, '');
  return `${symbol}${k < 100 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)}k`;
}

/** Everything after the first dot, lowercased. "example.co.uk" → "co.uk". */
export function tldOf(domainName: string): string {
  const dot = domainName.indexOf('.');
  return dot === -1 ? '' : domainName.slice(dot + 1).toLowerCase();
}

export interface RenewalSummary {
  /** The currency the yearly figures are in: your preferred one. */
  currency: string;
  /** Total domains considered. */
  total: number;
  /** Domains with a known price (any source, any currency). */
  priced: number;
  /** Domains still without a price. */
  unpriced: number;
  /** Priced domains filled from the base per-TLD database (may miss premiums). */
  base: number;
  /** Priced domains using a shopper registrar + TLD rate. */
  tld: number;
  /** Priced domains using a manual override. */
  manual: number;
  /** Sum of known annual renewals in `currency`, converted where needed. */
  yearly: number;
  /** Committed spend: known renewals for auto-renew-on domains only. */
  yearlyAutoRenew: number;
  /** Average annual renewal across the domains in `yearly`. */
  avgPerDomain: number;
  /** Prices converted from another currency into `currency`. */
  converted: number;
  /** The currencies they were in, alphabetically. */
  convertedFrom: string[];
  /** Known renewals DomBot can't convert, left out of the totals. */
  leftOut: CurrencyTotal[];
}

export function summarize(
  domains: Domain[],
  pricing: Record<string, RenewalPricing>,
  currency = 'USD',
  fx?: ExchangeRates,
): RenewalSummary {
  let priced = 0;
  let base = 0;
  let tld = 0;
  let manual = 0;
  let yearly = 0;
  let yearlyAutoRenew = 0;
  let counted = 0;
  let converted = 0;
  const convertedFrom = new Set<string>();
  const leftOut: CurrencyTotal[] = [];

  for (const d of domains) {
    const p = priceOf(d, pricing);
    if (p?.renewal == null) continue;
    priced += 1;
    const value = inCurrency(p, currency, fx);
    if (value != null) {
      counted += 1;
      yearly += value;
      if (d.autoRenew) yearlyAutoRenew += value;
      if (p.currency !== currency) {
        converted += 1;
        convertedFrom.add(p.currency);
      }
    } else addLeftOut(leftOut, p.currency, p.renewal);
    if (p?.source === 'base') base += 1;
    if (p?.source === 'tld') tld += 1;
    if (p?.source === 'manual') manual += 1;
  }

  return {
    currency,
    total: domains.length,
    priced,
    unpriced: domains.length - priced,
    base,
    tld,
    manual,
    yearly,
    yearlyAutoRenew,
    avgPerDomain: counted > 0 ? yearly / counted : 0,
    converted,
    convertedFrom: [...convertedFrom].sort(),
    leftOut,
  };
}

export interface Group {
  key: string;
  label: string;
  /** Domains in the group. */
  count: number;
  /** Domains in the group with a known price in the currency. */
  priced: number;
  /** Sum of known annual renewals in the group, in the currency. */
  yearly: number;
}

/**
 * Groups domains by a key, summing known renewals in `currency`; sorted by
 * spend desc.
 */
export function groupBy(
  domains: Domain[],
  pricing: Record<string, RenewalPricing>,
  keyOf: (d: Domain) => string,
  labelOf: (key: string) => string,
  currency = 'USD',
  fx?: ExchangeRates,
): Group[] {
  const groups = new Map<string, Group>();
  for (const d of domains) {
    const key = keyOf(d);
    let g = groups.get(key);
    if (!g) {
      g = { key, label: labelOf(key), count: 0, priced: 0, yearly: 0 };
      groups.set(key, g);
    }
    g.count += 1;
    const value = renewalOf(d, pricing, currency, fx);
    if (value != null) {
      g.priced += 1;
      g.yearly += value;
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.yearly - a.yearly || b.count - a.count,
  );
}

export interface MonthBucket {
  /** "YYYY-MM" sort key. */
  key: string;
  /** Display label, e.g. "Aug 2026". */
  label: string;
  /** Domains renewing this month. */
  count: number;
  /** Domains renewing this month that have a known price. */
  priced: number;
  /** Sum of known renewals due this month, in the page's currency. */
  yearly: number;
  /** Renewals due this month that DomBot can't convert. */
  leftOut: CurrencyTotal[];
}

/** The date a domain next comes up for renewal (renewalDate ?? expirationDate). */
function renewalDate(d: Domain): Date | null {
  const raw = d.renewalDate ?? d.expirationDate;
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Upcoming renewals bucketed by calendar month, from this month forward for
 * `months` months. Domains whose next renewal already passed are folded into the
 * current month (they're due now). Every bucket in the window is present, even
 * empty ones, so the calendar renders a continuous strip.
 */
export function upcomingByMonth(
  domains: Domain[],
  pricing: Record<string, RenewalPricing>,
  months = 12,
  currency = 'USD',
  fx?: ExchangeRates,
): MonthBucket[] {
  const now = new Date();
  const startY = now.getFullYear();
  const startM = now.getMonth();

  const buckets: MonthBucket[] = [];
  const index = new Map<string, MonthBucket>();
  for (let i = 0; i < months; i++) {
    const y = startY + Math.floor((startM + i) / 12);
    const m = (startM + i) % 12;
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    const bucket: MonthBucket = {
      key,
      label: `${MONTH_NAMES[m]} ${y}`,
      count: 0,
      priced: 0,
      yearly: 0,
      leftOut: [],
    };
    buckets.push(bucket);
    index.set(key, bucket);
  }
  const firstKey = buckets[0].key;
  const lastKey = buckets[buckets.length - 1].key;

  for (const d of domains) {
    const date = renewalDate(d);
    if (!date) continue;
    let key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    // Past-due renewals count as due now; anything beyond the window is skipped.
    if (key < firstKey) key = firstKey;
    if (key > lastKey) continue;
    const bucket = index.get(key);
    if (!bucket) continue;
    bucket.count += 1;
    const p = priceOf(d, pricing);
    if (p?.renewal == null) continue;
    bucket.priced += 1;
    const value = inCurrency(p, currency, fx);
    if (value != null) bucket.yearly += value;
    else addLeftOut(bucket.leftOut, p.currency, p.renewal);
  }
  return buckets;
}

/**
 * Total known renewal cost in `currency` for domains due within the next
 * `days` days, with any DomBot can't convert listed beside it.
 */
export function dueWithin(
  domains: Domain[],
  pricing: Record<string, RenewalPricing>,
  days: number,
  currency = 'USD',
  fx?: ExchangeRates,
): { count: number; yearly: number; leftOut: CurrencyTotal[] } {
  const cutoff = Date.now() + days * 86_400_000;
  let count = 0;
  let yearly = 0;
  const leftOut: CurrencyTotal[] = [];
  for (const d of domains) {
    const date = renewalDate(d);
    if (!date || date.getTime() > cutoff) continue;
    count += 1;
    const p = priceOf(d, pricing);
    if (p?.renewal == null) continue;
    const value = inCurrency(p, currency, fx);
    if (value != null) yearly += value;
    else addLeftOut(leftOut, p.currency, p.renewal);
  }
  return { count, yearly, leftOut };
}

/** "Leaves out 2 renewals in TWD", "… in KES, TWD"; null with none. */
export function leavesOut(
  leftOut: readonly CurrencyTotal[],
  noun = 'renewal',
): string | null {
  const count = leftOut.reduce((n, t) => n + t.count, 0);
  if (count === 0) return null;
  const codes = leftOut.map((t) => t.currency).sort();
  return `Leaves out ${count} ${noun}${count === 1 ? '' : 's'} in ${codes.join(', ')}`;
}
