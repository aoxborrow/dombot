import {
  ACQUISITION_TYPES,
  DomainEventType,
  type DomainEvent,
} from './domain-events';
import { isOpenAlert, resolvedIds } from './sync-diff';

// What Activity's Needs review lists (docs/unrecorded-activity.md): every
// name that came or went whose money isn't on the books, dismissed or not.
// New is an open alert (`isOpenAlert`): what the bell and the Activity tab
// count, and what Activity highlights. Both are worked out from the event
// log, never stored.

const SALE: ReadonlySet<DomainEventType> = new Set([DomainEventType.Sold]);

/**
 * Whether the holding `list[i]` belongs to has an event of `types`: anything
 * after the last `boundary` before it, up to the next one. A name's holdings
 * run from one arrival to the next for a sale, and from one departure to the
 * next for what you paid. `list` is one name's events in id order.
 */
function holdingHas(
  list: DomainEvent[],
  i: number,
  types: ReadonlySet<DomainEventType>,
  boundary: DomainEventType,
): boolean {
  for (let j = i - 1; j >= 0 && list[j].type !== boundary; j--)
    if (types.has(list[j].type)) return true;
  for (let j = i + 1; j < list.length && list[j].type !== boundary; j++)
    if (types.has(list[j].type)) return true;
  return false;
}

/**
 * An arrival or departure still missing its money: nothing resolves it, it
 * doesn't answer another itself (a name coming back), its writer didn't close
 * it (written dismissed, with no `updatedAt`: Dismiss always stamps one), and
 * it isn't marked dropped. A departure is answered by a lapse (`expires`) or a
 * sale on record for that holding; an arrival by a registration or purchase
 * on record for its holding.
 */
function missingMoney(
  list: DomainEvent[],
  i: number,
  resolved: Set<string>,
): boolean {
  const e = list[i];
  if (resolved.has(e.id) || e.resolves || e.dropped) return false;
  if (e.dismissed && e.updatedAt == null) return false;
  if (e.type === DomainEventType.Removed)
    return !e.expires && !holdingHas(list, i, SALE, DomainEventType.Added);
  return !holdingHas(list, i, ACQUISITION_TYPES, DomainEventType.Removed);
}

/**
 * Ids of the arrivals and departures still missing their money, dismissed or
 * not: the rows Activity's answers (Record registration, Record sale, Mark
 * dropped) are for. A new alert whose money is already on file isn't one.
 */
export function unrecordedIds(events: DomainEvent[]): Set<string> {
  const resolved = resolvedIds(events);
  const byDomain = new Map<string, DomainEvent[]>();
  for (const e of events) {
    const list = byDomain.get(e.domain);
    if (list) list.push(e);
    else byDomain.set(e.domain, [e]);
  }
  const out = new Set<string>();
  for (const list of byDomain.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
    list.forEach((e, i) => {
      if (
        e.type !== DomainEventType.Added &&
        e.type !== DomainEventType.Removed
      )
        return;
      if (missingMoney(list, i, resolved)) out.add(e.id);
    });
  }
  return out;
}

/**
 * Ids of the events Needs review lists: every new alert, and every arrival or
 * departure still missing its money. Pass `unrecorded` when you have it.
 */
export function needsReviewIds(
  events: DomainEvent[],
  unrecorded: Set<string> = unrecordedIds(events),
): Set<string> {
  const resolved = resolvedIds(events);
  const out = new Set(unrecorded);
  for (const e of events) if (isOpenAlert(e, resolved)) out.add(e.id);
  return out;
}
