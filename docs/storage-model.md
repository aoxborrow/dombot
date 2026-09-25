# Storage model

Status: design (2026-09-25). Not yet implemented.

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
| —                                        | `domain-notes`          |        | name                       | free-text notes, for any domain                   |
| `domain-purchases` + `portfolio-changes` | `domain-events`         |        | event id                   | purchases, sales, arrivals, moves, drops          |
| `folders` (`assignments` key)            | `domain-folders`        |        | name                       | name → folder id                                  |
| `folders` (`folders` key)                | `folders`               |        | folder id                  | folder definitions                                |
| `pricing-overrides`                      | `domain-prices`         |        | name                       | your manual renewal price                         |
| `settings`, `bulk-jobs`, `mcp`           | _(unchanged)_           |        |                            | app-level                                         |
| `meta`, `auth`                           | _(unchanged)_           | local  |                            | this install only                                 |
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

```ts
interface DomainEvent {
  id: string; // time-sortable (ULID-style), also the storage key
  domain: string; // toAscii(name)
  type:
    | 'purchased'
    | 'sold'
    | 'renewed'
    | 'transferred'
    | 'arrived'
    | 'left'
    | 'moved'
    | 'dropped'
    | 'archived';
  at: string; // when it happened; user-editable for purchases/sales
  recordedAt: string; // when DomBot recorded it
  source: 'user' | 'sync' | 'import';
  accountId?: string | null;
  fromAccountId?: string | null; // moved
  toAccountId?: string | null; // moved
  amount?: string | null; // canonical decimal (money.ts)
  currency?: string | null; // ISO 4217
  counterparty?: string; // Sedo, Afternic, a private buyer…
  notes?: string; // about this event, not the name
  resolves?: string; // a user event closing a sync-detected one
  dismissed?: boolean; // sync alert acknowledged with no action
}
```

- **Repeats are normal.** Drop a name and buy it back: two `purchased`
  events. The cost basis shown in the table is the latest `purchased` since the
  last `sold` or `dropped`.
- **Sync writes, you resolve.** A sync that no longer sees a name writes
  `left` (`source: 'sync'`). Marking it Sold writes `sold` with
  `resolves: <left id>`; Dropped and Archive work the same way. #100's
  baselining (the first sync of an account creates no alerts) carries over as a
  small per-account marker in `domain-events` or `meta`.
- **Sold, Dropped, and Archive are views,** derived from each name's latest
  event, not folders that events have to keep in step with.
- **CSV import is idempotent.** A purchase row that matches an existing event
  on (domain, type, `at`, amount, currency) is skipped, so importing the same
  file twice doesn't double-count.
- **Merge-ready.** Ids are unique across instances, so a later remote sync can
  union `domain-events` by id instead of overwriting it.

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
If a connected registrar later reports the same name, the registrar's row wins
and the manual row is flagged so it can be removed.

`domain-notes` is one string per name, for any domain. It replaces the notes
field #99 put on the purchase record.

## Migration

A schema version lives in `meta` (`schemaVersion`). One shared step,
`runMigrations(store)`, runs before `hydrateStores()` on both hosts
(`src/electron/storage/index.ts`, `src/worker/index.ts`).

**Migration 1:**

1. For each renamed namespace: `list(old)` → `putMany(new, …)` →
   `clear(old)`. Skipped when `old` is empty, so a rerun is harmless.
2. Re-key `domain-folders` and `domain-prices` from `${accountId}:${name}` to
   `toAscii(name)`. When two accounts disagree about the same name, the account
   that currently reports the name in `registrar-domains` wins; otherwise the
   first one found. A conflict is logged, not raised.
3. Split `folders`: the `folders` key stays, the `assignments` map becomes one
   `domain-folders` entry per name.
4. Set `schemaVersion = 1`.

It runs against the **inner** store, below `EncryptedDocStore`, so sealed
values move as ciphertext and are never decrypted. The sealed-namespace set
switches to the new names in the same release.

On the web host it runs inside the request lock with the usual hydrate and
flush around it. The copies use `putMany`, so a large portfolio stays within
the Worker subrequest limit.

## Data bundle v4

- Exports write the new names and `version: 4`.
- `parseBundle` accepts v1–v3 by mapping old names to new ones and re-keying
  folders and prices, the same way the migration does. Every existing backup
  still imports.
- An older DomBot refuses a v4 file ("made by a newer DomBot") instead of
  silently skipping namespaces it doesn't know. For remote sync (#89) that's
  the safe failure.
- Namespaces flagged `local` are never exported; `remote-sync` joins `meta`
  and `auth` there.

## Rollout

1. **Storage conventions PR:** `domain-name.ts` and `DocStore.putMany`
   (moved over from the #99 branch, where they were written), namespace
   flags, renames, name-keyed folders and prices, `runMigrations`, bundle v4.
   Independent of #99 and #100.
2. **Domain history PR:** #99 and #100 combined and reworked onto
   `domain-events`, `domain-notes`, and `manual-domains`, on top of step 1.
   Neither has shipped, so their data needs no migration. Bundle
   re-validation from the #99 branch carries over to `domain-events`.

## Open questions

1. Event ids: a small ULID helper, or `${Date.now()}-${crypto.randomUUID()}`?
2. Should a `renewed` event be written automatically when sync sees the
   expiry move forward, or only by hand?
3. Does `manual-domains` need its own CSV importer, or does the purchase CSV
   grow an "add if missing" option?
