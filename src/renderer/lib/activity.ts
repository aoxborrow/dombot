import {
  DomainEventType,
  localDay,
  type DomainEvent,
} from '../../shared/domain-events';
import type { Domain, RegistrarMeta } from '../../shared/ipc';
import { toUnicode } from '../../shared/domain-name';
import { formatMoney, type NumberFormatId } from '../../shared/money';
import { accountName } from './domain-history';
import type { SyncFailure } from '../../shared/notifications';

// Helpers for the Activity page and the header bell (docs/storage-model.md,
// "Activity and alerts"): what needs review, what went wrong, and how to say
// what each event means.

/** An account whose last sync failed (see shared/notifications.ts). */
export type SyncProblem = SyncFailure;

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
      at: r.sync.lastErrorAt,
    }));
}

/** The event that resolved each alert, by the alert's id. */
export function resolutions(events: DomainEvent[]): Map<string, DomainEvent> {
  const out = new Map<string, DomainEvent>();
  for (const e of events) if (e.resolves) out.set(e.resolves, e);
  return out;
}

/** What each event type is called: the Type badge, and what a sale or label says. */
export const VERB: Record<DomainEvent['type'], string> = {
  registered: 'Registered',
  purchased: 'Purchased',
  sold: 'Sold',
  dropped: 'Dropped',
  archived: 'Archived',
  renewed: 'Renewed',
  added: 'Added',
  removed: 'Removed',
  moved: 'Moved',
};

export const SOURCE_LABEL: Record<DomainEvent['source'], string> = {
  user: 'You',
  sync: 'Sync',
  import: 'Import',
  lookup: 'Lookup',
  agent: 'Agent',
};

/** The day an event happened: its date, or the day it was recorded. */
export function eventDay(e: DomainEvent): string {
  return e.date ?? localDay(e.createdAt);
}

/** Whether an event happened within the last `days` days (today included). */
export function withinDays(e: DomainEvent, days: number, now: number): boolean {
  return eventDay(e) >= localDay(now - days * 86_400_000);
}

/** Every account an event names: where it arrived or left, or both ends of a move. */
export function eventAccounts(e: DomainEvent): string[] {
  return [e.accountId, e.fromAccountId, e.toAccountId].filter(
    (id): id is string => !!id,
  );
}

/** "$2,500 · 2 yr", or null when there's nothing to say. */
export function eventDetails(
  e: DomainEvent,
  numberFormat: NumberFormatId,
  preferredCurrency: string,
): string | null {
  const parts: string[] = [];
  if (e.amount && e.currency)
    parts.push(
      formatMoney(e.amount, e.currency, preferredCurrency, numberFormat),
    );
  if (e.years) parts.push(`${e.years} yr`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * A Domain for the purchase and sale dialogs, from an alert: the name's row
 * in `domains` (synced and imported), else one built for a name no account or
 * imported entry holds.
 */
export function alertDomain(
  e: DomainEvent,
  domains: Domain[],
  registrars: RegistrarMeta[] | null,
): Domain {
  const name = toUnicode(e.domain);
  const live = domains.find(
    (d) =>
      d.domainName.toLowerCase() === name &&
      (!e.accountId || d.accountId === e.accountId),
  );
  if (live) return live;
  const meta = registrars?.find((r) => (r.accountId ?? r.name) === e.accountId);
  return {
    registrar: (meta?.name ?? '') as Domain['registrar'],
    accountId: e.accountId ?? undefined,
    accountLabel: meta?.accountLabel,
    domainName: name,
    status: '',
    createdDate: null,
    expirationDate: null,
    renewalDate: null,
    autoRenew: false,
    locked: false,
    privacy: false,
    nameservers: [],
    syncedAt: new Date(e.createdAt),
    deleted: false,
    source: 'registrar',
    departed: e.type === DomainEventType.Removed,
  };
}
