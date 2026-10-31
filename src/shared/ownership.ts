import { DomainEventType, type DomainEvent } from './domain-events';
import { toAscii, toUnicode } from './domain-name';
import type { Domain, RegistrarMeta, RegistrationLookup } from './ipc';

// Owned or Archive (docs/owned-and-archive.md). Archive holds only names you
// no longer have; nothing you hold goes there by hand. What's stored is the
// event log: a sale you recorded, and the removals and arrivals sync saw.
// Everything shown (Expiring, Sold awaiting transfer, and each Archive label)
// is worked out from those, the row, and the registration lookup. Events are
// taken in the order they were recorded (their ids), so marking a name Sold
// today counts after the sync that saw it, whatever sale date you type.

/**
 * Why a name is in Archive, in the order they're checked: you recorded a
 * sale; the lookup says nobody holds it; it left after its expiry; it left
 * early and you marked it dropped; it left early with no sale recorded (the
 * one that asks for review).
 */
export type ArchiveLabel =
  'sold' | 'deleted' | 'expired' | 'dropped' | 'removed';

export const ARCHIVE_LABELS: readonly ArchiveLabel[] = [
  'sold',
  'deleted',
  'expired',
  'dropped',
  'removed',
];

/** Auto-renew off and expiring within this many days shows as Expiring. */
export const EXPIRING_DAYS = 30;
/**
 * An imported name this many days past expiry (beyond grace, redemption, and
 * pending delete) moves to Archive as Expired: no sync will see it leave.
 */
export const IMPORTED_ARCHIVE_DAYS = 90;

const DAY_MS = 86_400_000;

/** What the event log says about a name. */
export interface Ownership {
  /** The sale on record since the name last arrived in an account. */
  sale: DomainEvent | null;
  /** Sync saw it leave your last account: that `removed`, until it's back. */
  removal: DomainEvent | null;
  /** The account it was last seen in, for showing an Archive row. */
  lastAccountId: string | null;
}

/** Each name's ownership, for every name with at least one event. */
export function ownershipByDomain(
  events: DomainEvent[],
): Map<string, Ownership> {
  const out = new Map<string, Ownership>();
  const sorted = [...events].sort((a, b) => a.id.localeCompare(b.id));
  for (const e of sorted) {
    const o: Ownership = out.get(e.domain) ?? {
      sale: null,
      removal: null,
      lastAccountId: null,
    };
    const account = e.toAccountId ?? e.accountId ?? null;
    if (account) o.lastAccountId = account;
    if (e.type === DomainEventType.Sold) {
      o.sale = e;
    } else if (e.type === DomainEventType.Removed) {
      o.removal = e;
    } else if (e.type === DomainEventType.Moved) {
      // Found in another of your accounts: held again, a sale still pending.
      o.removal = null;
    } else if (e.type === DomainEventType.Added) {
      // Back in one of your accounts: a sale before it left is history.
      Object.assign(o, { sale: null, removal: null });
    }
    // Purchases, registrations, and renewals don't change ownership.
    out.set(e.domain, o);
  }
  return out;
}

/** Where a row stands: Owned with its derived states, or Archive and why. */
export interface Standing {
  archived: boolean;
  /** Set exactly when `archived`. */
  label: ArchiveLabel | null;
  /** Owned, with a sale recorded: the buyer hasn't taken it yet. */
  salePending: boolean;
  /** Owned, auto-renew off, expiring within {@link EXPIRING_DAYS}. */
  expiring: boolean;
}

const OWNED: Standing = {
  archived: false,
  label: null,
  salePending: false,
  expiring: false,
};

/** `now`'s UTC calendar day as ms (expiry days are UTC days). */
const utcDayOf = (now: number) => Math.floor(now / DAY_MS) * DAY_MS;

/**
 * Calendar days from today to a `YYYY-MM-DD` day or a Date's UTC day: 0 on
 * the day it expires, negative after. Null if unknown.
 */
function daysUntil(
  day: string | Date | null | undefined,
  now: number,
): number | null {
  if (!day) return null;
  const ms =
    day instanceof Date ? day.getTime() : Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.round((utcDayOf(ms) - utcDayOf(now)) / DAY_MS);
}

/**
 * A row's standing. `registered` is the registration lookup's answer for the
 * name (false: nobody holds it), when there is one. Synced names an account
 * holds are always Owned; departed rows (see {@link archiveRows}) are always
 * Archive; an imported name reaches Archive through a sale, the lookup, or
 * {@link IMPORTED_ARCHIVE_DAYS} past its expiry.
 */
export function standingOf(
  d: Pick<
    Domain,
    'source' | 'departed' | 'expirationDate' | 'autoRenew' | 'autoRenewUnknown'
  >,
  o: Ownership | undefined,
  registered?: boolean | null,
  now: number = Date.now(),
): Standing {
  const sale = o?.sale ?? null;
  if (d.departed) {
    const label: ArchiveLabel = sale
      ? 'sold'
      : registered === false
        ? 'deleted'
        : o?.removal?.expires
          ? 'expired'
          : o?.removal?.dropped
            ? 'dropped'
            : 'removed';
    return { ...OWNED, archived: true, label };
  }
  const days = daysUntil(d.expirationDate, now);
  if (d.source === 'imported') {
    const label: ArchiveLabel | null = sale
      ? 'sold'
      : registered === false
        ? 'deleted'
        : days !== null && days < -IMPORTED_ARCHIVE_DAYS
          ? 'expired'
          : null;
    if (label) return { ...OWNED, archived: true, label };
  }
  return {
    ...OWNED,
    salePending: !!sale,
    expiring:
      !d.autoRenew &&
      !d.autoRenewUnknown &&
      days !== null &&
      days >= 0 &&
      days <= EXPIRING_DAYS,
  };
}

/**
 * Of `domains` (the synced ones and the ones you added), those in Owned,
 * not already in Archive: what the Domains page and its tab count. And of
 * those, the ones that still renew, less the names you've sold that the
 * buyer hasn't taken yet: what the Renewals page and its tab add up.
 */
export function ownedAndRenewing(
  domains: Domain[],
  events: DomainEvent[],
  lookups: Record<string, RegistrationLookup | null>,
  now: number = Date.now(),
): { owned: Domain[]; renewing: Domain[] } {
  const ownership = ownershipByDomain(events);
  const owned: Domain[] = [];
  const renewing: Domain[] = [];
  for (const d of domains) {
    const key = toAscii(d.domainName);
    const st = standingOf(d, ownership.get(key), lookups[key]?.registered, now);
    if (st.archived) continue;
    owned.push(d);
    if (!st.salePending) renewing.push(d);
  }
  return { owned, renewing };
}

/** An Archive label that still wants an answer from you. */
export function needsReview(label: ArchiveLabel | null): boolean {
  return label === 'removed';
}

/**
 * The `expires` to record on a removal: the expiry sync last saw, when that
 * UTC day had passed by the time the name left (a lapse, Archive's Expired).
 */
export function removalExpiry(
  expires: string | undefined,
  now: number,
): { expires: string } | Record<string, never> {
  const today = new Date(utcDayOf(now)).toISOString().slice(0, 10);
  return expires && expires < today ? { expires } : {};
}

/**
 * Rows for names in Archive that no registrar reports any more: sync saw
 * them leave, or you recorded a sale for a name DomBot holds nothing else
 * for. They carry the account the name was last seen in and the expiry sync
 * last saw; the Archive view refreshes created and expires from the public
 * registration lookup.
 */
export function archiveRows(
  ownership: Map<string, Ownership>,
  live: Domain[],
  registrars: RegistrarMeta[] | null,
): Domain[] {
  const held = new Set(live.map((d) => toAscii(d.domainName)));
  const rows: Domain[] = [];
  for (const [name, o] of ownership) {
    if (!(o.removal || o.sale) || held.has(name)) continue;
    const meta = registrars?.find(
      (r) => (r.accountId ?? r.name) === o.lastAccountId,
    );
    const left = o.removal ?? o.sale;
    rows.push({
      registrar: (meta?.name ?? '') as Domain['registrar'],
      accountId: o.lastAccountId ?? undefined,
      accountLabel: meta?.accountLabel,
      domainName: toUnicode(name),
      status: '',
      createdDate: null,
      expirationDate: o.removal?.expires
        ? new Date(`${o.removal.expires}T00:00:00Z`)
        : null,
      renewalDate: null,
      autoRenew: false,
      locked: false,
      privacy: false,
      nameservers: [],
      syncedAt: new Date(left?.createdAt ?? 0),
      deleted: false,
      source: 'registrar',
      departed: true,
    });
  }
  return rows;
}
