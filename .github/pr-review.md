# Review notes for DomBot

Read by Claude review (aoxborrow/skills) from the PR's base branch.

## Where bugs hide here

- **Several runtimes share code.** `src/core` and `src/shared` run in the
  Electron main process, the self-hosted Cloudflare Worker (`src/worker`) and
  the in-browser demo. Node-only APIs, file system access or Electron imports
  there break the Worker or the demo.
- **Writes have real-world effects.** Registrar and market calls renew domains
  (which spends money), change nameservers and DNS, unlock names and send auth
  codes, approve transfers, and list or delist names. Check that each write
  happens only on an explicit user or MCP action, can't fire twice, targets the
  right account and name, and reports partial failure honestly.
- **Credentials.** Registrar and market keys are encrypted at rest
  (`src/core/services/credentials.ts`) and go only to their own API (see
  `SECURITY.md`). They must never reach logs, error text, the renderer beyond
  what it needs, MCP output, CSV exports, or the demo.
- **Data that outlives the app version.** The portfolio cache and storage
  namespaces (`docs/storage-model.md`) and the Worker's D1 migrations
  (`migrations/`) have to keep loading data written by older versions.
- **Money.** Amounts in different currencies must not be summed without
  conversion (`docs/money-format.md`, `docs/exchange-rates.md`); watch
  rounding and missing rates.
- **Sync.** Registrar and market APIs page, rate-limit and time out. A partial
  or failed sync must not wipe cached data or mark names as gone.
- **Web and MCP surface.** The Worker's login and the MCP OAuth flow
  (`src/core/mcp/`) are internet-facing in self-hosted installs; CSV output can
  carry spreadsheet formulas. `security-review/` holds regression tests for past
  issues.

## Ignore

Style, naming and formatting: the linter and typechecker cover those.
