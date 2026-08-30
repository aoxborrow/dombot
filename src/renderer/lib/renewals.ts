// Pure aggregation over the portfolio + renewal pricing, for the Renewals
// dashboard. No React, no IPC — just numbers in, numbers out. All money is USD.

import type { Domain, RenewalPricing } from '../../shared/ipc';

/** Stable per-domain key, matching the store's `pricing` map keys. */
export function priceKey(d: Domain): string {
  return `${d.registrar}:${d.domainName}`;
}

/** The pricing record for a domain, if fetched. */
export function priceOf(
  d: Domain,
  pricing: Record<string, RenewalPricing>,
): RenewalPricing | undefined {
  return pricing[priceKey(d)];
}

/** A known (non-null) annual renewal price for a domain, else null. */
function renewalOf(
  d: Domain,
  pricing: Record<string, RenewalPricing>,
): number | null {
  const p = priceOf(d, pricing);
  return p && p.renewal != null ? p.renewal : null;
}

/** Everything after the first dot, lowercased. "example.co.uk" → "co.uk". */
export function tldOf(domainName: string): string {
  const dot = domainName.indexOf('.');
  return dot === -1 ? '' : domainName.slice(dot + 1).toLowerCase();
}

export interface RenewalSummary {
  /** Total domains considered. */
  total: number;
  /** Domains with a known price (any source). */
  priced: number;
  /** Domains still without a price. */
  unpriced: number;
  /** Priced domains whose figure is a TLD-rate estimate. */
  estimated: number;
  /** Priced domains using a manual override. */
  manual: number;
  /** Sum of known annual renewals across all priced domains. */
  yearly: number;
  /** Committed spend: known renewals for auto-renew-on domains only. */
  yearlyAutoRenew: number;
  /** Average annual renewal across priced domains (0 when none priced). */
  avgPerDomain: number;
}

export function summarize(
  domains: Domain[],
  pricing: Record<string, RenewalPricing>,
): RenewalSummary {
  let priced = 0;
  let estimated = 0;
  let manual = 0;
  let yearly = 0;
  let yearlyAutoRenew = 0;

  for (const d of domains) {
    const p = priceOf(d, pricing);
    const value = renewalOf(d, pricing);
    if (value == null) continue;
    priced += 1;
    yearly += value;
    if (d.autoRenew) yearlyAutoRenew += value;
    if (p?.source === 'estimated') estimated += 1;
    if (p?.source === 'manual') manual += 1;
  }

  return {
    total: domains.length,
    priced,
    unpriced: domains.length - priced,
    estimated,
    manual,
    yearly,
    yearlyAutoRenew,
    avgPerDomain: priced > 0 ? yearly / priced : 0,
  };
}

export interface Group {
  key: string;
  label: string;
  /** Domains in the group. */
  count: number;
  /** Domains in the group with a known price. */
  priced: number;
  /** Sum of known annual renewals in the group. */
  yearly: number;
}

/** Groups domains by a key, summing known renewals; sorted by spend desc. */
export function groupBy(
  domains: Domain[],
  pricing: Record<string, RenewalPricing>,
  keyOf: (d: Domain) => string,
  labelOf: (key: string) => string,
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
    const value = renewalOf(d, pricing);
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
  /** Sum of known renewals due this month. */
  yearly: number;
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
    const value = renewalOf(d, pricing);
    if (value != null) {
      bucket.priced += 1;
      bucket.yearly += value;
    }
  }
  return buckets;
}

/** Total known renewal cost for domains due within the next `days` days. */
export function dueWithin(
  domains: Domain[],
  pricing: Record<string, RenewalPricing>,
  days: number,
): { count: number; yearly: number } {
  const cutoff = Date.now() + days * 86_400_000;
  let count = 0;
  let yearly = 0;
  for (const d of domains) {
    const date = renewalDate(d);
    if (!date || date.getTime() > cutoff) continue;
    count += 1;
    const value = renewalOf(d, pricing);
    if (value != null) yearly += value;
  }
  return { count, yearly };
}
