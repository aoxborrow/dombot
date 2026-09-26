import { toAscii } from './domain-name';
import {
  DomainEventSource,
  DomainEventType,
  localDay,
  type DomainEvent,
} from './domain-events';

// What a sync changed, as domain events (docs/storage-model.md). Pure: the
// caller passes the portfolio before and after the sync, the events so far,
// and which accounts are already tracked, and gets back the events to append.
// History is never rewritten: an alert is closed by a later event pointing at
// it (`resolves`), or by dismissing it.

/** One account's names at one moment, and whether this sync pulled it. */
export interface AccountHoldings {
  accountId: string;
  names: string[];
  /** The pull in this sync succeeded (after-list only). */
  synced: boolean;
  /**
   * Before-list only: a list from the account's last sync exists. False when
   * DomBot has no record of what it held (an import from before these were
   * kept); that sync starts over quietly.
   */
  known: boolean;
}

export interface SyncDiff {
  events: DomainEvent[];
  /** Accounts synced for the first time: record `trackedSince` for them. */
  newlyTracked: string[];
}

type NewEvent = Omit<DomainEvent, 'id' | 'createdAt' | 'updatedAt'>;

const OWNERSHIP_ENDED: ReadonlySet<string> = new Set([
  DomainEventType.Sold,
  DomainEventType.Dropped,
  DomainEventType.Archived,
]);

/** Ids of events a later event resolves. */
export function resolvedIds(events: DomainEvent[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) if (e.resolves) out.add(e.resolves);
  return out;
}

/** An alert still waiting on you: not dismissed, not resolved. */
export function isOpenAlert(e: DomainEvent, resolved: Set<string>): boolean {
  return (
    (e.type === DomainEventType.Removed || e.type === DomainEventType.Added) &&
    !e.dismissed &&
    !resolved.has(e.id)
  );
}

function names(h: AccountHoldings): Set<string> {
  const out = new Set<string>();
  for (const raw of h.names) {
    const key = toAscii(raw);
    if (key) out.add(key);
  }
  return out;
}

export function diffSync(
  before: AccountHoldings[],
  after: AccountHoldings[],
  events: DomainEvent[],
  tracked: ReadonlySet<string>,
  now: number,
  newEvent: (fields: NewEvent, now: number) => DomainEvent,
): SyncDiff {
  const date = localDay(now);
  const prev = new Map(before.map((h) => [h.accountId, h]));
  const nextNames = new Map(after.map((h) => [h.accountId, names(h)]));
  const out: DomainEvent[] = [];
  const newlyTracked: string[] = [];

  // Open alerts and each name's latest user disposition, kept current as we
  // append so two changes in one sync see each other.
  const resolved = resolvedIds(events);
  const openRemoved = new Map<string, DomainEvent>();
  const openAdded = new Map<string, DomainEvent>();
  const disposed = new Set<string>();
  const note = (e: DomainEvent) => {
    if (e.resolves) {
      resolved.add(e.resolves);
      for (const map of [openRemoved, openAdded])
        for (const [name, open] of map)
          if (open.id === e.resolves) map.delete(name);
    }
    if (OWNERSHIP_ENDED.has(e.type)) disposed.add(e.domain);
    else if (e.type !== DomainEventType.Removed) disposed.delete(e.domain);
    if (!isOpenAlert(e, resolved)) return;
    (e.type === DomainEventType.Removed ? openRemoved : openAdded).set(
      e.domain,
      e,
    );
  };
  for (const e of events) note(e);
  const push = (fields: Omit<NewEvent, 'source' | 'date'>) => {
    const e = newEvent(
      { ...fields, source: DomainEventSource.Sync, date },
      now,
    );
    out.push(e);
    note(e);
  };

  const holderOtherThan = (name: string, accountId: string) => {
    for (const [id, set] of nextNames) {
      if (id !== accountId && set.has(name)) return id;
    }
    return null;
  };

  const lefts: { name: string; accountId: string }[] = [];
  const joins: { name: string; accountId: string }[] = [];
  for (const h of after) {
    if (!h.synced) continue;
    const current = nextNames.get(h.accountId)!;
    if (!tracked.has(h.accountId)) {
      // First sync: a starting point, not alerts. A name here that another
      // account reported leaving was a move.
      newlyTracked.push(h.accountId);
      for (const name of current) {
        const open = openRemoved.get(name);
        if (open && open.accountId !== h.accountId) {
          push({
            domain: name,
            type: DomainEventType.Moved,
            fromAccountId: open.accountId,
            toAccountId: h.accountId,
            resolves: open.id,
          });
        }
      }
      continue;
    }
    const was = prev.get(h.accountId);
    // No record of what it held last time: start over quietly.
    if (!was?.known) continue;
    const wasNames = names(was);
    for (const name of wasNames)
      if (!current.has(name)) lefts.push({ name, accountId: h.accountId });
    for (const name of current)
      if (!wasNames.has(name)) joins.push({ name, accountId: h.accountId });
  }

  const pendingJoins = new Map<string, string[]>();
  for (const j of joins) {
    pendingJoins.set(j.name, [
      ...(pendingJoins.get(j.name) ?? []),
      j.accountId,
    ]);
  }
  const takeJoin = (name: string) => {
    const list = pendingJoins.get(name);
    const to = list?.shift() ?? null;
    if (list && !list.length) pendingJoins.delete(name);
    return to;
  };

  for (const left of lefts) {
    const to =
      takeJoin(left.name) ?? holderOtherThan(left.name, left.accountId);
    if (to) {
      const open = openRemoved.get(left.name) ?? openAdded.get(left.name);
      push({
        domain: left.name,
        type: DomainEventType.Moved,
        fromAccountId: left.accountId,
        toAccountId: to,
        ...(open ? { resolves: open.id } : {}),
      });
      continue;
    }
    if (openRemoved.has(left.name)) continue;
    push({
      domain: left.name,
      type: DomainEventType.Removed,
      accountId: left.accountId,
      // Already marked Sold, Dropped, or Archived: nothing left to review.
      ...(disposed.has(left.name) ? { dismissed: true } : {}),
    });
  }

  for (const [name, accounts] of pendingJoins) {
    for (const accountId of accounts) {
      const open = openRemoved.get(name);
      if (open && open.accountId !== accountId) {
        push({
          domain: name,
          type: DomainEventType.Moved,
          fromAccountId: open.accountId,
          toAccountId: accountId,
          resolves: open.id,
        });
        continue;
      }
      if (open) {
        // Back in the account it left: closes that alert, nothing to review.
        push({
          domain: name,
          type: DomainEventType.Added,
          accountId,
          resolves: open.id,
          dismissed: true,
        });
        continue;
      }
      if (openAdded.has(name)) continue;
      push({ domain: name, type: DomainEventType.Added, accountId });
    }
  }

  return { events: out, newlyTracked };
}
