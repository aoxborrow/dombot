# Multiple registrar accounts

Settings → Registrars keeps the original one-card-per-registrar flow. Expand a card, enter its credentials, and click **Save**. A single-account registrar has no account selector, label field, or “Default” suffix. Empty registrars have no add-account action.

After the first account is saved with credentials, **Add another account** appears beside Save inside that card. It appends a separate inline credential form below the saved account, with an optional label and Cancel. The saved account’s form, selection, enabled state and sync status stay in place. Cancelling dismisses only the new form. After saving, the original account remains selected; View account explicitly switches to the newly added one. The new connection is validated before persistence, so cancellation and failed validation leave no empty account. Existing account credentials are not changed by an unsaved new-account form.

Only a registrar with multiple saved accounts gains an **Account** selector. It selects the account whose credentials, sync status, Sync button, and enable toggle the card controls. Rename and Remove account are available in this mode. Removing extra accounts returns a single-account registrar to its original presentation while keeping the surviving ID and label in storage.

Domains and Renewals combine enabled accounts. Their Account column/filter appears only if at least one registrar has multiple accounts. Registrars with only one account do not display a redundant default label, including in a mixed portfolio. Exports and MCP retain account identity for reliable routing regardless of which UI fields are visible.

Disabling an account keeps its credentials and cache but removes it from the visible portfolio and future syncs. Enabling syncs it again. A failed sync keeps its last successful domains and timestamp and reports the error on that account. Removing an account clears its credentials, portfolio, and detail cache. It never removes another account's data.

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
