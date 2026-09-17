# Multiple registrar accounts

Settings → Registrars shows **one card per account**. An account is one set of
API credentials at one registrar; you can have as many as you like, including
several at the same registrar.

## Adding an account

**Add registrar account**, at the top of the page, lists every supported
registrar. Choosing one opens a new card at the top of the list with that
registrar's credential form. Nothing is saved yet: **Add account** tests the
connection first and only then stores the credentials and syncs the account's
domains. A failed test or **Cancel** leaves nothing behind. One new account can
be in progress at a time; the button is disabled until it is added or
cancelled. With no accounts at all, the page shows the supported registrars as
a grid of buttons that do the same thing.

## Nicknames

Every account has a nickname, but it only matters once a registrar has more
than one account. A lone account is shown as just "Dynadot" everywhere, and its
nickname field is optional; left blank, DomBot assigns a name (`Main`, then
`Account 2`, `Account 3`, …). Accounts adopted from before multi-account support
are named `Default`.

When you add a second account at a registrar, the form requires a nickname for
it. If the existing account still has one of the names DomBot made up, the form
also asks you to name that one, so both end up with names you chose. From then
on the cards read "Dynadot · Personal" and "Dynadot · Agency".

Nicknames are unique within a registrar, ignoring case. The same nickname can
be reused at a different registrar. They are display names only, never routing
identifiers, and can be changed at any time from the account's card.

## The account card

Collapsed, a card shows the enable switch, the registrar (and nickname when it
has siblings), the last sync result and domain count, and a **Sync** button.
Expanded, it holds the nickname, the credentials, registrar-specific options
such as Namecheap's fixed IP proxy, **Save**, and **Remove account**. Cards are
sorted by registrar, then nickname.

Everything on a card applies to that account only. There are no
registrar-wide controls: the toolbar's Sync refreshes every enabled account.

Domains and Renewals combine enabled accounts. Their Account column/filter appears only if at least one registrar has multiple accounts. Registrars with only one account do not display a redundant nickname, including in a mixed portfolio. Exports and MCP retain account identity for reliable routing regardless of which UI fields are visible.

Disabling an account keeps its credentials and cache but removes it from the visible portfolio and future syncs. Enabling syncs it again. A failed sync keeps its last successful domains and timestamp and reports the error on that account. Removing an account clears its credentials, portfolio, and detail cache, and works for a registrar's only account too; the registrar stays available from **Add registrar account**. It never removes another account's data.

## Existing data and backups

Existing single-account installations are adopted in place as a **Default** account for each provider. The account ID remains the existing provider key, such as `dynadot`. No credentials need to be re-entered, and existing folder assignments, manual prices, disabled state, and compatible caches remain associated with that account. New accounts receive UUIDs. Labels are editable display names, never routing identifiers.

Credentials remain in the existing encrypted namespace: OS encryption on desktop, and AES-GCM on the self-hosted web host. Account metadata and cached slices travel in data exports. New exports use bundle format **2**, supported by both updated hosts. Format **1** imports are accepted; older Dombot versions reject format 2 instead of silently dropping account metadata. Move multi-account backups only between updated builds.

## MCP

Start with `registrar_list`. Its `accounts` array includes `accountId`, `registrar`, `label`, `configured`, `enabled`, and per-account `sync` state, without secrets. `portfolio_query` rows and sync errors carry account identity. It also accepts an `accountId` filter.

Every registrar-scoped and domain-scoped tool accepts an optional `accountId`:

```json
{ "registrar": "dynadot", "accountId": "<ID from registrar_list>" }
```

Existing calls continue to work when there is one unambiguous account. A domain operation can infer its unique enabled owner from the cached portfolio. A selected account must match the registrar and any cached ownership evidence; an unknown, disabled, mismatched, or ambiguous selection fails before the provider operation. Sync first when ownership has changed.

Provider-level operations, including registration and inbound transfer, require an explicit destination when several configured accounts exist. Labels are not accepted in place of IDs. Bulk work resolves and stores IDs before it starts and validates them again when each operation runs. Jobs saved before multi-account support stay pinned to their original default account when resumed. Provider-level rate limits remain shared conservatively across its accounts.

## Validation

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run web:build`, and `npm run package`.

`src/core/services/accounts.test.ts` exercises real storage, routing, API validation, and MCP handlers over synthetic providers: legacy adoption, rename/update/disable/remove isolation, restart, account-specific detail/prices, last-good data on failures, stale sync fencing, ambiguous/mismatched operations, persisted bulk routing, encrypted desktop/web backup round trips, corrupt routing metadata, and encryption-write failure.

For a manual browser exercise with the real shared API and synthetic providers:

```sh
npm run web:build
DOMBOT_ACCOUNT_QA=1 npx vitest run src/core/services/accounts.test.ts -t 'browser QA server'
```

Open `http://127.0.0.1:4173`, expand Dynadot, enter a synthetic API key and secret, and Save. Then use Add another account with a different synthetic key. The synthetic key `invalid` exercises the form’s connection-error state. The harness returns one test domain per key and stops after ten minutes. It never calls a registrar. Check both account connection tests, combined Domains/Renewals, account filtering, a row action, and reload. Native desktop verification should use an isolated profile and the same synthetic-provider approach, retaining the real preload, IPC, and OS-encrypted storage.
