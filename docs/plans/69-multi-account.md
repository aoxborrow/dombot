# Multiple named registrar accounts (#69)

## Account model and compatibility

Each account has a stable ID and an editable label. IDs identify credentials, clients, sync status, portfolio/detail caches, domain targets, folders, and manual prices; labels never route operations.

Existing installations are adopted in place using the registrar's existing key as the default account ID. This preserves encrypted credentials, compatible caches, disabled state, folders and prices without asking users to re-enter keys. New accounts receive UUIDs. Removed IDs are not reused. Credentials remain in the existing encrypted namespace; account metadata lives in `registrar-accounts`.

Updated desktop and web hosts export bundle format 2 and accept formats 1 and 2. Older hosts reject format 2 instead of discarding account metadata. Import validates account/provider mappings before replacing live data.

## Minimal account UI

Keep one original card per registrar and its expand, credentials, Save, Sync and enable controls. Before the first account is saved, there is no add-account action. With one account, do not show a redundant account selector, label field or default suffix.

After credentials are saved, Add another account appends a separate form beneath the existing account. Opening, failing or cancelling that draft leaves the existing form and connected status in place. Successful creation keeps the existing selection and offers View account as an explicit switch. Connection validation precedes persistence; duplicate credentials are rejected.

Only registrars with multiple accounts gain a selector and rename/remove controls. Domains and Renewals expose account-specific UI only when needed. Exports and MCP retain account identity independently of presentation.

## Routing and consistency

Domain operations resolve a unique cached owner or use an explicit account ID. Provider mismatches, cached ownership mismatches, disabled accounts and ambiguous selection fail before provider operations. Registrations and inbound transfers require a destination when multiple configured accounts exist. Legacy unambiguous calls continue to work.

Bulk jobs resolve IDs before starting, persist them, and validate each operation. Old queued targets remain pinned to their original default account. Conservative provider-level throttling is retained.

A failed sync keeps that account's last-good slice and successful timestamp. Generation checks discard stale sync/detail results after credential/state changes or newer syncs. Cached clients check current hydrated credentials. Credential writes serialize per account through persistence and rollback; connection publication serializes per provider and rechecks duplicates after network validation within the service runtime.

## Verification

- Automated coverage: legacy adoption; independent credentials, clients, caches, prices and errors; rename/update/disable/remove; restart; mismatched and ambiguous UI/MCP routing; destination registration/transfer selection; persisted bulk targets; encrypted desktop/web bundle round trips; failed persistence and overlapping requests.
- Browser verification with synthetic providers: zero/one/multiple-account UI; first Save; separate new-account form; invalid credentials and cancellation; successful addition without switching away from the existing account; account filtering and reload.
- Desktop verification with synthetic providers: production renderer/preload, real IPC and filesystem storage, OS-encrypted credentials, two-account portfolio, account-specific changes and process restart.
- User-reported live validation: three Dynadot accounts connected successfully. This is distinct from automated/mock routing coverage; no paid registrar operations are required by the test plan.
- Required checks: unit suite, TypeScript, ESLint, web renderer build, Worker deployment dry run, macOS package.

## Related desktop MCP correction

The stdio bridge handles client pipe closure rather than surfacing an uncaught EPIPE. Tests cover a real SDK transport over an errored Writable, stdin EOF, late replies/errors, rejected sends and normal backpressure. This is a separate desktop transport correction; it does not change account authorization or registrar operations.
