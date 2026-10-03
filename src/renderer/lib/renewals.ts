import { domainKey } from '../../shared/account-key';
// Pure aggregation over the portfolio + renewal pricing, for the Renewals
// dashboard. No React, no IPC — just numbers in, numbers out. A price carries
// its own currency and DomBot never converts, so every total is in one
// currency (`mainCurrency`) and the rest are listed beside it
// (`otherCurrencies`).

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

/** A known annual renewal price in `currency` for a domain, else null. */
function renewalOf(
  d: Domain,
  pricing: Record<string, RenewalPricing>,
  currency: string,
): number | null {
  const p = priceOf(d, pricing);
  return p && p.renewal != null && p.currency === currency ? p.renewal : null;
}

/** The currency most priced names renew in; USD when nothing is priced. */
export function mainCurrency(
  domains: Domain[],
  pricing: Record<string, RenewalPricing>,
): string {
  const counts = new Map<string, number>();
  for (const d of domains) {
    const p = priceOf(d, pricing);
    if (p?.renewal != null)
      counts.set(p.currency, (counts.get(p.currency) ?? 0) + 1);
  }
  let best = 'USD';
  let most = 0;
  for (const [currency, n] of counts) {
    if (n > most || (n === most && currency === 'USD')) {
      best = currency;
      most = n;
    }
  }
  return best;
}

export interface CurrencyTotal {
  currency: string;
  /** Names priced in this currency. */
  count: number;
  /** Sum of their known annual renewals. */
  yearly: number;
}

/** Known renewals in every currency but `currency`, largest count first. */
export function otherCurrencies(
  domains: Domain[],
  pricing: Record<string, RenewalPricing>,
  currency: string,
): CurrencyTotal[] {
  const totals = new Map<string, CurrencyTotal>();
  for (const d of domains) {
    const p = priceOf(d, pricing);
    if (p?.renewal == null || p.currency === currency) continue;
    const t = totals.get(p.currency) ?? {
      currency: p.currency,
      count: 0,
      yearly: 0,
    };
    t.count += 1;
    t.yearly += p.renewal;
    totals.set(p.currency, t);
  }
  return [...totals.values()].sort(
    (a, b) => b.count - a.count || a.currency.localeCompare(b.currency),
  );
}

/** Adds a renewal in another currency to `totals` (kept largest count first). */
function addOther(totals: CurrencyTotal[], currency: string, amount: number) {
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

/** Everything after the first dot, lowercased. "example.co.uk" → "co.uk". */
export function tldOf(domainName: string): string {
  const dot = domainName.indexOf('.');
  return dot === -1 ? '' : domainName.slice(dot + 1).toLowerCase();
}

export interface RenewalSummary {
  /** The currency the yearly figures are in (see `mainCurrency`). */
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
  /** Sum of known annual renewals in `currency`. */
  yearly: number;
  /** Committed spend: known renewals for auto-renew-on domains only. */
  yearlyAutoRenew: number;
  /** Average annual renewal across domains priced in `currency`. */
  avgPerDomain: number;
  /** Known renewals in other currencies, left out of the totals. */
  others: CurrencyTotal[];
}

export function summarize(
  domains: Domain[],
  pricing: Record<string, RenewalPricing>,
  currency: string = mainCurrency(domains, pricing),
): RenewalSummary {
  let priced = 0;
  let base = 0;
  let tld = 0;
  let manual = 0;
  let yearly = 0;
  let yearlyAutoRenew = 0;
  let inCurrency = 0;

  for (const d of domains) {
    const p = priceOf(d, pricing);
    if (p?.renewal == null) continue;
    priced += 1;
    const value = renewalOf(d, pricing, currency);
    if (value != null) {
      inCurrency += 1;
      yearly += value;
      if (d.autoRenew) yearlyAutoRenew += value;
    }
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
    avgPerDomain: inCurrency > 0 ? yearly / inCurrency : 0,
    others: otherCurrencies(domains, pricing, currency),
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
    const value = renewalOf(d, pricing, currency);
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
  /** Renewals due this month priced in other currencies. */
  others: CurrencyTotal[];
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
      others: [],
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
    if (p.currency === currency) bucket.yearly += p.renewal;
    else addOther(bucket.others, p.currency, p.renewal);
  }
  return buckets;
}

/**
 * Total known renewal cost in `currency` for domains due within the next
 * `days` days, with any renewals priced in other currencies beside it.
 */
export function dueWithin(
  domains: Domain[],
  pricing: Record<string, RenewalPricing>,
  days: number,
  currency = 'USD',
): { count: number; yearly: number; others: CurrencyTotal[] } {
  const cutoff = Date.now() + days * 86_400_000;
  let count = 0;
  let yearly = 0;
  const others: CurrencyTotal[] = [];
  for (const d of domains) {
    const date = renewalDate(d);
    if (!date || date.getTime() > cutoff) continue;
    count += 1;
    const p = priceOf(d, pricing);
    if (p?.renewal == null) continue;
    if (p.currency === currency) yearly += p.renewal;
    else addOther(others, p.currency, p.renewal);
  }
  return { count, yearly, others };
}
