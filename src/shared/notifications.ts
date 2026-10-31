import { DomainEventType, type DomainEvent } from './domain-events';
import type { MarketAccountView, MarketInfo } from './markets';
import { needsReviewIds } from './review';
import { isOpenAlert, resolvedIds } from './sync-diff';

// What needs you now: new sync alerts at their review priority, plus accounts
// whose sync failed. Derived from the event log and each account's sync
// status, never stored. The bell, the Activity tab, and MCP read it.

/** How urgently an open alert needs you. */
export type ReviewPriority = 'high' | 'low';

/** Error: something is broken. High: a name left. Low: a name arrived. */
export type Severity = 'error' | ReviewPriority;

const RANK: Record<Severity, number> = { error: 0, high: 1, low: 2 };

/** An account whose last sync failed, with its name for display. */
export interface SyncFailure {
  accountId: string;
  account: string;
  message: string;
  /** When the sync failed (ms epoch), if known. */
  at?: number | null;
}

/** "Afternic", or "Afternic · Business" when the account has its own name. */
export function marketAccountTitle(market: string, label: string): string {
  return label && label !== market ? `${market} · ${label}` : market;
}

/** A market account's name as its card shows it, from the catalog. */
export function marketAccountName(
  account: MarketAccountView,
  catalog: MarketInfo[],
): string {
  return marketAccountTitle(
    catalog.find((m) => m.id === account.market)?.name ?? account.market,
    account.label,
  );
}

/**
 * A market account's last sync error, if any. It leads with the account's
 * label, which wherever it's shown already names the account, so that's
 * dropped.
 */
export function marketSyncError(account: MarketAccountView): string | null {
  const error = account.sync?.lastError;
  if (!error) return null;
  const prefix = `${account.label}: `;
  return error.startsWith(prefix) ? error.slice(prefix.length) : error;
}

/** Enabled market accounts whose last sync failed. */
export function marketSyncFailures(
  accounts: MarketAccountView[] | null,
  catalog: MarketInfo[],
): SyncFailure[] {
  return (accounts ?? [])
    .filter((a) => a.configured && a.enabled && a.sync?.lastError)
    .map((a) => ({
      accountId: a.id,
      account: marketAccountName(a, catalog),
      message: marketSyncError(a)!,
      at: a.sync!.at,
    }));
}

export interface Notification {
  /** The event id, or `sync:<accountId>`. */
  id: string;
  severity: Severity;
  kind: 'sync-error' | 'departure' | 'arrival';
  /** ms epoch the event was recorded, or the sync failed; null if unknown. */
  at: number | null;
  accountId: string | null;
  /** `toAscii` name; null for a sync error. */
  domain: string | null;
  eventId: string | null;
  message: string;
}

/** An arrival or departure as a notification, at its type's priority. */
function eventAlert(e: DomainEvent): Notification {
  const departure = e.type === DomainEventType.Removed;
  return {
    id: e.id,
    severity: departure ? 'high' : 'low',
    kind: departure ? 'departure' : 'arrival',
    at: e.createdAt,
    accountId: e.accountId ?? null,
    domain: e.domain,
    eventId: e.id,
    message: departure ? 'Removed from an account' : 'Added to an account',
  };
}

/**
 * Most severe first, then newest. One sync stamps all its events with the
 * same time, so ties fall back to the id: event ids are ULIDs, which sort in
 * the order they were made.
 */
function bySeverity<T extends Notification>(list: T[]): T[] {
  return list.sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      (b.at ?? 0) - (a.at ?? 0) ||
      (b.eventId ?? '').localeCompare(a.eventId ?? ''),
  );
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
    at: f.at ?? null,
    accountId: f.accountId,
    domain: null,
    eventId: null,
    message: `${f.account}: ${f.message}`,
  }));
  const resolved = resolvedIds(events);
  for (const e of events) if (isOpenAlert(e, resolved)) out.push(eventAlert(e));
  return bySeverity(out);
}

/**
 * Every arrival and departure Activity's Needs review lists (shared/review.ts),
 * departures first, newest first. `dismissed`: no longer new, but still
 * missing its money.
 */
export function reviewAlerts(
  events: DomainEvent[],
): (Notification & { dismissed: boolean })[] {
  const ids = needsReviewIds(events);
  const resolved = resolvedIds(events);
  return bySeverity(
    events
      .filter((e) => ids.has(e.id))
      .map((e) => ({ ...eventAlert(e), dismissed: !isOpenAlert(e, resolved) })),
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
