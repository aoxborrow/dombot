import type { CurrencyCode } from './currencies';

// The domain event log (docs/storage-model.md, "Domain events"). One record
// per thing that happened to a name: something you did (bought it, sold it)
// or something sync saw (it appeared in an account, it left one). Stored in
// `domain-events`, keyed by `id`, so a new event is one small write and the
// history is never rewritten.
//
// The stored values are the lowercase strings. They never change once
// written: renaming a constant is free, renaming a value needs a migration.

export const DomainEventType = {
  // Something you did.
  Registered: 'registered', // hand-registered as a new name
  Purchased: 'purchased', // bought from someone (aftermarket, private)
  Sold: 'sold',
  Dropped: 'dropped', // you let it go; or the lookup found it gone
  Archived: 'archived', // no longer yours, reason unspecified
  Renewed: 'renewed',
  // Something sync saw.
  Added: 'added', // the name appeared in an account
  Removed: 'removed', // the name is gone from an account
  Moved: 'moved', // gone from one of your accounts, appeared in another
} as const;
export type DomainEventType =
  (typeof DomainEventType)[keyof typeof DomainEventType];

export const DomainEventSource = {
  User: 'user',
  Sync: 'sync',
  Import: 'import',
  Lookup: 'lookup', // the registration check (the automatic drop only)
} as const;
export type DomainEventSource =
  (typeof DomainEventSource)[keyof typeof DomainEventSource];

const EVENT_TYPES = new Set<string>(Object.values(DomainEventType));
const EVENT_SOURCES = new Set<string>(Object.values(DomainEventSource));

export function isDomainEventType(value: unknown): value is DomainEventType {
  return typeof value === 'string' && EVENT_TYPES.has(value);
}

export function isDomainEventSource(
  value: unknown,
): value is DomainEventSource {
  return typeof value === 'string' && EVENT_SOURCES.has(value);
}

/** Types that start a holding: what you paid shows against these. */
export const ACQUISITION_TYPES: ReadonlySet<DomainEventType> = new Set([
  DomainEventType.Registered,
  DomainEventType.Purchased,
]);

export interface DomainEvent {
  /** Time-sortable id (see `newEventId`), also the storage key. */
  id: string;
  /** `toAscii(name)`. */
  domain: string;
  type: DomainEventType;
  source: DomainEventSource;
  /**
   * `YYYY-MM-DD`, the day it happened; user-editable. Null only for a
   * purchase or sale you recorded without knowing the day.
   */
  date: string | null;
  /** ms epoch, when DomBot recorded it. */
  createdAt: number;
  /** ms epoch, the last edit; null until edited. */
  updatedAt: number | null;
  accountId?: string | null;
  fromAccountId?: string | null; // moved
  toAccountId?: string | null; // moved
  /** Canonical decimal ("19.99", "1500"); set together with `currency`. */
  amount?: string | null;
  currency?: CurrencyCode | null;
  /** registered, purchased, renewed: the term in years. */
  years?: number | null;
  /** The id of the sync event this user event resolves. */
  resolves?: string;
  /** A sync alert acknowledged with no action. */
  dismissed?: boolean;
}

/** A note on a name, or on one of its events. Stored in `domain-notes`. */
export interface DomainNote {
  id: string;
  /** `toAscii(name)`. */
  domain: string;
  /** Null: about the name. Set: about that event. */
  eventId: string | null;
  text: string;
  createdAt: number;
  updatedAt: number | null;
}

/**
 * `YYYY-MM-DD` for a moment, in this machine's local time: the day you'd
 * say it happened. (A Worker has no local zone, so there it's the UTC day.)
 */
export function localDay(ms: number = Date.now()): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// Crockford base32, as ULID uses: sortable as plain strings.
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A monotonic ULID: 10 characters of millisecond timestamp, then 16 of
 * randomness. Ids sort by when they were made, and two instances never
 * collide, so a later remote sync can union events by id. Within one
 * millisecond (a sync writes several events at once) each id increments the
 * last one instead of drawing new randomness, so order is kept exactly.
 */
let lastTime = -1;
let lastRandom: number[] = [];

export function newEventId(now: number = Date.now()): string {
  const t0 = Math.max(now, lastTime);
  let random: number[];
  if (t0 === lastTime) {
    random = [...lastRandom];
    // Base-32 increment from the right (16 digits never overflow in practice).
    for (let i = random.length - 1; i >= 0; i--) {
      if (random[i] < 31) {
        random[i]++;
        break;
      }
      random[i] = 0;
    }
  } else {
    random = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (b) => b % 32,
    );
  }
  lastTime = t0;
  lastRandom = random;
  let time = '';
  let t = t0;
  for (let i = 0; i < 10; i++) {
    time = BASE32[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + random.map((d) => BASE32[d]).join('');
}
