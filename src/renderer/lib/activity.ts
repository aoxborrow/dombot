import {
  DomainEventSource,
  DomainEventType,
  type DomainEvent,
} from '../../shared/domain-events';
import type { RegistrarMeta } from '../../shared/ipc';
import { formatMoney, type NumberFormatId } from '../../shared/money';
import { isOpenAlert, resolvedIds } from '../../shared/sync-diff';
import { accountName } from './domain-history';

// Helpers for the Activity page and the header bell (docs/storage-model.md,
// "Activity and alerts"): what needs review, what went wrong, and how to say
// what each event means.

export type Severity = 'error' | 'review' | 'info';

/** Alerts still waiting on you, newest first: `removed` and `added`. */
export function reviewItems(events: DomainEvent[]): DomainEvent[] {
  const resolved = resolvedIds(events);
  return events.filter((e) => isOpenAlert(e, resolved)).reverse();
}

/** Recent moves between your accounts, newest first (info only). */
export function recentMoves(
  events: DomainEvent[],
  since: number,
): DomainEvent[] {
  return events
    .filter((e) => e.type === DomainEventType.Moved && e.createdAt >= since)
    .reverse();
}

export interface SyncProblem {
  accountId: string;
  account: string;
  message: string;
}

/** Accounts whose last sync failed. */
export function syncProblems(
  registrars: RegistrarMeta[] | null,
): SyncProblem[] {
  return (registrars ?? [])
    .filter((r) => r.configured && r.enabled && r.sync.lastError)
    .map((r) => ({
      accountId: r.accountId ?? r.name,
      account: accountName(registrars, r.accountId ?? r.name) ?? r.displayName,
      message: r.sync.lastError!,
    }));
}

/** The earliest account's `trackedSince`, for "Tracking changes since …". */
export function trackingSince(
  registrars: RegistrarMeta[] | null,
): number | null {
  const times = (registrars ?? [])
    .map((r) => r.sync.trackedSince)
    .filter((t): t is number => typeof t === 'number');
  return times.length ? Math.min(...times) : null;
}

/** The event that resolved each alert, by the alert's id. */
export function resolutions(events: DomainEvent[]): Map<string, DomainEvent> {
  const out = new Map<string, DomainEvent>();
  for (const e of events) if (e.resolves) out.set(e.resolves, e);
  return out;
}

const VERB: Record<DomainEvent['type'], string> = {
  registered: 'Registered',
  purchased: 'Purchased',
  sold: 'Sold',
  dropped: 'Dropped',
  archived: 'Archived',
  renewed: 'Renewed',
  added: 'Arrived',
  removed: 'Left',
  moved: 'Moved',
};

/** "Left GoDaddy", "Moved from GoDaddy to Porkbun #2", "Sold for $2,500". */
export function describeEvent(
  e: DomainEvent,
  registrars: RegistrarMeta[] | null,
  numberFormat: NumberFormatId,
  preferredCurrency: string,
): string {
  const acct = (id: string | null | undefined) =>
    accountName(registrars, id) ?? 'a removed account';
  switch (e.type) {
    case DomainEventType.Added:
      return `Arrived at ${acct(e.accountId)}`;
    case DomainEventType.Removed:
      return `Left ${acct(e.accountId)}`;
    case DomainEventType.Moved:
      return `Moved from ${acct(e.fromAccountId)} to ${acct(e.toAccountId)}`;
    default: {
      const money =
        e.amount && e.currency
          ? formatMoney(e.amount, e.currency, preferredCurrency, numberFormat)
          : null;
      const verb =
        e.type === DomainEventType.Dropped &&
        e.source === DomainEventSource.Lookup
          ? 'Dropped (no longer registered)'
          : VERB[e.type];
      return money ? `${verb} for ${money}` : verb;
    }
  }
}

export interface AlertStatus {
  text: string;
  open: boolean;
  /**
   * What Undo does: bring back a dismissal you made, or delete the event you
   * answered it with. Null when sync closed it on its own: undoing that would
   * put it back in Needs review with nothing to decide.
   */
  undo: 'dismissal' | 'answer' | null;
}

/** A short status for an alert row: what closed it, or that it's waiting. */
export function alertStatus(
  e: DomainEvent,
  closedBy: DomainEvent | undefined,
): AlertStatus | null {
  if (e.type !== DomainEventType.Removed && e.type !== DomainEventType.Added)
    return null;
  if (closedBy) {
    const text =
      closedBy.type === DomainEventType.Added
        ? 'Came back'
        : closedBy.type === DomainEventType.Moved
          ? 'Was a move'
          : VERB[closedBy.type];
    const yours = closedBy.source === DomainEventSource.User;
    return { text, open: false, undo: yours ? 'answer' : null };
  }
  if (e.dismissed) {
    // Dismissed when sync wrote it (never edited since): a name that came
    // back, or one that left after you'd already labeled it.
    if (e.updatedAt === null) {
      const text =
        e.type === DomainEventType.Added ? 'Came back' : 'Already labeled';
      return { text, open: false, undo: null };
    }
    return { text: 'Dismissed', open: false, undo: 'dismissal' };
  }
  return { text: 'Needs review', open: true, undo: null };
}

export const SOURCE_LABEL: Record<DomainEvent['source'], string> = {
  user: 'You',
  sync: 'Sync',
  import: 'Import',
  lookup: 'Lookup',
};
