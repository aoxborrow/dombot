import { getDomain } from 'tldts';
import {
  ACQUISITION_TYPES,
  type DomainEvent,
} from '../../shared/domain-events';
import type { SalesDetails } from '../../shared/sales-details';

export interface SaleRow {
  event: DomainEvent;
  currency: string | null;
  gross: number | null;
  received: number | null;
  net: number | null;
  profit: number | null;
  investment: number | null;
  holdingDays: number | null;
  recordedRenewals: number;
  payment: SalesDetails['payment'];
  marketplace: string;
  registrar: string;
  folder: string;
  tld: string;
}
export interface SaleContext {
  details: Record<string, SalesDetails>;
  folders?: Record<string, string>;
  registrars?: Record<string, string>;
}
const amount = (s?: string | null): number | null =>
  s != null && s !== '' && Number.isFinite(Number(s)) ? Number(s) : null;
const day = (e: DomainEvent) =>
  e.date ?? new Date(e.createdAt).toISOString().slice(0, 10);
const sorted = (events: DomainEvent[]) =>
  [...events].sort(
    (a, b) => day(a).localeCompare(day(b)) || a.id.localeCompare(b.id),
  );

/** Attribute each sale to its own holding, never a later buy-back. */
export function saleRows(
  events: DomainEvent[],
  context: SaleContext,
): SaleRow[] {
  const holdings = new Map<
    string,
    { purchase?: DomainEvent; renewals: DomainEvent[]; account?: string | null }
  >();
  const rows: SaleRow[] = [];
  for (const event of sorted(events)) {
    const h = holdings.get(event.domain) ?? { renewals: [] };
    if (ACQUISITION_TYPES.has(event.type)) {
      h.purchase = event;
      h.renewals = [];
    }
    if (event.type === 'renewed') h.renewals.push(event);
    h.account = event.toAccountId ?? event.accountId ?? h.account;
    if (event.type === 'sold') {
      const details = context.details[event.id];
      const currency = event.currency ?? null;
      // Stale details after a currency edit must not be reinterpreted as the new currency.
      const d = details?.currency === currency ? details : undefined;
      const gross = amount(event.amount);
      const received = amount(d?.received);
      const fees = amount(d?.fees);
      const renewal = amount(d?.renewalCost);
      const purchase =
        h.purchase?.currency === currency ? amount(h.purchase.amount) : null;
      const net = received !== null && fees !== null ? received - fees : null;
      const investment =
        purchase !== null && renewal !== null ? purchase + renewal : null;
      const settled =
        d?.payment === 'paid' &&
        received !== null &&
        gross !== null &&
        received === gross;
      const profit =
        settled && net !== null && investment !== null
          ? net - investment
          : null;
      const duration =
        event.date && h.purchase?.date
          ? (Date.parse(event.date) - Date.parse(h.purchase.date)) / 86400000
          : null;
      const base = getDomain(event.domain);
      const tld = base?.includes('.')
        ? base.slice(base.indexOf('.') + 1)
        : event.domain.split('.').slice(1).join('.');
      rows.push({
        event,
        currency,
        gross,
        received,
        net,
        profit,
        investment,
        holdingDays: duration !== null && duration >= 0 ? duration : null,
        recordedRenewals: h.renewals
          .filter((r) => r.currency === currency)
          .reduce((n, r) => n + (amount(r.amount) ?? 0), 0),
        payment: d?.payment ?? 'unconfirmed',
        marketplace: d?.marketplace || 'Unknown',
        registrar: (h.account && context.registrars?.[h.account]) || 'Unknown',
        folder: context.folders?.[event.domain] || 'Ungrouped',
        tld: tld || 'Unknown',
      });
      h.purchase = undefined;
      h.renewals = [];
    }
    if (event.type === 'dropped' || event.type === 'archived') {
      h.purchase = undefined;
      h.renewals = [];
    }
    holdings.set(event.domain, h);
  }
  return rows;
}

export interface SalesFilter {
  from: string;
  to: string;
  currency: string;
}
export function filterSales(rows: SaleRow[], filter: SalesFilter): SaleRow[] {
  return rows.filter(
    (r) =>
      (filter.currency === 'all' ||
        (r.currency ?? 'unknown') === filter.currency) &&
      ((!filter.from && !filter.to) ||
        (r.event.date !== null &&
          (!filter.from || r.event.date >= filter.from) &&
          (!filter.to || r.event.date <= filter.to))),
  );
}

export function salesSummary(rows: SaleRow[]) {
  const values = (key: 'gross' | 'received' | 'net' | 'profit') =>
    rows.filter((r) => r[key] !== null);
  const sum = (key: 'gross' | 'received' | 'net' | 'profit') =>
    values(key).reduce((n, r) => n + r[key]!, 0);
  const complete = values('profit');
  const invested = complete.reduce((n, r) => n + (r.investment ?? 0), 0);
  const durations = rows.flatMap((r) =>
    r.holdingDays === null ? [] : [r.holdingDays],
  );
  return {
    count: rows.length,
    gross: sum('gross'),
    grossCount: values('gross').length,
    received: sum('received'),
    receivedCount: values('received').length,
    net: sum('net'),
    netCount: values('net').length,
    profit: sum('profit'),
    profitCount: complete.length,
    average: values('gross').length
      ? sum('gross') / values('gross').length
      : null,
    roi: invested > 0 ? (sum('profit') / invested) * 100 : null,
    holdingDays: durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null,
    holdingCount: durations.length,
  };
}

/** Period sell-through for the known opening cohort, not an annualized estimate. */
export function openingCohort(events: DomainEvent[], from: string, to: string) {
  if (!from || !to || from > to) return null;
  const held = new Set<string>();
  for (const e of sorted(events)) {
    if (!e.date || e.date >= from) continue;
    if (ACQUISITION_TYPES.has(e.type) || e.type === 'added') held.add(e.domain);
    if (['sold', 'dropped', 'archived', 'removed'].includes(e.type))
      held.delete(e.domain);
  }
  const sold = new Set(
    events
      .filter(
        (e) =>
          e.type === 'sold' &&
          e.date &&
          e.date >= from &&
          e.date <= to &&
          held.has(e.domain),
      )
      .map((e) => e.domain),
  );
  return {
    opening: held.size,
    sold: sold.size,
    rate: held.size ? (sold.size / held.size) * 100 : null,
  };
}

export function groupedSales(
  rows: SaleRow[],
  dimension: 'month' | 'marketplace' | 'registrar' | 'folder' | 'tld',
) {
  const groups = new Map<string, SaleRow[]>();
  for (const row of rows) {
    const label =
      dimension === 'month'
        ? (row.event.date?.slice(0, 7) ?? 'Undated')
        : row[dimension];
    const key = JSON.stringify([label, row.currency]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      label:
        dimension === 'month'
          ? (group[0].event.date?.slice(0, 7) ?? 'Undated')
          : group[0][dimension],
      currency: group[0].currency,
      ...salesSummary(group),
    }))
    .sort((a, b) =>
      dimension === 'month'
        ? a.label.localeCompare(b.label)
        : b.count - a.count || a.label.localeCompare(b.label),
    );
}
