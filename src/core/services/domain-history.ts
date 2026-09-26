import { assertDomainName } from '../../shared/domain-name';
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

// Ownership history on top of the event log: what sync saw, and what you say
// happened (docs/storage-model.md, "Owned, Archive, and Hidden"). Purchases
// and sales are in purchases.ts; this is everything else.

/** Record what a sync changed. The first sync of an account is a starting point. */
export function recordSync(
  before: AccountHoldings[],
  after: AccountHoldings[],
): DomainEvent[] {
  const now = Date.now();
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
