import { assertDomainName, toAscii } from '../../shared/domain-name';
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

const today = () => localDay();

/**
 * Mark a name Dropped or Archived: it moves to Archive whatever its
 * registration status. `resolves` closes the sync alert it answers.
 */
export function setDisposition(
  domainName: string,
  type: typeof DomainEventType.Dropped | typeof DomainEventType.Archived,
  resolves?: string,
): DomainEvent {
  const domain = assertDomainName(domainName);
  const event = newEvent({
    domain,
    type,
    source: DomainEventSource.User,
    date: today(),
    ...(resolves ? { resolves } : {}),
  });
  putEvents([event]);
  return event;
}

/**
 * "Move back to Owned": deletes the Sold, Dropped, or Archived event that put
 * the name in Archive. A name in Archive only because sync saw it leave has
 * nothing of yours to undo; label it or dismiss the alert instead.
 */
export function restoreOwned(domainName: string): void {
  const domain = assertDomainName(domainName);
  const o = ownershipByDomain(eventsFor(domain)).get(domain);
  if (!o?.archived || !o.event || o.event.source === DomainEventSource.Sync) {
    throw new Error(`${domain} isn't marked Sold, Dropped, or Archived.`);
  }
  deleteDomainEvents([o.event.id]);
}

/** Acknowledge a sync alert with no action, or bring it back. */
export function setAlertDismissed(id: string, dismissed: boolean): void {
  const event = getEvent(id);
  if (
    !event ||
    (event.type !== DomainEventType.Removed &&
      event.type !== DomainEventType.Added)
  ) {
    throw new Error('That alert no longer exists.');
  }
  putEvents([{ ...event, dismissed, updatedAt: Date.now() }]);
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
 * Delete: removes everything DomBot holds about a name (events, notes,
 * folder, price override). If a connected registrar still reports it, the
 * next sync brings it back as a fresh name.
 */
export function deleteDomain(domainName: string): void {
  const domain = assertDomainName(domainName);
  deleteDomainEvents(
    eventsFor(domain).map((e) => e.id),
    domain,
  );
  assignFolder(domain, null);
  setManualPrice(domain, null);
}
