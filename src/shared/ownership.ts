import { DomainEventType, type DomainEvent } from './domain-events';

// Owned or Archive, read from a name's ownership events (docs/storage-model.md,
// "Owned, Archive, and Hidden"): sold, dropped, archived, and removed put it in
// Archive; added brings it back. Events are taken in the order they were
// recorded (their ids), so marking a name Sold today counts after the sync
// that saw it, whatever sale date you type.

/** Why a name is in Archive. `left` is a sync removal you haven't labeled. */
export type ArchiveLabel = 'sold' | 'dropped' | 'archived' | 'left';

export interface Ownership {
  archived: boolean;
  label: ArchiveLabel | null;
  /** The event that put it in Archive (what "Move back to Owned" undoes). */
  event: DomainEvent | null;
  /** The account it was last seen in, for showing an Archive row. */
  lastAccountId: string | null;
}

const LABEL: Partial<Record<DomainEvent['type'], ArchiveLabel>> = {
  [DomainEventType.Sold]: 'sold',
  [DomainEventType.Dropped]: 'dropped',
  [DomainEventType.Archived]: 'archived',
};

/** Each name's ownership, for every name with at least one event. */
export function ownershipByDomain(
  events: DomainEvent[],
): Map<string, Ownership> {
  const out = new Map<string, Ownership>();
  const sorted = [...events].sort((a, b) => a.id.localeCompare(b.id));
  for (const e of sorted) {
    const o: Ownership = out.get(e.domain) ?? {
      archived: false,
      label: null,
      event: null,
      lastAccountId: null,
    };
    const account = e.toAccountId ?? e.accountId ?? null;
    if (account) o.lastAccountId = account;
    const label = LABEL[e.type];
    if (label) {
      Object.assign(o, { archived: true, label, event: e });
    } else if (e.type === DomainEventType.Removed) {
      // Leaving after you've said what happened keeps your label.
      if (!o.archived)
        Object.assign(o, { archived: true, label: 'left', event: e });
    } else if (e.type === DomainEventType.Added) {
      // Back in one of your accounts.
      Object.assign(o, { archived: false, label: null, event: null });
    }
    // Purchases, registrations, and moves between your accounts don't change
    // ownership: recording what you paid for a sold name, or moving it before
    // the buyer takes it, leaves it in Archive.
    out.set(e.domain, o);
  }
  return out;
}
