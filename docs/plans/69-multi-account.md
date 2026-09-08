# Multiple named registrar accounts (#69)

One Dombot user can keep multiple credential sets for the same registrar. Account IDs, never labels, identify credentials, clients, portfolio slices, detail records, domain targets, folders and manual prices.

## Compatibility and storage

Each built-in provider has a default account whose stable ID is its existing provider key (e.g. `dynadot`). This is an in-place, read-compatible migration: legacy encrypted credentials, disabled state, cache keys and user annotations need no secret rewrite. Additional accounts use UUIDs. A separate `registrar-accounts` namespace holds provider and editable label; credentials remain in the encrypted `credentials` namespace. Removed default accounts retain a tombstone so they cannot be silently resurrected. New backups use format 2; format 1 imports remain supported. Older clients reject format 2 instead of silently discarding account metadata.

## Routing and concurrency

Optional accountId parameters preserve legacy single-account calls. Explicit account selection must match the provider, enabled/configured state, and any cached ownership evidence. Domain calls may resolve a unique cached owner; ambiguous selections fail before provider calls. Provider-level calls, registrations and inbound transfers require accountId when several configured accounts exist. Bulk targets retain account identity in persisted work and results. Provider-level rate limits remain conservative across accounts. A credential/state/removal change invalidates in-flight sync writes.

## UI

Keep the existing registrar card design; group named account cards under each provider with Add account, editable labels, connection test, sync, enable and remove controls. Domains and Renewals aggregate enabled accounts and offer Account filters. Domain rows and CSV exports include account identity. All row/bulk actions carry IDs.

## Verification

Use mocked provider responses with real storage/services for legacy migration, encrypted round trips, restart, independent clients/caches, failed and concurrent syncs, rename/update/disable/remove isolation, wrong-provider/wrong-owner/ambiguous routing, MCP calls, persisted bulk targets and format 1/2 imports. Run the full unit suite, TypeScript, lint and web/desktop builds. Exercise the shared renderer with synthetic two-account data; no paid registrar operations or real credentials are needed.

## Implementation and verification outcome

Implemented the account model, both transports, settings, domain and renewals filters, exports, and MCP routing on `codex/multi-account-support`. During verification, added current-credential client invalidation across storage hydration, failed-write memory rollback, latest-sync fencing, and import validation for account routing metadata.

Manual web verification used two synthetic Dynadot accounts through the real API table and built renderer: add/save/test/sync, combined portfolio, Account filter, Company-only auto-renew, reload persistence, and Renewals filtering passed, with no browser console errors observed.

Manual macOS verification used the built renderer and preload, real IPC handlers, filesystem storage with OS `safeStorage` encryption, mocked providers, and an isolated `/tmp` profile. Both accounts saved/tested/synced and appeared together; credentials were confirmed sealed on disk. Full process restart restored both accounts and the Company-only auto-renew change. Renewals showed the combined two-account portfolio. No live registrar credentials or paid operations were used.

Final checks: 335 automated tests passed (the opt-in browser harness is skipped in normal test runs); TypeScript, ESLint, web build, and the macOS arm64 package passed. No blocking findings remain in the account routing and migration review.
