import {
  ACQUISITION_TYPES,
  DomainEventSource,
  DomainEventType,
  type DomainEvent,
} from '../../../shared/domain-events';
import type { MarketSale } from '../../../shared/markets';
import { parseCanonicalAmount } from '../../../shared/money';
import { isOpenAlert, resolvedIds } from '../../../shared/sync-diff';
import { eventsFor, listEvents, newEvent, putEvents } from '../domain-events';

// Market sales as `sold` events (docs/markets.md, "Storage"). A completed
// sale writes one `sold` event, or links to the one you recorded yourself,
// and never twice: the event carries the sale's `market-sales` key.
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
  now: number = Date.now(),
): SaleEventsResult {
  const result: SaleEventsResult = { written: 0, linked: 0, skipped: 0 };
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
    if (sale.status !== 'completed' || !soldOn) {
      result.skipped++;
      continue;
    }
    const events = eventsFor(sale.name);
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
