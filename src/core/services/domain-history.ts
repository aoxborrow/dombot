import { assertDomainName, toAscii } from '../../shared/domain-name';
import {
  DomainEventSource,
  DomainEventType,
  localDay,
  type DomainEvent,
} from '../../shared/domain-events';
import type { CurrencyCode } from '../../shared/currencies';
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
import { deleteListPrices } from './list-prices';
import { removeImportedDomains, takeOverImported } from './imported-domains';
import { Namespace } from '../storage/namespace';

// Ownership history on top of the event log: what sync saw
// (docs/storage-model.md, "Owned and Archive"). Purchases and sales are in
// purchases.ts; this is everything else.

/**
 * What each account's last successful sync saw, keyed by account id. Sync
 * compares against this, not the registrar cache, so "Clear cache" can't make
 * it miss a change; and it's exported, so it travels with `domain-events` and
 * `trackedSince` and an imported history carries on where it left off.
 */
interface LastSync {
  /** `toAscii` names. */
  names: string[];
  /**
   * `toAscii` name → expiry `YYYY-MM-DD`, for spotting renewals. Absent in a
   * record from an older build: that account's next sync fills it in and
   * records no renewals.
   */
  expirations?: Record<string, string>;
  /**
   * `toAscii` name → a DomBot renewal sync hasn't seen yet: when it was
   * recorded (ms epoch) and the years it added. The expiry jump that shows it
   * is that renewal, already recorded; only years beyond it are new. An entry
   * no jump has claimed in `AWAIT_MS` is dropped.
   */
  awaiting?: Record<string, Awaiting>;
  /** ms epoch. */
  syncedAt: number;
}

interface Awaiting {
  at: number;
  years: number;
}

/** How long a DomBot renewal waits for sync to see its new expiry. */
const AWAIT_MS = 90 * 86_400_000;
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
    const record = lastSync.get(h.accountId);
    const names = record?.names;
    const known = Array.isArray(names);
    return {
      accountId: h.accountId,
      names: known ? names.filter((n) => typeof n === 'string') : [],
      synced: false,
      known,
      expirations: cleanExpirations(record?.expirations),
      awaiting: Object.fromEntries(
        Object.entries(cleanAwaiting(record?.awaiting, now)).map(
          ([name, a]) => [name, a.years],
        ),
      ),
    };
  });
  const diff = diffSync(
    before,
    after,
    listEvents(),
    trackedAccountIds(),
    now,
    newEvent,
  );
  const { newlyTracked } = diff;
  // An imported name an account now reports isn't a new arrival: sync takes it
  // over with a `moved` from no account, on the account's first sync too.
  const takeover = takeOverImported(
    after.filter((h) => h.synced),
    now,
  );
  const events = [
    ...diff.events.filter(
      (e) =>
        !(e.type === DomainEventType.Added && takeover.names.has(e.domain)),
    ),
    ...takeover.events,
  ];
  putEvents(events);
  deleteDomainEvents(diff.retracted);
  markAccountsTracked(newlyTracked, now);
  void lastSync.setMany(
    after
      .filter((h) => h.synced)
      .map((h) => {
        const awaiting = cleanAwaiting(
          lastSync.get(h.accountId)?.awaiting,
          now,
        );
        for (const l of diff.landed)
          if (l.accountId === h.accountId) delete awaiting[l.domain];
        return [
          h.accountId,
          {
            names: [...new Set(h.names.map(toAscii))].sort(),
            expirations: h.expirations ?? {},
            ...(Object.keys(awaiting).length ? { awaiting } : {}),
            syncedAt: now,
          },
        ];
      }),
  );
  // A renewal that moved the name to another account lands in the old one's
  // record, which this sync may not rewrite.
  const stale = new Map<string, LastSync>();
  for (const l of diff.landed) {
    if (after.some((h) => h.synced && h.accountId === l.accountId)) continue;
    const record = stale.get(l.accountId) ?? lastSync.get(l.accountId);
    if (!record?.awaiting || !(l.domain in record.awaiting)) continue;
    const awaiting = { ...record.awaiting };
    delete awaiting[l.domain];
    stale.set(l.accountId, { ...record, awaiting });
  }
  if (stale.size > 0) void lastSync.setMany([...stale]);
  return events;
}

/** Stored awaiting renewals still in their window, malformed entries dropped. */
function cleanAwaiting(value: unknown, now: number): Record<string, Awaiting> {
  const out: Record<string, Awaiting> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [name, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== 'object') continue;
    const { at, years } = entry as Partial<Awaiting>;
    if (
      typeof at === 'number' &&
      now - at < AWAIT_MS &&
      typeof years === 'number' &&
      years > 0
    )
      out[name] = { at, years };
  }
  return out;
}

/** A stored expirations map, or undefined when it's missing or malformed. */
function cleanExpirations(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const out: Record<string, string> = {};
  for (const [name, day] of Object.entries(value))
    if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day))
      out[name] = day;
  return out;
}

/** A renewal DomBot made and the registrar confirmed. */
export interface ConfirmedRenewal {
  domainName: string;
  accountId: string;
  years: number;
  /** What the registrar charged, when its response said. */
  charge?: { amount: string; currency: CurrencyCode } | null;
}

/**
 * Record confirmed renewals as `renewed` events, in one write, and mark each
 * name awaiting in its account's last-sync record: the expiry jump the next
 * syncs see (now, or once a slow registrar shows it) is this renewal, not
 * another. The amount is only what the registrar charged;
 * without it the event has none, and the price is estimated when read.
 */
export function recordRenewals(
  renewals: ConfirmedRenewal[],
  source: DomainEventSource = DomainEventSource.User,
): DomainEvent[] {
  if (renewals.length === 0) return [];
  const now = Date.now();
  const date = localDay(now);
  const events = renewals.map((r) =>
    newEvent(
      {
        domain: assertDomainName(r.domainName),
        type: DomainEventType.Renewed,
        source,
        date,
        accountId: r.accountId,
        years: r.years,
        ...(r.charge
          ? { amount: r.charge.amount, currency: r.charge.currency }
          : {}),
      },
      now,
    ),
  );
  putEvents(events);

  const marked = new Map<string, LastSync>();
  for (const r of renewals) {
    const record = marked.get(r.accountId) ?? lastSync.get(r.accountId);
    // No expiries kept yet: sync can't see a jump, so nothing to wait for.
    if (!record || !cleanExpirations(record.expirations)) continue;
    const awaiting = cleanAwaiting(record.awaiting, now);
    const name = toAscii(r.domainName);
    // Two renewals before a sync sees either: one jump covering both.
    const years = (awaiting[name]?.years ?? 0) + r.years;
    marked.set(r.accountId, {
      ...record,
      awaiting: { ...awaiting, [name]: { at: now, years } },
    });
  }
  if (marked.size > 0) void lastSync.setMany([...marked]);
  return events;
}

/**
 * The names each account's last sync saw, as name → account id. Survives
 * Clear cache, unlike the registrar cache.
 */
export function lastSyncedNames(accountIds: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of accountIds) {
    const names = lastSync.get(id)?.names;
    if (!Array.isArray(names)) continue;
    for (const name of names)
      if (typeof name === 'string' && !out.has(name))
        out.set(toAscii(name), id);
  }
  return out;
}

/** A name to act on, and the sync alert the action answers, if any. */
export interface OwnershipItem {
  domainName: string;
  resolves?: string;
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
 * folder, prices, its imported row). Only for names no
 * connected account holds (`held`, `toAscii` names): imported names and
 * Archive names. Held names are skipped; returns how many were removed.
 */
export function deleteDomains(
  domainNames: string[],
  held: ReadonlySet<string>,
): number {
  const removable = domainNames
    .map((name) => assertDomainName(name))
    .filter((domain) => !held.has(domain));
  if (removable.length === 0 && domainNames.length > 0) {
    throw new Error(
      domainNames.length === 1
        ? `${toAscii(domainNames[0])} is in one of your accounts; turn off its auto-renew to let it go.`
        : 'Every one of these is in one of your accounts; turn off auto-renew to let them go.',
    );
  }
  for (const domain of removable) {
    deleteDomainEvents(
      eventsFor(domain).map((e) => e.id),
      domain,
    );
    assignFolder(domain, null);
    setManualPrice(domain, null);
    deleteListPrices([domain]);
    removeImportedDomains([domain]);
  }
  return removable.length;
}
