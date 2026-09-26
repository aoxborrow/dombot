import { DomainEventType, type DomainEvent } from './domain-events';
import { isOpenAlert, resolvedIds } from './sync-diff';

// What needs you now (docs/activity-redesign.md, "Severity and
// notifications"): open sync alerts at their review priority, plus accounts
// whose sync failed. Derived from the event log and each account's sync
// status, never stored. The bell, the Activity page, and later MCP read it.

/** How urgently an open alert needs you. */
export type ReviewPriority = 'high' | 'low';

/** Error: something is broken. High: a name left. Low: a name arrived. */
export type Severity = 'error' | ReviewPriority;

const RANK: Record<Severity, number> = { error: 0, high: 1, low: 2 };

/**
 * An event's review priority, or null when it needs nothing (answered,
 * dismissed, or not an alert). A name that left needs a decision (sold?
 * dropped?); a name that arrived only asks what you paid. `resolved` is
 * `resolvedIds(events)`.
 */
export function reviewPriority(
  e: DomainEvent,
  resolved: Set<string>,
): ReviewPriority | null {
  if (!isOpenAlert(e, resolved)) return null;
  return e.type === DomainEventType.Removed ? 'high' : 'low';
}

/** An account whose last sync failed, with its name for display. */
export interface SyncFailure {
  accountId: string;
  account: string;
  message: string;
}

export interface Notification {
  /** The event id, or `sync:<accountId>`. */
  id: string;
  severity: Severity;
  kind: 'sync-error' | 'departure' | 'arrival';
  /** ms epoch the event was recorded; null for a sync error (not tracked). */
  at: number | null;
  accountId: string | null;
  /** `toAscii` name; null for a sync error. */
  domain: string | null;
  eventId: string | null;
  message: string;
}

/** Everything that needs you: most severe first, then newest first. */
export function notifications(
  events: DomainEvent[],
  failures: SyncFailure[],
): Notification[] {
  const out: Notification[] = failures.map((f) => ({
    id: `sync:${f.accountId}`,
    severity: 'error',
    kind: 'sync-error',
    at: null,
    accountId: f.accountId,
    domain: null,
    eventId: null,
    message: `${f.account}: ${f.message}`,
  }));
  const resolved = resolvedIds(events);
  for (const e of events) {
    const priority = reviewPriority(e, resolved);
    if (!priority) continue;
    const departure = priority === 'high';
    out.push({
      id: e.id,
      severity: priority,
      kind: departure ? 'departure' : 'arrival',
      at: e.createdAt,
      accountId: e.accountId ?? null,
      domain: e.domain,
      eventId: e.id,
      message: departure ? 'Left an account' : 'Arrived in an account',
    });
  }
  return out.sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || (b.at ?? 0) - (a.at ?? 0),
  );
}

/**
 * The badge for a list of notifications: how many, and the most severe.
 * Null when nothing needs you.
 */
export function notificationBadge(
  list: Notification[],
): { count: number; severity: Severity } | null {
  if (list.length === 0) return null;
  const severity = list.reduce<Severity>(
    (worst, n) => (RANK[n.severity] < RANK[worst] ? n.severity : worst),
    'low',
  );
  return { count: list.length, severity };
}
