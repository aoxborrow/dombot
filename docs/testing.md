# Testing — logic-layer coverage plan

A planning doc for expanding automated test coverage of DomBot's **pure logic
and main-process backend** — deliberately excluding React components, DOM-bound
hooks, and anything needing jsdom/RTL. The renderer's `lib/` helpers are already
well covered; the biggest gap is the backend (the shared write dispatcher, the
bulk-job runner, and the MCP server), which today has **no tests at all**.

The goal is to lock down the behavior contracts that everything else depends on
— the single `applyDomainOp` write funnel, the bulk runner's status/progress
accounting, the MCP query engine, and the MCP tool helpers — using fake
registrar and Electron boundaries so tests run fast and offline.

## Goals

- **Cover the backend write path.** `applyDomainOp` is the one funnel every
  write goes through (row control, bulk job, MCP tool); its status/patch/error
  contract is the highest-leverage thing to pin.
- **Cover the bulk runner.** Progress accounting, cancellation, partial
  failures, rate-limit pauses, per-registrar lanes.
- **Cover the MCP logic.** The pure query engine and the tool-layer helpers
  (registrar resolution, result shaping, input-schema validation).
- **Fill the pure-logic gaps.** Renewals math, CSV export, and the untested
  branches of `lib/bulk`.
- **Pin the security invariant.** Auth (EPP) codes are returned but never
  cached or persisted.

## Non-goals (for this cut)

- **No component or hook tests.** No jsdom, no React Testing Library. Anything
  that requires rendering is out of scope here.
- **No transport/OAuth tests.** `mcp/oauth.ts`, `mcp/server.ts`, and the
  `mcp/stdio*.ts` plumbing are deferred.
- **No full `services/registrars.ts` coverage yet.** It requires the heaviest
  mock stack (registrar-client + Electron + cache + `node:dns`); deferred to a
  later pass.
- **No coverage-number chasing.** Trivial data/formatting helpers
  (`lib/folders`, `lib/time`, `lib/utils`, `shared/registrar-help`) are skipped
  unless a coverage gate later demands them.

## Toolchain

Already sufficient — **nothing new to install**:

- `vitest.config.ts` runs `environment: 'node'` and includes
  `src/**/*.{test,spec}.{ts,tsx}`, so backend tests under `src/main/**`
  colocated as `*.test.ts` are picked up automatically. The `@` → `src/renderer`
  alias is configured.
- `package.json`: `test` = `vitest run`, `test:watch` = `vitest`. Vitest
  `^3.2.7` supports `vi.mock`, `vi.useFakeTimers`, and
  `vi.advanceTimersByTimeAsync` out of the box.
- The one **new convention** these tests introduce is mocking — every existing
  test is mock-free. Keep `vi.mock(...)` at module scope and reset with
  `vi.clearAllMocks()` in `beforeEach`.
- **Watch out:** any module that transitively imports `electron` fails to
  resolve under `node`. The mocking seams below (mock `./registrars`,
  `./domain-ops`, `../events`, and `electron` for pricing) keep Electron out of
  every test. `mcp/portfolio-query.ts` and the `lib/` modules have no such
  dependency and need no mocks.

## Conventions to match

From the existing tests (`src/renderer/lib/*.test.ts`, `src/shared/*.test.ts`):

- Explicit `import { describe, it, expect } from 'vitest'` — globals are off.
  Add `vi` to that import in the mocking tests.
- Colocated `*.test.ts` beside the module under test.
- Small local factory helpers (e.g. `bulk.test.ts`'s `domain(partial)` and
  `meta(name, features)`). Extract a shared `Domain` factory for the new
  backend / renewals / csv tests.
- `satisfies`-typed fixtures, `toEqual` for structures, `toMatch(/…/)` for
  human-facing messages.

## Mocking strategy

Two clean seams, both via `vi.mock`, keep Electron out entirely:

1. **For `applyDomainOp` (`services/domain-ops.ts`) and `mcp/tools.ts`** —
   `vi.mock('../services/registrars')` (or `./registrars`) exposing fake
   `getRegistrarFeatures`, `getRegistrarClient`, `findRegistrarsForDomain`, and
   the `*Cached` writers as `vi.fn()`s returning canned `OperationResult`s.
   `vi.mock('../events')` to spy on `broadcastPortfolioChanged`. Import the
   **real** `NotImplementedError` / `RateLimitError` / `AbortError` /
   `OperationResult` from `@aoxborrow/registrar-client` (plain classes, no
   Electron) and have the fakes `throw` them to drive error classification. For
   `authCode` / forwarding, the fake `getRegistrarClient` returns an object with
   `provider.getAuthCode`, `getDomainForwarding`/`setDomainForwarding`,
   `getEmailForwarding`/`setEmailForwarding` as `vi.fn()`s.

2. **For the bulk runner (`services/bulk-jobs.ts`)** —
   `vi.mock('./domain-ops')` so `applyDomainOp` is a `vi.fn()` scripted per
   target (resolve after a delay, return `rate-limited` / `cancelled`, etc.),
   plus `vi.mock('../events')`. Use `vi.useFakeTimers()` +
   `await vi.advanceTimersByTimeAsync(...)` to make spacing and rate-limit
   pauses deterministic. Optionally add one thin integration test that lets the
   **real** `applyDomainOp` run against the mocked `./registrars` to prove the
   funnel end-to-end.

For `services/pricing.ts`, also `vi.mock('electron')` (`app.getPath`) and either
`node:fs` or `./base-pricing` to control the overrides file.

## Priorities

### Tier 1 — highest leverage, do first

**1. `services/domain-ops.ts` — `applyDomainOp`** (the single write funnel)
- Up-front unsupported gate: a gated op returns `status: 'unsupported'` and
  makes **no** call into the `*Cached`/client mocks.
- Happy path per op kind: `autoRenew` / `privacy` / `lock` / `nameservers`
  return `status: 'ok'` with the correct `patch` (`{autoRenew}`, `{privacy}`,
  `{locked}`, `{nameservers}`); `broadcastPortfolioChanged` fires when not
  `silent`.
- `silent: true` suppresses the broadcast (the bulk path); default fires it
  exactly once on `ok`.
- Soft failure (`OperationResult.success === false`) → `status: 'failed'` with
  the provider's message, **no patch**.
- Empty provider message falls back to `opSummary(op)` on success and
  `` `${opSummary} failed` `` on soft failure.
- Error classification: `NotImplementedError → 'unsupported'`,
  `RateLimitError → 'rate-limited'`, `AbortError → 'cancelled'`, else
  `'failed'`; `messageOf` extracts `.message`.
- `renew` passes `{ retries: 0 }` to `renewDomainCached` (money op, no blind
  retry) and returns its `patch`.
- `urlForwarding` / `emailForwarding` `skipIfExisting`: when rules exist →
  `status: 'skipped'` with a count-aware message and the setter is **not**
  called; when none exist → setter called and, for bulk, `{domain}` **expanded
  per target** (assert the expanded URL / forwardTo).
- **`authCode` — security invariant:** returns `status: 'ok'` with
  `data.authCode` set, `patch` is `undefined`, and **none** of the
  cache-patching mocks are called.

**2. `mcp/tools.ts` — helpers + schemas** (shares Tier 1 #1's mocks)
- `resolveRegistrar(domain, registrar?)`:
  - explicit `registrar` → returned verbatim, no lookup;
  - one cache match → that registrar;
  - zero matches → throws the "isn't in the cached portfolio… pass registrar /
    run portfolio_sync" error;
  - multiple matches → throws the "appears under multiple registrars… pass
    registrar to disambiguate" error.

  Mock only `findRegistrarsForDomain`; assert return values **and** the exact
  guidance messages.
- `json(data)` → pins the `{content:[{type:'text', text: JSON.stringify(...)}]}`
  shape.
- `domainOp()` maps `applyDomainOp`'s result to
  `{success: status==='ok', status, message}` — assert `ok → success:true` and
  every non-ok status → `success:false` with status preserved.
- `cachedWrite()` broadcasts only on `result.success`; returns the raw
  `OperationResult`.
- Zod input schemas (`.safeParse`, no mocks): `registerInput` requires
  `registrant`; `transferInput` requires `authCode`; `domainForward.type`
  rejects `'masked'`; `contact` required vs. optional fields; `dnsRecord` int
  fields.

**3. `mcp/portfolio-query.ts` — `queryPortfolio`** (pure, no mocking)
- Each filter in isolation and ANDed: `registrar`, `tld` (normalizes
  `com` / `.com` / `example.com`), `nameContains`, `nameserverContains`,
  `autoRenew` / `locked` / `privacy`, `status` substring,
  `expiresBefore` / `expiresAfter` / `expiringWithinDays` (nulls excluded,
  invalid dates ignored).
- Folder resolution: by id, case-insensitive name, `"Hidden"` /
  `HIDDEN_FOLDER_ID`, unknown name → zero rows.
- Sorting: default `expirationDate asc`, `desc`, string fields
  case-insensitive, **nulls always last** regardless of direction.
- Paging: `offset` / `limit`, default `DEFAULT_LIMIT`, `total` reflects
  pre-paging count.
- Row shape: drops `syncedAt` / `deleted`, adds resolved `folder` name.
- Staleness: `isStaleAt(null) === true`, and a `fetchedAt` past
  `STALE_AFTER_MS`.
- Edge cases: empty portfolio, offset beyond length.

**4. `services/bulk-jobs.ts` — the job runner** (fake timers)
- Progress accounting: final `counts` sums correctly across all six statuses,
  `results.length === total`, `broadcastBulkProgress` fires once per item with a
  monotonic `done`.
- `startBulk` guards: throws on a second concurrent job, throws on empty
  `targets`; returns an immediate `status: 'running'` snapshot with zeroed
  counts and a real `id`.
- Terminal state: `status` → `'done'` normally, `'cancelled'` on abort;
  `finishedAt` set; `broadcastBulkFinished` fires once;
  `broadcastPortfolioChanged` fires only when `counts.ok > 0`.
- Partial failures: a mix of ok / failed / unsupported / skipped all recorded
  and counted; job still completes `'done'`.
- Cancellation: `cancelBulk()` mid-run records remaining targets as
  `'cancelled'` **without** calling `applyDomainOp` for them (assert call count
  < total).
- Rate-limit pause: a `'rate-limited'` result pauses the lane; with fake timers,
  the next item in that lane starts only after `RATE_LIMIT_PAUSE_MS`.
- Per-registrar lanes / spacing: targets across registrars run in parallel
  lanes; a serialized registrar (e.g. `dynadot`) spaces starts by `policyFor`;
  `renew` uses the widened spacing (10 s Porkbun, 2 s otherwise).
- Snapshot isolation: `getBulkJob()` returns a clone-safe copy.

### Tier 2 — solid value, low effort (all pure)

**5. `renderer/lib/renewals.ts`** — `summarize` (priced/unpriced/base/manual
counts, `yearly`, `yearlyAutoRenew`, `avgPerDomain`, empty input); `groupBy`
(grouping, summed yearly, sort by spend desc then count); `upcomingByMonth`
(continuous month strip incl. empty buckets, past-due folded into current month,
beyond-window skipped, null/invalid dates skipped); `dueWithin` (cutoff
boundary, unpriced counted but not summed).

**6. `renderer/lib/csv.ts`** — column order + header row; `isoDate` / `daysUntil`
blank for null/invalid dates; `Yes`/`No` booleans; nameservers joined with
`; `; folder name resolution incl. `HIDDEN_FOLDER_ID → "Hidden"` and missing
folder → blank; RFC-4180 quoting (`csvField`) for commas/quotes/newlines; CRLF
joins.

**7. `renderer/lib/bulk.ts` — gap-fill** — `isRiskyOp` (unlock / privacy-off /
renew), `isRetryable` (failed/rate-limited/cancelled true; ok/skipped/
unsupported false), `hasAuthCodes`, `flagOf`/`flagOp`/`flagTarget` round-trips,
`resultsCsvFilename` (hyphenated, dated, from `OP_LABEL`), and `resultsToCsv`
**with the auth-code column** (the `withCodes` branch, currently untested).

**8. `services/pricing.ts`** — `usesPerNameQuote` (pure: gandi/dynadot on
premium TLDs → true; on `com`/`net`/etc → false; other registrars → false);
`resolvePricing` three-layer precedence (manual override > synced per-name
quote > base per-TLD > unavailable), each stamping the right `source`;
`setManualPrice` set-then-clear (null/NaN deletes the key). Needs `electron` +
`fs`/`base-pricing` mocks.

### Tier 3 — lower value / higher effort

**9. `services/registrars.ts`** — cache patching, `findRegistrarsForDomain`,
`getMergedPortfolio`, and especially `syncRegistrarInto`'s last-good-on-error
semantics. Requires the full registrar-client + Electron + cache + `node:dns`
mock stack.

**10.** `renderer/lib/folders.ts`, `time.ts`, `utils.ts`,
`shared/registrar-help.ts` — trivial data/formatting; skip unless chasing
coverage numbers.

## Auth-code non-persistence invariant

Worth an explicit, dedicated test since it's security-relevant. In
`domain-ops.ts` the `authCode` branch returns `{ data: { authCode } }` and calls
**no** `*Cached` writer (unlike every other op). Assert:

- `applyDomainOp(target, {kind:'authCode'})` returns `data.authCode`; `patch` is
  `undefined`.
- **None** of the cache-patching mocks (`setAutoRenewCached`,
  `patchDomainInCaches`, …) were called for an authCode op.
- In `lib/bulk.ts`, `resultsToCsv` only adds the auth-code column when
  `hasAuthCodes(job)`; the code lives only on the in-memory
  `DomainOpResult.data`, never written to a cache namespace (the
  `DomainOpResult.data` JSDoc — "Never persisted by main" — is the contract).

## Status

**Tier 1 complete** (2026-09-06) — 131 tests total, up from 50:

- `src/main/services/domain-ops.test.ts` — 24 tests (gate, patches, silent,
  soft failures, error classification, renew, forwarding skip/templating,
  auth-code non-persistence).
- `src/main/mcp/tools.test.ts` — 14 tests (json shape, `resolveRegistrar` four
  branches, `domainOp`/`cachedWrite` mapping, input-schema validation) via a
  fake `McpServer` that captures the registered handlers.
- `src/main/mcp/portfolio-query.test.ts` — 30 tests (every filter, folder
  resolution, sorting/nulls-last, paging, staleness, edge cases).
- `src/main/services/bulk-jobs.test.ts` — 13 tests (guards, progress
  accounting, mixed statuses, portfolioChanged gating, cancellation, rate-limit
  pause, lane spacing, snapshot isolation) using `vi.useFakeTimers()`.

Tier 2 and Tier 3 not started. Tick items off as their test files land.
