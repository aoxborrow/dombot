import { assertDomainName, toAscii } from '../../shared/domain-name';
import { parsePurchaseDate } from '../../shared/money';
import {
  DomainEventSource,
  DomainEventType,
  localDay,
  type DomainEvent,
} from '../../shared/domain-events';
import { ownershipByDomain } from '../../shared/ownership';
import { diffSync, type AccountHoldings } from '../../shared/sync-diff';
import { markAccountsTracked, trackedAccountIds } from './accounts';
import {
  deleteDomainEvents,
  eventsFor,
  getEvent,
  listEvents,
  newEvent,
  putEvents,
} from './domain-events';
import { assignFolder } from './folders';
import { setManualPrice } from './pricing';
import { Namespace } from '../storage/namespace';

// Ownership history on top of the event log: what sync saw, and what you say
// happened (docs/storage-model.md, "Owned, Archive, and Hidden"). Purchases
// and sales are in purchases.ts; this is everything else.

/**
 * What each account's last successful sync saw, keyed by account id. Sync
 * compares against this, not the registrar cache, so "Clear cache" can't make
 * it miss a change; and it's exported, so it travels with `domain-events` and
 * `trackedSince` and an imported history carries on where it left off.
 */
interface LastSync {
  /** `toAscii` names. */
  names: string[];
  /** ms epoch. */
  syncedAt: number;
}
export const LAST_SYNC_NAMESPACE = 'registrar-last-sync';
const lastSync = new Namespace<LastSync>(LAST_SYNC_NAMESPACE);

/**
 * Record what a sync changed, given every active account's names now
 * (`synced` marks the accounts this sync pulled). The first sync of an
 * account is a starting point.
 */
export function recordSync(after: AccountHoldings[]): DomainEvent[] {
  const now = Date.now();
  const before: AccountHoldings[] = after.map((h) => {
    // Guard against a hand-edited or imported record that isn't a list.
    const names = lastSync.get(h.accountId)?.names;
    const known = Array.isArray(names);
    return {
      accountId: h.accountId,
      names: known ? names.filter((n) => typeof n === 'string') : [],
      synced: false,
      known,
    };
  });
  const { events, newlyTracked } = diffSync(
    before,
    after,
    listEvents(),
    trackedAccountIds(),
    now,
    newEvent,
  );
  putEvents(events);
  markAccountsTracked(newlyTracked, now);
  void lastSync.setMany(
    after
      .filter((h) => h.synced)
      .map((h) => [
        h.accountId,
        { names: [...new Set(h.names.map(toAscii))].sort(), syncedAt: now },
      ]),
  );
  return events;
}

/** A name to act on, and the sync alert the action answers, if any. */
export interface OwnershipItem {
  domainName: string;
  resolves?: string;
}

/** A `YYYY-MM-DD` day from a dialog, or today when it's left blank. */
function dayOf(date: string | null | undefined, label: string): string {
  return parsePurchaseDate(date ?? '', label) ?? localDay();
}

/**
 * Mark names Dropped or Archived, in one write: they move to Archive whatever
 * their registration status. Each `resolves` closes the sync alert it answers.
 */
export function setDispositions(
  items: OwnershipItem[],
  type: typeof DomainEventType.Dropped | typeof DomainEventType.Archived,
  date?: string | null,
): DomainEvent[] {
  const day = dayOf(date, 'Date');
  const now = Date.now();
  const events = items.map((item) =>
    newEvent(
      {
        domain: assertDomainName(item.domainName),
        type,
        source: DomainEventSource.User,
        date: day,
        ...(item.resolves ? { resolves: item.resolves } : {}),
      },
      now,
    ),
  );
  putEvents(events);
  return events;
}

/**
 * "Move back to Owned": deletes the Sold, Dropped, or Archived event that put
 * each name in Archive. A name in Archive only because sync saw it leave has
 * nothing of yours to undo (dismiss its alert instead), so it's skipped.
 * Returns how many moved back.
 */
export function restoreOwned(domainNames: string[]): number {
  const ids: string[] = [];
  for (const name of domainNames) {
    const domain = assertDomainName(name);
    const o = ownershipByDomain(eventsFor(domain)).get(domain);
    if (o?.archived && o.event && o.event.source !== DomainEventSource.Sync) {
      ids.push(o.event.id);
    }
  }
  if (ids.length === 0 && domainNames.length > 0) {
    throw new Error(
      domainNames.length === 1
        ? `${toAscii(domainNames[0])} isn't marked Sold, Dropped, or Archived.`
        : 'None of these names is marked Sold, Dropped, or Archived.',
    );
  }
  deleteDomainEvents(ids);
  return ids.length;
}

/** Acknowledge sync alerts with no action, or bring them back, in one write. */
export function setAlertsDismissed(ids: string[], dismissed: boolean): void {
  const now = Date.now();
  const alerts = ids
    .map((id) => getEvent(id))
    .filter(
      (e): e is DomainEvent =>
        !!e &&
        (e.type === DomainEventType.Removed ||
          e.type === DomainEventType.Added),
    );
  if (alerts.length === 0) throw new Error('That alert no longer exists.');
  putEvents(alerts.map((e) => ({ ...e, dismissed, updatedAt: now })));
}

/** Undo a user event (a resolution recorded by mistake). Sync events stay. */
export function deleteUserEvent(id: string): void {
  const event = getEvent(id);
  if (!event) return;
  if (event.source === DomainEventSource.Sync) {
    throw new Error("Sync events can't be deleted; dismiss the alert instead.");
  }
  deleteDomainEvents([id]);
}

/**
 * Delete: removes everything DomBot holds about each name (events, notes,
 * folder, price override). If a connected registrar still reports one, the
 * next sync brings it back as a fresh name.
 */
export function deleteDomains(domainNames: string[]): void {
  for (const name of domainNames) {
    const domain = assertDomainName(name);
    deleteDomainEvents(
      eventsFor(domain).map((e) => e.id),
      domain,
    );
    assignFolder(domain, null);
    setManualPrice(domain, null);
  }
}
