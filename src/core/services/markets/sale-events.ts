import {
  ACQUISITION_TYPES,
  DomainEventSource,
  DomainEventType,
  type DomainEvent,
} from '../../../shared/domain-events';
import type { MarketSale } from '../../../shared/markets';
import { parseCanonicalAmount } from '../../../shared/money';
import { isOpenAlert, resolvedIds } from '../../../shared/sync-diff';
import {
  deleteDomainEvents,
  eventsFor,
  listEvents,
  newEvent,
  putEvents,
} from '../domain-events';

// Market sales as `sold` events (docs/markets.md, "Storage"). A completed
// sale, or one whose name has moved to the buyer (the payout's all that's
// left), writes one `sold` event, or links to the one you recorded
// yourself, and never twice: the event carries the sale's `market-sales` key.
//
// Owned or Archive goes by the order events were recorded, not their dates,
// so a sale written today counts as the name's latest state whatever day it
// sold. A name an account still holds is only marked sold for a recent sale
// (its transfer may not have happened yet); an old sale of a name you hold
// now means you bought it back, and stays a sale record without an event.

/** A sale this recent is recorded even while an account still holds the name. */
export const RECENT_SALE_DAYS = 90;
/** Your own `sold` event within this many days of the market's is the same sale. */
const SAME_SALE_DAYS = 14;

const DAY = 86_400_000;

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
}

export function saleKey(sale: MarketSale): string {
  return `${sale.accountId}:${sale.id}`;
}

function amountOf(
  sale: MarketSale,
): { amount: string; currency: MarketSale['currency'] } | null {
  if (!sale.price) return null;
  try {
    const amount = parseCanonicalAmount(
      sale.price,
      sale.currency,
      'Sale price',
    );
    return amount ? { amount, currency: sale.currency } : null;
  } catch {
    return null;
  }
}

export interface SaleEventsResult {
  written: number;
  linked: number;
  /** Sales left without an event (bought back, still held, not complete). */
  skipped: number;
}

/**
 * Record completed sales as `sold` events. `held` is every name a connected
 * registrar account reports now; `today` is YYYY-MM-DD.
 */
export function recordSaleEvents(
  sales: readonly MarketSale[],
  held: ReadonlySet<string>,
  today: string,
  options: {
    now?: number;
    /** Every market account that exists; with it, a sale's event kept from
     *  a removed account (reconnected under a new id) is relinked, not
     *  written again. */
    liveAccounts?: ReadonlySet<string>;
  } = {},
): SaleEventsResult {
  const now = options.now ?? Date.now();
  const result: SaleEventsResult = { written: 0, linked: 0, skipped: 0 };
  if (options.liveAccounts) {
    result.linked += relinkOrphans(sales, options.liveAccounts, now);
  }
  const recorded = new Set(
    listEvents()
      .map((e) => e.marketSale)
      .filter((k): k is string => Boolean(k)),
  );
  const resolved = resolvedIds(listEvents());
  const writes: DomainEvent[] = [];

  for (const sale of sales) {
    const key = saleKey(sale);
    if (recorded.has(key)) continue;
    const soldOn = sale.soldOn;
    if (!soldOn) {
      result.skipped++;
      continue;
    }
    const events = eventsFor(sale.name);
    // Done once the market completes it, or once the transfer has gone
    // through: the market's on to the payout and sync saw the name leave
    // your accounts. (The market's sales include your purchases, and a name
    // you bought arrives rather than leaves.) No market backs out by then.
    const moved =
      sale.action === 'payout' &&
      !held.has(sale.name) &&
      events.some(
        (e) =>
          e.type === DomainEventType.Removed && !!e.date && e.date >= soldOn,
      );
    if (sale.status !== 'completed' && !moved) {
      result.skipped++;
      continue;
    }
    const boughtBack = events.some(
      (e) => ACQUISITION_TYPES.has(e.type) && e.date && e.date > soldOn,
    );
    const oldButHeld =
      held.has(sale.name) && daysBetween(soldOn, today) > RECENT_SALE_DAYS;
    if (boughtBack || oldButHeld) {
      result.skipped++;
      continue;
    }

    const money = amountOf(sale);
    // Your own record of this sale: the latest `sold` without a market link,
    // undated or close to the market's date.
    const mine = events
      .filter(
        (e) =>
          e.type === DomainEventType.Sold &&
          !e.marketSale &&
          (!e.date || daysBetween(e.date, soldOn) <= SAME_SALE_DAYS),
      )
      .sort((a, b) => b.id.localeCompare(a.id))[0];
    if (mine) {
      writes.push({
        ...mine,
        marketSale: key,
        date: mine.date ?? soldOn,
        ...(mine.amount ? {} : (money ?? {})),
        updatedAt: now,
      });
      result.linked++;
    } else {
      // Answers the name's open "removed" alert, if it has one.
      const alert = events
        .filter(
          (e) => e.type === DomainEventType.Removed && isOpenAlert(e, resolved),
        )
        .sort((a, b) => b.id.localeCompare(a.id))[0];
      writes.push({
        ...newEvent(
          {
            domain: sale.name,
            type: DomainEventType.Sold,
            source: DomainEventSource.Sync,
            date: soldOn,
            amount: money?.amount ?? null,
            currency: money?.currency ?? null,
            marketSale: key,
          },
          now,
        ),
        ...(alert ? { resolves: alert.id } : {}),
      });
      result.written++;
    }
    recorded.add(key);
  }
  if (writes.length) putEvents(writes);
  return result;
}

/**
 * Answers the open "removed" alerts of names with a sale under way: the
 * buyer took the name. Registrar sync writes such a removal answered when
 * it knows of the sale; this catches one it wrote before the market sync
 * that brought the sale. Returns how many it answered.
 */
export function answerRemovalsOfSales(
  selling: ReadonlySet<string>,
  now = Date.now(),
): number {
  if (!selling.size) return 0;
  const events = listEvents();
  const resolved = resolvedIds(events);
  const open = events.filter(
    (e) =>
      e.type === DomainEventType.Removed &&
      selling.has(e.domain) &&
      isOpenAlert(e, resolved),
  );
  if (open.length)
    putEvents(open.map((e) => ({ ...e, dismissed: true, updatedAt: now })));
  return open.length;
}

/** The sale id in a `market-sales` key (`${accountId}:${saleId}`). */
function saleIdOf(key: string): string {
  return key.slice(key.indexOf(':') + 1);
}

/**
 * Sold events linked to these sales under an account that no longer exists:
 * the account was removed and reconnected, so its sales came back under a
 * new id. The first such event for a sale is relinked to it; any more, or
 * all of them when the sale already has its event, were duplicates and go.
 * Returns how many were relinked.
 */
function relinkOrphans(
  sales: readonly MarketSale[],
  live: ReadonlySet<string>,
  now: number,
): number {
  const events = listEvents();
  const linked = new Set(events.map((e) => e.marketSale).filter(Boolean));
  const relink: DomainEvent[] = [];
  const remove: string[] = [];
  for (const sale of sales) {
    const key = saleKey(sale);
    const orphans = events.filter(
      (e) =>
        e.type === DomainEventType.Sold &&
        e.domain === sale.name &&
        e.marketSale &&
        e.marketSale !== key &&
        !live.has(e.marketSale.slice(0, e.marketSale.indexOf(':'))) &&
        saleIdOf(e.marketSale) === sale.id,
    );
    if (!orphans.length) continue;
    const [first, ...rest] = orphans;
    if (linked.has(key)) {
      remove.push(...orphans.map((e) => e.id));
    } else {
      relink.push({ ...first, marketSale: key, updatedAt: now });
      linked.add(key);
      remove.push(...rest.map((e) => e.id));
    }
  }
  if (remove.length) deleteDomainEvents(remove);
  if (relink.length) putEvents(relink);
  return relink.length;
}

/**
 * Undo the `sold` events sync wrote for these sales (their `market-sales`
 * keys). A sold event you recorded yourself and sync only linked keeps its
 * date and price; it just loses the link.
 */
export function dropSaleEvents(keys: readonly string[]): void {
  if (!keys.length) return;
  const drop = new Set(keys);
  const unlink: DomainEvent[] = [];
  const remove: string[] = [];
  for (const e of listEvents()) {
    if (!e.marketSale || !drop.has(e.marketSale)) continue;
    if (e.source === DomainEventSource.Sync) remove.push(e.id);
    else {
      const { marketSale: _link, ...rest } = e;
      void _link;
      unlink.push({ ...rest, updatedAt: Date.now() });
    }
  }
  if (remove.length) deleteDomainEvents(remove);
  if (unlink.length) putEvents(unlink);
}
