import { assertDomainName, toAscii } from '../../shared/domain-name';
import { parsePurchaseDate } from '../../shared/money';
import {
  DomainEventSource,
  DomainEventType,
  localDay,
  type DomainEvent,
} from '../../shared/domain-events';
import type { CurrencyCode } from '../../shared/currencies';
import { ownershipByDomain } from '../../shared/ownership';
import { diffSync, type AccountHoldings } from '../../shared/sync-diff';
import { markAccountsTracked, trackedAccountIds } from './accounts';
import {
  currentLabel,
  deleteDomainEvents,
  eventsFor,
  replaceLabel,
  getEvent,
  listEvents,
  newEvent,
  putEvents,
} from './domain-events';
import { assignFolder } from './folders';
import { setManualPrice } from './pricing';
import { deleteBinPrices } from './bin-prices';
import { removeManualDomains, takeOverManual } from './manual-domains';
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
  // A manual name an account now reports isn't a new arrival: sync takes it
  // over with a `moved` from no account, on the account's first sync too.
  const takeover = takeOverManual(
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

/** A `YYYY-MM-DD` day from a dialog, or today when it's left blank. */
function dayOf(date: string | null | undefined, label: string): string {
  return parsePurchaseDate(date ?? '', label) ?? localDay();
}

/**
 * Mark names Dropped or Archived, in one write: they move to Archive whatever
 * their registration status. Each `resolves` closes the sync alert it answers.
 * A name already in that state is left as is; one you'd labeled otherwise
 * gets the new label in place of the old (see replaceLabel).
 */
export function setDispositions(
  items: OwnershipItem[],
  type: typeof DomainEventType.Dropped | typeof DomainEventType.Archived,
  date?: string | null,
): DomainEvent[] {
  const day = dayOf(date, 'Date');
  const now = Date.now();
  const events: DomainEvent[] = [];
  for (const item of items) {
    const domain = assertDomainName(item.domainName);
    if (currentLabel(domain) === type) continue;
    const replaced = replaceLabel(domain);
    const resolves = item.resolves ?? replaced.resolves;
    events.push(
      newEvent(
        {
          domain,
          type,
          source: DomainEventSource.User,
          date: day,
          ...(resolves ? { resolves } : {}),
        },
        now,
      ),
    );
  }
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
    deleteBinPrices([domain]);
    removeManualDomains([domain]);
  }
}
