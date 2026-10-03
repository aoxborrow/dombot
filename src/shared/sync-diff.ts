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
  /**
   * Each name's expiry, `toAscii` name → `YYYY-MM-DD`. Before-list: absent
   * when the last sync didn't keep them (a record from an older build), so
   * this sync records no renewals for the account. After-list: what the
   * registrar reports now; a name without one is skipped.
   */
  expirations?: Record<string, string>;
  /**
   * Before-list only: names DomBot renewed whose new expiry sync hasn't seen
   * yet, with the years each renewal added. The next forward jump for one is
   * that renewal, already recorded; only years beyond it are new.
   */
  awaiting?: Record<string, number>;
}

export interface SyncDiff {
  events: DomainEvent[];
  /** Accounts synced for the first time: record `trackedSince` for them. */
  newlyTracked: string[];
  /**
   * Sync-written `renewed` events to delete: the expiry went back to where it
   * was before the jump that recorded them (a renewal undone in the grace
   * period). Sync events are sync's own to amend.
   */
  retracted: string[];
  /** Awaited DomBot renewals this sync saw land: drop them from `awaiting`. */
  landed: { accountId: string; domain: string }[];
}

/** An expiry moving forward by at least this many days is a renewal. */
export const RENEWAL_MIN_DAYS = 300;
const DAY_MS = 86_400_000;

/** Days from one `YYYY-MM-DD` to another; null if either won't parse. */
function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

/** A registrar expiry as `YYYY-MM-DD` (its UTC day), or null. */
export function expiryDay(date: Date | null | undefined): string | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** Whole years a move of `days` covers, at least one. */
export function renewalYears(days: number): number {
  return Math.max(1, Math.round(days / 365.25));
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
  const retracted: string[] = [];

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
    // The same ownership rule as shared/ownership.ts: only coming back to one
    // of your accounts clears a label; purchases and moves don't.
    if (OWNERSHIP_ENDED.has(e.type)) disposed.add(e.domain);
    else if (e.type === DomainEventType.Added) disposed.delete(e.domain);
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

  // Renewals: an expiry that moved forward by about a year or more. A jump
  // for a name awaiting a DomBot renewal is that renewal, already recorded:
  // it lands, and only years beyond it (a transfer's, an auto-renewal's) are
  // written. An expiry that went back by at least the years a sync renewal
  // recorded undoes that renewal.
  const landed: { accountId: string; domain: string }[] = [];
  /** Years of awaited DomBot renewals this jump shows, claiming them. */
  const awaited = (name: string, accountIds: string[]) => {
    let years = 0;
    for (const accountId of accountIds) {
      const y = prev.get(accountId)?.awaiting?.[name];
      if (!y) continue;
      if (landed.some((l) => l.accountId === accountId && l.domain === name))
        continue;
      landed.push({ accountId, domain: name });
      years += y;
    }
    return years;
  };
  const lastSyncRenewal = (name: string) => {
    let last: DomainEvent | null = null;
    for (const e of events)
      if (
        e.domain === name &&
        e.type === DomainEventType.Renewed &&
        (!last || e.id > last.id)
      )
        last = e;
    return last?.source === DomainEventSource.Sync ? last : null;
  };
  const expiryMoved = (
    name: string,
    accountId: string,
    was: string | undefined,
    is: string | undefined,
    awaitedIn: string[],
  ) => {
    if (!was || !is) return;
    const days = daysBetween(was, is);
    if (days === null) return;
    if (days >= RENEWAL_MIN_DAYS) {
      const years = renewalYears(days) - awaited(name, awaitedIn);
      if (years < 1) return;
      push({ domain: name, type: DomainEventType.Renewed, accountId, years });
    } else if (days <= -RENEWAL_MIN_DAYS) {
      const last = lastSyncRenewal(name);
      // At least its years: a sync renewal may be only the years a jump
      // added beyond a DomBot renewal, and undoing the jump undoes it too.
      if (last?.years && last.years <= renewalYears(-days))
        retracted.push(last.id);
    }
  };
  const expiryOf = (accountId: string, name: string) =>
    prev.get(accountId)?.expirations?.[name];
  const expiryNow = (accountId: string, name: string) =>
    after.find((h) => h.accountId === accountId)?.expirations?.[name];
  // A transfer usually adds a year: a move whose expiry also went forward
  // gets a `renewed` too, so the yearly cost doesn't miss it.
  const pushMove = (fields: Omit<NewEvent, 'source' | 'date'>) => {
    push(fields);
    const from = fields.fromAccountId;
    const to = fields.toAccountId;
    if (!from || !to) return;
    expiryMoved(
      fields.domain,
      to,
      expiryOf(from, fields.domain),
      expiryNow(to, fields.domain),
      [from, to],
    );
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
          pushMove({
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
    if (!was.expirations || !h.expirations) continue;
    for (const name of current) {
      if (!wasNames.has(name)) continue;
      expiryMoved(
        name,
        h.accountId,
        was.expirations[name],
        h.expirations[name],
        [h.accountId],
      );
    }
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
      pushMove({
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
        pushMove({
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

  return { events: out, newlyTracked, retracted, landed };
}
