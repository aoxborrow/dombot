# Storage model

Status: storage conventions implemented (naming, flags, name-keyed folders and
prices, migration, bundle v4); domain events and manual domains not yet.

A naming and keying standard for everything DomBot persists, a domain event
history that replaces the separate purchase and portfolio-change stores
(#99, #100), and the one-time migration that moves existing installs onto it.

## Why

- **Names don't say what's inside.** `cache-portfolio` and a future `domains`
  both sound like "the domains." `portfolio-changes` and `cache-portfolio` put
  the same word in different positions. The prefix `cache-` is doing double
  duty as a behavior flag.
- **Behavior lives in hand-kept lists.** `CACHE_NAMESPACES` (Clear cache) and
  `NEVER_EXPORTED` (data bundle) have to be remembered whenever a namespace is
  added.
- **Per-domain data is keyed three different ways.** Folder assignments and
  price overrides use `${accountId ?? registrar}:${domain}`, so they're lost
  when a name moves between accounts. Purchases (#99) use the bare name. None
  of them canonicalize IDNs.
- **History can't hold repeats.** #99 stores one purchase per name, so a name
  you drop and later buy back overwrites its first purchase. #100 stores every
  change in one array under one key, so each change rewrites the whole history.

## Two kinds of domain data

|                   | Registrar-reported                           | Yours                                                                   |
| ----------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| Examples          | the account's name list, expiry, nameservers | notes, purchases, sales, folders, price overrides, manually added names |
| Keyed by          | account                                      | domain name                                                             |
| Can be re-fetched | yes                                          | no                                                                      |
| Authority         | the registrar                                | you                                                                     |
| Namespace prefix  | `registrar-`                                 | `domain-`, `manual-domains`                                             |

The Domains page merges the two: the registrar's list plus manual domains,
annotated with your notes, folders, prices, and history.

## Naming

Kebab-case: `<subject>-<plural noun>`. Names describe the data, not how it's
treated. Behavior is declared where the namespace is created:

```ts
new Namespace('registrar-domains', { cache: true }); // Clear cache wipes it
new Namespace('remote-sync', { local: true }); // never exported
new Namespace('domain-events'); // default: kept, exported
```

`clearAll` and `exportNamespaces` read those flags from the registry, which
retires `CACHE_NAMESPACES` and `NEVER_EXPORTED`. Encryption stays an explicit
set passed to `EncryptedDocStore`.

| Today                                    | New                     | Flags  | Keyed by                   | Holds                                             |
| ---------------------------------------- | ----------------------- | ------ | -------------------------- | ------------------------------------------------- |
| `cache-portfolio`                        | `registrar-domains`     | cache  | account                    | each account's name list, as reported             |
| `cache-detail`                           | `registrar-details`     | cache  | account + name             | per-domain detail from the registrar              |
| `tld-rates`                              | `registrar-tld-rates`   | cache  | account or registrar + TLD | fetched renewal rates                             |
| `registration-lookups` (#100)            | `rdap-lookups`          | cache  | name                       | public RDAP registration data                     |
| `registrar-accounts`                     | _(unchanged)_           |        | account id                 | connected accounts                                |
| `credentials`                            | `registrar-credentials` | sealed | account id                 | API keys                                          |
| `proxies`                                | `registrar-proxies`     | sealed | proxy id                   | proxy profiles                                    |
| `registrar-state`                        | `registrars`            |        | fixed keys                 | which registrars are switched on                  |
| —                                        | `manual-domains`        |        | name                       | names you add that no connected registrar reports |
| —                                        | `domain-notes`          |        | note id                    | notes on a domain, or on one of its events        |
| `domain-purchases` + `portfolio-changes` | `domain-events`         |        | event id                   | purchases, sales, arrivals, moves, drops          |
| `folders` (`assignments` key)            | `domain-folders`        |        | name                       | name → folder id                                  |
| `folders` (`folders` key)                | `folders`               |        | folder id                  | folder definitions                                |
| `__archive__` folder assignments         | `domain-hidden`         |        | name                       | names hidden from the default list                |
| `pricing-overrides`                      | `domain-prices`         |        | name                       | your manual renewal price                         |
| `settings`, `bulk-jobs`, `mcp`           | _(unchanged)_           |        |                            | app-level                                         |
| `meta`                                   | _(unchanged)_           | local  |                            | this install only                                 |
| — (#89)                                  | `remote-sync`           | local  |                            | the remote URL                                    |

Clear cache now also wipes `registrar-tld-rates`; the next sync refetches it.
`rdap-lookups` is flagged cache too, so Clear cache wipes it as well (today
#100 keeps it).

## Keys

- **Anything about a name, wherever it's held:** `toAscii(name)` from
  `src/shared/domain-name.ts` — lowercased, protocol and outer dots stripped,
  punycode. `Münich.DE`, `https://münich.de/`, and `xn--mnich-kva.de` are one
  key. `toUnicode` is for display only.
- **Anything about one account's copy of a name** (registrar cache only):
  `${accountId}:${toAscii(name)}`.
- The `${accountId ?? registrar}:` fallback goes away in the migration.

Folders and price overrides are keyed by name, so they follow a domain when it
moves between accounts. A name held by two accounts at once (mid-transfer)
shares one folder and one price.

## Domain events

One document per event in `domain-events`, keyed by a time-sortable id, so a
new event writes one small row and never rewrites the history.

Event types and sources are const maps in `src/shared/domain-events.ts`, in
the same style as `IpcChannels`, so code reads `DomainEventType.Removed`
rather than a bare string. The stored value is the lowercase string, which
never changes once written; renaming a constant is free, renaming a value
needs a migration.

```ts
export const DomainEventType = {
  // Something you did.
  Registered: 'registered', // hand-registered as a new name
  Purchased: 'purchased', // bought from someone (aftermarket, private)
  Sold: 'sold',
  Renewed: 'renewed', // written by sync when the expiry moves forward (future)
  Dropped: 'dropped', // you let it go; or the lookup found it gone (see below)
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

interface DomainEvent {
  id: string; // time-sortable (ULID-style), also the storage key
  domain: string; // toAscii(name)
  type: DomainEventType;
  date: string; // YYYY-MM-DD, the day it happened; user-editable
  createdAt: number; // ms epoch, when DomBot recorded it
  updatedAt: number | null; // ms epoch, last edit
  source: DomainEventSource;
  accountId?: string | null;
  fromAccountId?: string | null; // moved
  toAccountId?: string | null; // moved
  amount?: string | null; // canonical decimal, e.g. "19.99", "1500" (money.ts)
  currency?: CurrencyCode | null; // ISO 4217, from CURRENCIES
  years?: number | null; // registered, purchased, renewed: term length
  resolves?: string; // a user event closing a sync-detected one
  dismissed?: boolean; // sync alert acknowledged with no action
}
```

- **Repeats are normal.** Drop a name and buy it back: two `purchased`
  events. The cost basis shown in the table is the latest `purchased` or
  `registered` since the last `sold` or `dropped`.
- **No separate transfer type.** DomBot sees accounts, not registrar
  transfers, so a transfer always lands as one of the sync events: to another
  of your accounts (even at another registrar) is `moved`; to someone else is
  `removed`, resolved as `sold`; in from outside is `added`, resolved as
  `purchased`.
- **Timestamps follow the codebase.** Something DomBot records is `…At:
number` (ms epoch, like `createdAt`, `startedAt`, `fetchedAt`); a calendar
  day is a `YYYY-MM-DD` string (like `purchaseDate`), so it can't shift with
  the timezone. A sync event's `date` is the day of the sync; `createdAt` has
  the exact time.
- **Amounts are decimal strings,** as #99 stores them: digits and an optional
  period, with exactly the currency's decimal places (USD 2, JPY 0, KWD 3). A
  string is exact (no float rounding), reads as money in a data file, and
  exports to CSV unchanged, and the same text imports back. Code that needs to
  sum or compare parses it to integer minor units for the calculation.
- **Currencies are a fixed list.** `CURRENCIES` in `src/shared/currencies.ts`
  holds every active ISO 4217 code with its decimal places, and `CurrencyCode`
  is derived from it. A static list, not `Intl.supportedValuesOf`, so Electron,
  browsers, and the Worker all accept the same codes.
- **Notes point at events, not the other way round.** An event has no text;
  a `domain-notes` record can reference it (see below).
- **Amount and currency travel together.** Both set or both null, as #99
  already enforces.
- **`years` spreads a cost.** A 3-year renewal's amount covers three years, so
  a yearly view divides by `years` instead of charging it all to one year.
- **You vs. sync.** `added` and `removed` only say that a name appeared in or
  disappeared from an account; they don't say why. The user events say what
  happened (`purchased`, `sold`, `dropped`), usually resolving a sync one.
- **Sync writes, you resolve.** A sync that no longer sees a name writes
  `removed` (`source: 'sync'`) and raises an alert. Marking it Sold writes
  `sold` with `resolves: <removed id>`; Dropped writes `dropped` the same
  way; Dismiss sets `dismissed` on the `removed` event and records nothing
  else. #100's baselining (the first sync of an account creates no alerts)
  carries over as a small per-account marker.
- **CSV import is idempotent.** A purchase row that matches an existing event
  on (domain, type, `date`, amount, currency) is skipped, so importing the same
  file twice doesn't double-count.
- **Merge-ready.** Ids are unique across instances, so a later remote sync can
  union `domain-events` by id instead of overwriting it.

## Owned, History, and Hidden

Two separate questions, which the old Hidden → Archive folder had merged:

- **Do you still own it?** Owned or History, from events.
- **Do you want to see it?** Hidden or not, a per-name preference.

### Owned and History

A name is in **History** once its latest ownership event is `sold` or
`dropped`. Everything else is **Owned**, including a name that has left your
accounts but that you haven't resolved yet: it shows in the alerts until you
do. History is derived from events, never from a folder.

- **Two manual actions, Sold and Dropped.** Either moves the name to History
  at once, whatever its registration status: a sale in progress, or a name
  you've decided not to renew that is still in your account. Sold also records
  the price. "Move back to Owned" deletes that event (user events are editable).
- **Nothing else changes ownership on its own.** A name that leaves your
  accounts only raises a `removed` alert. Someone who manages names elsewhere
  and doesn't sync for months comes back to a list of alerts, never to names
  wrongly marked Dropped.
- **The one automatic case.** The registration check (`rdap-lookups`) writes
  `dropped` with `source: 'lookup'` only when both hold:
  1. RDAP gives a definite "not registered": a 404 from the registry's own RDAP
     server. A network error, timeout, any other status, or a 404 from the
     `rdap.org` redirector itself (which may mean it has no server for that
     TLD) counts as unknown and changes nothing.
  2. Today is past the name's last expiry date as DomBot knew it (from the
     registrar data before the name left).

  A real registration can't be missing before it expires, so a faulty lookup
  can't drop a name you still hold.

- **No derived "transferred" label.** RDAP only shows the registrar; an expired
  name sold or auctioned at the same registrar never changes registrar, and
  the registrant is redacted under GDPR (and registrar-scoped where present),
  so ownership can't be read from it.

### Hidden

`domain-hidden` holds names you still own but don't want in the default list:
personal names, or expiring ones you're letting go and don't want to bother
marking. It's a view preference, not an event, and independent of folders, so
a name can be in "Personal" and hidden. Hide and unhide from the row menu or
in bulk; a "Show hidden" filter brings them back. Hidden names still sync and
still raise alerts.

## Manual domains and notes

`manual-domains` holds names you own that no connected registrar reports —
typed in, or imported from a CSV:

```ts
interface ManualDomain {
  registrar?: string; // free-text label, e.g. "Epik (no API)"
  expiresAt?: string | null;
  createdAt?: string | null;
  autoRenew?: boolean | null;
  addedAt: string;
}
```

They join the Domains table beside the registrar list and take folders,
prices, notes, and events like any other name. Clear cache never touches them.
If a connected registrar later reports the same name, sync removes the
`manual-domains` entry and the registrar's row takes over. Notes, events,
folders, and prices are keyed by name, not by the manual entry, so they carry
straight across; the name never leaves the table, it only changes source.

`domain-notes` holds note records, keyed by note id, for any domain:

```ts
interface DomainNote {
  id: string; // storage key
  domain: string; // toAscii(name)
  eventId: string | null; // null: about the name; set: about that event
  text: string;
  createdAt: number; // ms epoch
  updatedAt: number | null; // ms epoch
}
```

The name's general note is the one with `eventId: null`, which replaces the
notes field #99 put on the purchase record. A sale or purchase can carry its
own note ("via Afternic, paid through Escrow.com") by pointing at its event.
The link lives on the note, so events stay small, an event can have several
notes, and deleting an event deletes its notes.

Notes stay their own namespace rather than fields on a catch-all per-name
record: each `domain-*` namespace holds one thing, so a future remote-sync
merge can't collide two unrelated edits to the same name. A new per-name field
(tags, an asking price) gets its own small namespace.

## Migration

A schema version lives in `meta` (`schemaVersion`).
`runMigrations(raw, store)` (`src/core/storage/migrations.ts`) runs before
`hydrateStores()` on both hosts: in `initStorage` on desktop, and in the
Worker's per-isolate boot, which every request awaits.

**Migration 1:**

1. Split `folders`: the `folders` key stays, the `assignments` map becomes one
   `domain-folders` entry per name (the legacy `__hidden__` Archive id is
   normalized on the way).
2. For each renamed namespace: `list(old)` → `putMany(new, …)` →
   `clear(old)`. Skipped when `old` is empty, so a rerun is harmless.
   `pricing-overrides` is re-keyed from `${accountId ?? registrar}:${name}`
   to `toAscii(name)` on the way.
3. Set `schemaVersion = 1`.

Re-keying by name can collide when two accounts held the same name with
different values. The first entry found wins and the rest are logged. (It only
happens for a name held by two accounts at once, i.e. mid-transfer.)

`raw` is the store **beneath** `EncryptedDocStore`, so renames copy values
exactly as stored: sealed values move as ciphertext, and a value the cipher
can't open right now (a locked desktop keyring) is moved rather than dropped.
The sealed-namespace set switches to the new names in the same release. The
folder map is the one value that has to be read; it goes through the
configured `store`, and if it exists but can't be opened the migration stops
before changing anything and retries on the next start.

The copies use `putMany`, so a large portfolio stays within the Worker
subrequest limit. Two Worker isolates booting at once can both run it;
copy-then-clear makes that safe, and the only exposure is a write landing in
a new namespace in the moment another isolate is still copying into it, which
is limited to the first requests after deploying this release.

**Migration 2** (ships with the domain history work):

1. Every `domain-folders` entry pointing at `__archive__` becomes a
   `domain-hidden` entry and is removed from `domain-folders`. Archive began
   as Hidden, and that's what these assignments mean: names you still own and
   don't want to see. Archive leaves the folder model.
2. Set `schemaVersion = 2`. A v4 bundle from before this release gets the same
   step on import.

## Data bundle v4

- Exports write the new names and `version: 4`.
- `parseBundle` accepts v1–v3 by mapping old names to new ones and re-keying
  folders and prices, the same way the migration does. Every existing backup
  still imports.
- An older DomBot refuses a v4 file ("made by a newer DomBot") instead of
  silently skipping namespaces it doesn't know. For remote sync (#89) that's
  the safe failure.
- Namespaces flagged `local` are never exported and never replaced by an
  import; today that's `meta`, and `remote-sync` (#89) will join it. (`auth`
  was on the old never-exported list but no namespace by that name exists; an
  unknown namespace in a file is skipped anyway.)

## Rollout

1. **Storage conventions PR:** `domain-name.ts` and `DocStore.putMany`
   (moved over from the #99 branch, where they were written), namespace
   flags, renames, name-keyed folders and prices, `runMigrations`, bundle v4.
   Independent of #99 and #100.
2. **Domain history PR:** #99 and #100 combined and reworked onto
   `domain-events`, `domain-notes`, and `manual-domains`, on top of step 1.
   Neither has shipped, so their data needs no migration. Bundle
   re-validation from the #99 branch carries over to `domain-events`.

## Decided

- **Event ids carry their date.** A time-sortable id (ULID-style: a
  millisecond timestamp prefix plus randomness), so ids sort by when the event
  was recorded and stay unique across instances.

## Future work

- **Every domain change writes an event.** Review each place that changes a
  domain — registrar sync, bulk edits, nameserver and auto-renew changes, MCP
  tool writes, renewals seen when the expiry moves forward — and have it append
  to `domain-events`. The first domain-history PR only needs purchases, sales,
  and the sync-detected arrivals, departures, and moves.
- **Venues.** Once marketplaces are set up, a sale or purchase gets a
  `venueId` pointing at a venue record (Afternic, Sedo, …) that holds the
  commission rate, so fees are derived rather than entered per sale.
- **Installments.** A sale paid in installments stays one `sold` event;
  individual payments aren't recorded. The event gains the terms (e.g. number
  of payments and period) so the dashboard can show the schedule.
- **Exchange rates.** Totals across currencies need a rate per event. Each
  event already has its `date` and `currency`, so historical rates can be
  looked up later without changing stored events.
- **Manual domains importer.** A CSV importer for `manual-domains`, designed
  separately. The purchase CSV (#99, reworked in #100) needs its own review
  before it merges.
