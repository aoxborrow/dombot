import { toCsv } from './csv';
import { currencyDecimals, isCurrencyCode } from './currencies';
import {
  ACQUISITION_TYPES,
  DomainEventSource,
  DomainEventType,
  localDay,
  type DomainEvent,
} from './domain-events';
import type { MarketId, MarketSale } from './markets';

// Sale records (docs/sales-tab.md, "The sale record"): one list of every
// sale, whatever recorded it, so the Sales tab, its CSV and the Domains
// cards agree. Built from what's stored:
//
// - `sold` events: your own, imported, and the ones market sync wrote;
// - market sales, joined to their event through `marketSale`, for
//   commission, net, payout and the seller's next step; a market sale with
//   no event yet (in progress, cancelled, or one sync left unrecorded) is a
//   record of its own;
// - `registered` and `purchased` events, for what the name cost and how long
//   you held it: the acquisition before that sale, so a buyback starts a new
//   holding and a name sold twice has two records.
//
// Only those event types are read. Drops, archives and Owned / Archive
// labels play no part, so reshaping them doesn't touch sales.
//
// The rules (from PR #183): blank is unknown and zero only when confirmed;
// amounts in two currencies are never converted or added together; a cost
// counts only when it's in the sale's currency; estimated renewal prices are
// never used as historical costs. Partial totals carry how many records
// they cover. Pure, so the page, the CSV and MCP compute the same numbers.

/**
 * Where a sale came from: a market, or one you recorded or imported.
 * `market` is a market sale whose account is no longer connected.
 */
export type SaleSource = MarketId | 'market' | 'private' | 'imported';

export type SaleStatus = MarketSale['status'];

export interface SaleRecord {
  /** Stable: the `sold` event's id, or `market:` and the market sale's key. */
  id: string;
  /** `toAscii` name. */
  name: string;
  /** YYYY-MM-DD; null for a sale recorded without a date. */
  soldOn: string | null;
  source: SaleSource;
  /** The `sold` event, once there is one: what Edit sale changes. */
  eventId: string | null;
  /** The market sale, as its `market-sales` key (`accountId:id`). */
  marketSale: string | null;
  /** The market account that sold it. */
  marketAccountId: string | null;
  /** The market's own transaction id, for opening it there. */
  marketSaleId: string | null;
  status: SaleStatus;
  /** What the seller has to do next, while a market sale is under way. */
  step: MarketSale['action'];
  kind: MarketSale['kind'];
  currency: string | null;
  /** Canonical decimal; null when unknown. */
  price: string | null;
  /** The market's commission, or the fees you recorded; null when unknown. */
  fees: string | null;
  /** The commission is DomBot's estimate from the market's published rates. */
  feesEstimated: boolean;
  /** What you were paid: price less fees, or the market's figure. */
  net: string | null;
  paidOutOn: string | null;
  installments: MarketSale['installments'];
  /** The registrar account that held the name when it sold, when known. */
  registrarAccountId: string | null;
  /** The acquisition this sale ends: registered or bought, and when. */
  acquiredOn: string | null;
  /** What you paid, in the sale's currency; null when unknown or in another. */
  cost: string | null;
  /** Days from acquisition to sale; null without both dates. */
  holdingDays: number | null;
  /** Net less cost; null unless both are known. */
  profit: string | null;
  /**
   * Sold, but a connected registrar account still holds the name: the buyer
   * hasn't taken it yet. A normal record, shown as awaiting transfer.
   */
  awaitingTransfer: boolean;
  /** You marked the name handed over (Mark complete). */
  transferred: boolean;
}

// ── amounts ─────────────────────────────────────────────────────────────────

// Sums run in thousandths, enough for every currency's minor unit (KWD has
// three), and come back as canonical decimals in the currency's places.
const SCALE = 1000;

const units = (amount: string | null | undefined): number | null =>
  amount != null && amount !== '' && Number.isFinite(Number(amount))
    ? Math.round(Number(amount) * SCALE)
    : null;

function decimal(n: number, currency: string | null): string {
  const places =
    currency && isCurrencyCode(currency) ? currencyDecimals(currency) : 2;
  return (n / SCALE).toFixed(places);
}

// ── building ────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

/** Orders events by the day they happened, then by when they were recorded. */
function orderKey(e: DomainEvent): string {
  return `${e.date ?? localDay(e.createdAt)}|${e.id}`;
}

export const marketSaleKey = (s: MarketSale) => `${s.accountId}:${s.id}`;

export interface SaleRecordInput {
  events: readonly DomainEvent[];
  /** Market sales as stored (already without the ones that aren't sales). */
  marketSales: readonly MarketSale[];
  /** Every name a connected registrar account holds now, by `toAscii`. */
  held?: ReadonlySet<string>;
  /** YYYY-MM-DD; with `held`, which sales are recent enough to await transfer. */
  today?: string;
}

/**
 * A sale this recent of a name an account still holds is awaiting transfer;
 * an older one means you have it back (as market sync decides,
 * RECENT_SALE_DAYS in sale-events.ts).
 */
const AWAITING_TRANSFER_DAYS = 90;

interface Holding {
  acquisition: DomainEvent | null;
  /** The registrar account last seen holding the name. */
  account: string | null;
}

/** Every sale, newest first (undated last). */
export function buildSaleRecords({
  events,
  marketSales,
  held = new Set(),
  today = localDay(),
}: SaleRecordInput): SaleRecord[] {
  const recent = (soldOn: string | null) =>
    !soldOn ||
    Date.parse(today) - Date.parse(soldOn) <= AWAITING_TRANSFER_DAYS * DAY;
  const byKey = new Map(marketSales.map((s) => [marketSaleKey(s), s]));
  const linked = new Set<string>();
  for (const e of events)
    if (
      e.type === DomainEventType.Sold &&
      e.marketSale &&
      byKey.has(e.marketSale)
    )
      linked.add(e.marketSale);

  // One timeline per name: its events, and the market sales no event
  // records, placed on their sale day after that day's events.
  type Entry =
    | { key: string; event: DomainEvent; sale?: undefined }
    | { key: string; event?: undefined; sale: MarketSale };
  const timelines = new Map<string, Entry[]>();
  const push = (name: string, entry: Entry) =>
    (timelines.get(name) ?? timelines.set(name, []).get(name)!).push(entry);
  for (const e of events) push(e.domain, { key: orderKey(e), event: e });
  for (const s of marketSales) {
    if (linked.has(marketSaleKey(s))) continue;
    push(s.name, { key: `${s.soldOn ?? '9999-99-99'}|~${s.id}`, sale: s });
  }

  const records: SaleRecord[] = [];
  for (const [name, entries] of timelines) {
    entries.sort((a, b) => a.key.localeCompare(b.key));
    const h: Holding = { acquisition: null, account: null };
    let last: SaleRecord | null = null;
    for (const entry of entries) {
      const e = entry.event;
      if (e) {
        if (ACQUISITION_TYPES.has(e.type)) {
          h.acquisition = e;
          // Bought back: the earlier sale isn't waiting on anything.
          last = null;
        }
        const account = e.toAccountId ?? e.accountId;
        if (account && e.type !== DomainEventType.Removed) h.account = account;
        if (e.type !== DomainEventType.Sold) continue;
      }
      const sale = e
        ? e.marketSale
          ? (byKey.get(e.marketSale) ?? null)
          : null
        : entry.sale!;
      const record = toRecord(name, e ?? null, sale, h);
      records.push(record);
      // A completed sale ends the holding; one still under way or
      // cancelled doesn't. One you marked handed over waits on nothing.
      if (record.status === 'completed') {
        h.acquisition = null;
        last = e?.transferred ? null : record;
      }
    }
    if (last && held.has(name) && recent(last.soldOn))
      last.awaitingTransfer = true;
  }
  return records.sort(
    (a, b) =>
      (b.soldOn ?? '').localeCompare(a.soldOn ?? '') ||
      b.id.localeCompare(a.id),
  );
}

function toRecord(
  name: string,
  event: DomainEvent | null,
  sale: MarketSale | null,
  h: Holding,
): SaleRecord {
  const currency = event?.currency ?? sale?.currency ?? null;
  const price = event?.amount ?? sale?.price ?? null;
  // A market's figures hold only while the event's currency is the market's.
  const fromMarket = sale && sale.currency === currency ? sale : null;
  const fees = fromMarket ? fromMarket.commission : (event?.fees ?? null);
  const priceUnits = units(price);
  const feeUnits = units(fees);
  // The market's net, unless you've recorded a different price since.
  const net =
    fromMarket?.net != null && units(fromMarket.price) === priceUnits
      ? fromMarket.net
      : priceUnits !== null && feeUnits !== null
        ? decimal(priceUnits - feeUnits, currency)
        : null;
  const soldOn = event ? event.date : (sale?.soldOn ?? null);
  const acquired = h.acquisition;
  const cost =
    acquired && acquired.currency === currency
      ? (acquired.amount ?? null)
      : null;
  const held =
    soldOn && acquired?.date
      ? Math.round((Date.parse(soldOn) - Date.parse(acquired.date)) / DAY)
      : null;
  const netUnits = units(net);
  const costUnits = units(cost);
  return {
    id: event ? event.id : `market:${marketSaleKey(sale!)}`,
    name,
    soldOn,
    source: sale
      ? sale.market
      : event?.marketSale
        ? 'market'
        : event?.source === DomainEventSource.Import
          ? 'imported'
          : 'private',
    eventId: event?.id ?? null,
    marketSale: sale ? marketSaleKey(sale) : null,
    marketAccountId: sale?.accountId ?? null,
    marketSaleId: sale?.id ?? null,
    status: event && !sale ? 'completed' : (sale?.status ?? 'completed'),
    step: sale && sale.status !== 'completed' ? sale.action : null,
    kind: sale?.kind ?? 'unknown',
    currency,
    price,
    fees,
    feesEstimated: fromMarket?.commissionEstimated ?? false,
    net,
    paidOutOn: sale?.paidOutOn ?? null,
    installments: sale?.installments ?? null,
    registrarAccountId: h.account,
    acquiredOn: acquired?.date ?? null,
    cost,
    holdingDays: held !== null && held >= 0 ? held : null,
    profit:
      netUnits !== null && costUnits !== null
        ? decimal(netUnits - costUnits, currency)
        : null,
    awaitingTransfer: false,
    transferred: event?.transferred ?? false,
  };
}

// ── filtering ───────────────────────────────────────────────────────────────

export interface SaleFilter {
  /** YYYY-MM-DD bounds on the sale date, inclusive; '' is unbounded. */
  from: string;
  to: string;
  /** Sources in play; empty means all. */
  sources: readonly SaleSource[];
  /** A currency code, or '' for all. */
  currency: string;
}

export const NO_SALE_FILTER: SaleFilter = {
  from: '',
  to: '',
  sources: [],
  currency: '',
};

/**
 * The records a filter keeps. With no date bounds undated sales are kept; a
 * bounded range leaves them out, and says how many it did.
 */
export function filterSaleRecords(
  records: readonly SaleRecord[],
  filter: SaleFilter,
): { records: SaleRecord[]; undated: number } {
  const bounded = Boolean(filter.from || filter.to);
  let undated = 0;
  const kept = records.filter((r) => {
    if (filter.sources.length && !filter.sources.includes(r.source))
      return false;
    if (filter.currency && r.currency !== filter.currency) return false;
    if (!bounded) return true;
    if (!r.soldOn) {
      undated++;
      return false;
    }
    return (
      (!filter.from || r.soldOn >= filter.from) &&
      (!filter.to || r.soldOn <= filter.to)
    );
  });
  return { records: kept, undated };
}

// ── totals ──────────────────────────────────────────────────────────────────

/** One currency's completed sales added up. */
export interface SaleTotals {
  currency: string;
  /** Completed sales. */
  sold: number;
  inProgress: number;
  cancelled: number;
  gross: string;
  /** How many completed sales have a known price, fees, net, cost. */
  grossCount: number;
  fees: string;
  feesCount: number;
  net: string;
  netCount: number;
  /** Gross ÷ sales with a price; null with none. */
  average: string | null;
  profit: string;
  /** Sales with both a net and a cost: what profit and ROI cover. */
  profitCount: number;
  /** Profit ÷ cost over the sales that have both; null when cost is 0. */
  roi: number | null;
  /** Average days held, over the sales with both dates. */
  holdingDays: number | null;
  holdingCount: number;
}

/**
 * Totals per currency, the currency with the most sales first. A record with
 * no currency (a sale recorded without a price) counts under ''.
 */
export function saleTotals(records: readonly SaleRecord[]): SaleTotals[] {
  const groups = new Map<string, SaleRecord[]>();
  for (const r of records) {
    const c = r.currency ?? '';
    (groups.get(c) ?? groups.set(c, []).get(c)!).push(r);
  }
  return [...groups]
    .map(([currency, list]) => totalsOf(currency, list))
    .sort(
      (a, b) =>
        b.sold + b.inProgress - (a.sold + a.inProgress) ||
        a.currency.localeCompare(b.currency),
    );
}

function totalsOf(currency: string, list: readonly SaleRecord[]): SaleTotals {
  const done = list.filter((r) => r.status === 'completed');
  const sum = (values: (number | null)[]) => {
    const known = values.filter((v): v is number => v !== null);
    return { total: known.reduce((n, v) => n + v, 0), count: known.length };
  };
  const gross = sum(done.map((r) => units(r.price)));
  const fees = sum(done.map((r) => units(r.fees)));
  const net = sum(done.map((r) => units(r.net)));
  const both = done.filter((r) => r.profit !== null);
  const profit = sum(both.map((r) => units(r.profit)));
  const cost = sum(both.map((r) => units(r.cost)));
  const held = done.flatMap((r) =>
    r.holdingDays === null ? [] : [r.holdingDays],
  );
  const c = currency || null;
  return {
    currency,
    sold: done.length,
    inProgress: list.filter(
      (r) => r.status === 'in_progress' || r.status === 'unknown',
    ).length,
    cancelled: list.filter((r) => r.status === 'cancelled').length,
    gross: decimal(gross.total, c),
    grossCount: gross.count,
    fees: decimal(fees.total, c),
    feesCount: fees.count,
    net: decimal(net.total, c),
    netCount: net.count,
    average: gross.count
      ? decimal(Math.round(gross.total / gross.count), c)
      : null,
    profit: decimal(profit.total, c),
    profitCount: both.length,
    roi: cost.total > 0 ? profit.total / cost.total : null,
    holdingDays: held.length
      ? Math.round(held.reduce((a, b) => a + b, 0) / held.length)
      : null,
    holdingCount: held.length,
  };
}

/** One group of a breakdown: its label, in one currency. */
export interface SaleGroup extends SaleTotals {
  label: string;
}

/**
 * Totals grouped by `labelOf` (market, TLD, registrar…), one row per label
 * and currency, the most sales first.
 */
export function groupSaleRecords(
  records: readonly SaleRecord[],
  labelOf: (r: SaleRecord) => string,
): SaleGroup[] {
  const groups = new Map<string, SaleRecord[]>();
  for (const r of records) {
    const key = JSON.stringify([labelOf(r), r.currency ?? '']);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  return [...groups.values()]
    .map((list) => ({
      label: labelOf(list[0]),
      ...totalsOf(list[0].currency ?? '', list),
    }))
    .sort(
      (a, b) =>
        b.sold - a.sold ||
        a.label.localeCompare(b.label) ||
        a.currency.localeCompare(b.currency),
    );
}

/** Everything after the first dot: "example.co.uk" → "co.uk". */
export function saleTld(r: SaleRecord): string {
  const dot = r.name.indexOf('.');
  return dot === -1 ? '' : r.name.slice(dot + 1);
}

/** Completed sales by month in one currency, oldest first. */
export interface SaleMonth {
  /** YYYY-MM. */
  month: string;
  sold: number;
  gross: string;
}

/**
 * The last `months` months, ending with `today`'s, each month's completed
 * sales in `currency`; months with none are there with zeros.
 */
export function salesByMonth(
  records: readonly SaleRecord[],
  currency: string,
  today: string,
  months = 12,
): SaleMonth[] {
  const out: { month: string; sold: number; gross: number }[] = [];
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - i, 1));
    out.push({ month: d.toISOString().slice(0, 7), sold: 0, gross: 0 });
  }
  const byMonth = new Map(out.map((m) => [m.month, m]));
  for (const r of records) {
    if (r.status !== 'completed' || !r.soldOn || r.currency !== currency)
      continue;
    const m = byMonth.get(r.soldOn.slice(0, 7));
    if (!m) continue;
    m.sold++;
    m.gross += units(r.price) ?? 0;
  }
  return out.map((m) => ({
    month: m.month,
    sold: m.sold,
    gross: decimal(m.gross, currency),
  }));
}

// ── CSV ─────────────────────────────────────────────────────────────────────

const SALE_CSV_HEADERS = [
  'Domain',
  'Sold on',
  'Source',
  'Status',
  'Next step',
  'Currency',
  'Price',
  'Fees',
  'Net',
  'Paid out on',
  'Acquired on',
  'Cost',
  'Profit',
  'Days held',
  'Registrar',
];
const NUMERIC = new Set([6, 7, 8, 11, 12, 13]);

/**
 * The records as CSV, unknown values blank. `sourceLabel` and
 * `registrarLabel` turn ids into what the page shows.
 */
export function saleRecordsCsv(
  records: readonly SaleRecord[],
  labels: {
    source: (r: SaleRecord) => string;
    registrar: (r: SaleRecord) => string;
  },
): string {
  const blank = (v: string | number | null | undefined) =>
    v == null ? '' : String(v);
  return toCsv(
    [
      SALE_CSV_HEADERS,
      ...records.map((r) => [
        r.name,
        blank(r.soldOn),
        labels.source(r),
        r.awaitingTransfer ? 'awaiting transfer' : r.status.replace('_', ' '),
        blank(r.step?.replace('_', ' ')),
        blank(r.currency),
        blank(r.price),
        blank(r.fees),
        blank(r.net),
        blank(r.paidOutOn),
        blank(r.acquiredOn),
        blank(r.cost),
        blank(r.profit),
        blank(r.holdingDays),
        labels.registrar(r),
      ]),
    ],
    NUMERIC,
  );
}
