# Domain editing — inline and bulk

A planning doc for making every writeable domain property editable from the
Domains table, one row at a time **and** in bulk across a selection. Today the
table has exactly one write control (the Auto-Renew switch) and one local edit
(the Folder cell); everything else is read-only in the UI even though the MCP
server already exposes the full write surface of `@aoxborrow/registrar-client`.

The goal is one write path shared by three callers — a row control, a bulk job,
and an MCP tool — so the behavior, cache patching, and error handling are
identical no matter who initiated the change.

## Goals

- **Inline edits** in the table for every per-domain setting we can write:
  auto-renew, WHOIS privacy, transfer lock, nameservers, URL forwarding, email
  forwarding, plus two per-domain actions that aren't "settings": renew, and
  fetch the auth (EPP) code.
- **Bulk edits** of the same things over any selection of rows (across pages
  and across registrars), with an up-front eligibility summary, live progress,
  cancellation, and a per-domain results report with retry.
- **One backend path.** A single `applyDomainOp` service that the IPC handler,
  the bulk runner, and the MCP tools all call. No behavior forks.
- **Capability-aware UI.** Controls the registrar can't honor are disabled with
  a reason, not left to fail at click time.
- **Money and security get friction.** Renew (costs money) and unlock (enables
  transfer-out) require an explicit confirmation step; everything else is a
  one-click toggle or a dialog whose Save *is* the confirmation.

## Non-goals (for this cut)

- **DNS records.** The editor + validation surface is large; deferred.
- **Contacts.** Same reason (a four-role contact form). Listed under
  [Future work](#future-work) — bulk contact updates are a real need, but not
  for this round.
- **DNSSEC disable, transfer-in, register.** Not table edits.
- **Undo.** We patch caches on success and report results; reverting is a
  second bulk job the user runs. A one-click "revert succeeded rows" for the
  boolean toggles is cheap and listed as an optional follow-up.
- **Bulk MCP tools.** The runner is designed so an MCP `portfolio_bulk_apply`
  tool is a thin wrapper later, but exposing it is out of scope here.

## What's editable, and where each registrar stands

Read straight from the provider implementations in registrar-client 0.5.0
(`src/registrars/*.ts`). "Core" features are on every provider's `features`
list even when the method throws `NotImplementedError`, so the library's
capability list alone is **not** enough to gate the UI — the "known gaps" column
has to live in dombot (see [Capability gating](#capability-gating)).

| Registrar  | Auto-renew | Privacy | Lock | Nameservers | Renew | URL fwd | Email fwd | Auth code |
| ---------- | :--------: | :-----: | :--: | :---------: | :---: | :-----: | :-------: | :-------: |
| Cloudflare | ✗¹ | ✓ | ✗¹ | ✗¹ | ✗¹ | ✓ | ✓ | ✗ |
| Dynadot    | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Gandi      | ✓ | ✓² | ✓ | ✓ | ✓ | ✓³ | ✓ | ✓ |
| GoDaddy    | ✓ | off only⁴ | ✓ | ✓ | ✓ | ✗⁵ | ✗ | ✓ |
| NameBright | ✓ | ✓ | ✓ | ✓⁶ | ✓⁶ | ✗ | ✗ | ✓ |
| Namecheap  | ✓ | ✓¹² | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| NameSilo   | ✓ | ✓ | ✓ | ✓ | ✓ | ✓⁷ | ✓⁸ | ✗⁹ |
| Porkbun    | ✓ | ✗¹⁰ | ✗¹⁰ | ✓ | ✓¹¹ | ✓ | ✗ | ✗ |
| Spaceship  | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |

1. Cloudflare's Registrar API has no post-registration update endpoint for
   these; the provider rejects with `NotImplementedError`.
2. Disabling privacy is a silent no-op for individual registrants (Gandi keeps
   GDPR obfuscation on). The call "succeeds" but nothing changes.
3. Gandi forwards subdomains only — an apex (`@`) host is rejected.
4. Enabling privacy is a paid purchase (`NotImplementedError`); disabling works
   for paid DBP but returns `success: false` for free DBP.
5. GoDaddy forwarding needs `customerId` + an sso-key, which the app no longer
   collects (PAT-only since #48). Treat as unsupported in dombot.
6. Built from the documented endpoints but not live-verified in the library.
7. Single apex (`@`) forward only; setting an empty list restores default NS.
8. Up to five `forwardTo` destinations per alias.
9. NameSilo emails the code to the registrant; the API never returns it.
10. Lock is read-only via the API; privacy is set only at registration.
11. Rate-limited to one attempt per 10 s and 50 successes per day; always the
    registry-minimum term; premium renewals unsupported via API.
12. Toggles the domain's WhoisGuard subscription; a domain without one throws
    (surfaces as `failed`, not `unsupported`).

Two local-only edits ride along because they belong in the same bulk menu:
**Assign to folder** and **Hide** (assign to the built-in Hidden folder). They
touch no registrar and need no job — a synchronous loop over the selection.

## Design decisions

### One operation model, three callers

Introduce a discriminated `DomainOp` union in `src/shared/ipc.ts` and a single
`applyDomainOp(target, op, opts)` in a new `src/main/services/domain-ops.ts`.
It dispatches to the existing `*Cached` functions in `services/registrars.ts`
(`setAutoRenewCached`, `setLockCached`, `setPrivacyCached`,
`setNameserversCached`, `renewDomainCached`) and adds the three ops that have
no service function yet (URL forwarding, email forwarding, auth code). Every
caller — the new `domain:apply` IPC handler, the bulk runner, and the
`domain_*` MCP tools — goes through it, so:

- cache patching (`patchDomainInCaches`) and the `portfolioChanged` broadcast
  happen in exactly one place;
- errors are classified once (`unsupported` / `rate-limited` / `failed`);
- a future MCP bulk tool is `applyDomainOp` in a loop, nothing more.

The MCP tools for forwarding currently call `getRegistrarClient(r).set…`
directly; they move onto `applyDomainOp` as part of this work. No tool renames.

### Bulk runs in main, not in the renderer

A bulk edit is a **job** owned by the main process: the renderer sends the op
plus a list of targets once, main runs it, and streams progress back over an
event channel. Reasons:

- **Rate limits are per registrar.** Main can run one worker lane per
  registrar with a per-registrar concurrency and minimum spacing (see
  [Concurrency policy](#concurrency-policy)), which a renderer loop of
  `invoke` calls can't coordinate with MCP traffic hitting the same client.
- **Cancellation** is a real abort: the lane stops picking up work and the
  in-flight request gets an `AbortSignal` (registrar-client's `RequestOptions`
  already takes one).
- **Survives navigation.** Switching to Renewals and back re-attaches to the
  running job instead of losing it.
- **MCP reuse.** The runner is caller-agnostic.

The job lives in main memory only. There's one job at a time (the bar's
actions are disabled while one runs). On `before-quit` the job is aborted; what
already completed at the registrars stays done. Results aren't persisted —
the Done panel offers "Export results CSV" for a record.

### Optimistic for toggles, pessimistic for everything else

- **Auto-renew, privacy, lock** flip the cell immediately (the existing
  `setAutoRenew` store pattern: write to `enriched`, mark `mutating[key]`,
  roll back on error). Cheap, idempotent, and the registrar round trip is
  usually sub-second.
- **Nameservers, forwarding, renew** show a pending state and only update on
  the registrar's success result. These carry payloads, aren't cheaply
  reversible, and in the renew case the cache patch depends on a re-fetched
  expiry.
- **Bulk** is always pessimistic per item: each success patches the caches in
  main and the progress event carries the patch so the row updates as its item
  completes — the table visibly changes row by row during a job.

### Friction proportional to risk

| Action | Inline | Bulk |
| --- | --- | --- |
| Auto-renew on/off, lock | one click, no confirm | dialog Start is the confirm |
| **Privacy on/off** | inline confirm popover on the cell (off exposes WHOIS; on can be a purchase) | dialog Start is the confirm |
| **Unlock** | inline confirm popover on the cell | dialog with an explicit "enables transfer-out" warning |
| Nameservers | popover editor; Save is the confirm | dialog shows the set + "replaces on N domains" |
| URL / email forwarding | dialog; loads current rules; Save warns if it removes any | dialog warns full-replace; option to skip domains that already have rules |
| Auth code | no confirm (read); shown masked with reveal/copy | results table; export warns it's a secret |
| **Renew** | dialog with years, price estimate, new expiry; typed confirmation | same plus total cost across the selection; typed confirmation; lanes forced to 1; **no automatic retries** |

Renew is the only op that must never be retried blind: a timed-out request may
have gone through, and a retry would renew twice. Pass `{ retries: 0 }` in the
`RequestOptions` for renew, and never offer "Retry failed" for renew results
without the user re-confirming cost.

### Capability gating

Extend `RegistrarMeta` (already loaded into the store as `registrars`) with the
library's `features` list, and add a small dombot-owned map of **known core
gaps** — the cases where a core method throws `NotImplementedError` or is
conditionally unusable:

```ts
// src/shared/domain-ops.ts (pure; imported by main AND renderer)
const KNOWN_GAPS: Partial<Record<RegistrarName, (op: DomainOp) => string | null>> = {
  cloudflare: (op) =>
    ['autoRenew', 'lock', 'nameservers', 'renew'].includes(op.kind)
      ? 'Cloudflare’s API has no post-registration update for this; use the dashboard.'
      : null,
  porkbun: (op) =>
    op.kind === 'lock' || op.kind === 'privacy'
      ? 'Porkbun’s API can’t change this after registration.'
      : null,
  godaddy: (op) =>
    op.kind === 'privacy' && op.enabled
      ? 'Enabling privacy at GoDaddy is a purchase; only disabling is supported.'
      : op.kind === 'urlForwarding'
        ? 'GoDaddy forwarding needs a customer ID the app no longer collects.'
        : null,
};

/** null when supported; otherwise the human reason it isn't. */
export function unsupportedReason(
  registrar: RegistrarName,
  features: readonly string[],
  op: DomainOp,
): string | null;
```

`unsupportedReason` first checks the extended-feature requirement (auth code →
`getAuthCode`, forwarding → `set…Forwarding`), then the gap map. The renderer
uses it to disable cells and to bucket a bulk selection; main uses it to
pre-mark bulk items `unsupported` without a network call. It gets unit tests.

At runtime a `NotImplementedError` we didn't predict is also classified
`unsupported` — the map is a UX nicety, not the source of truth.

### Auth codes are secrets

Never written to the caches or any file by dombot. Fetched live on demand, held
in renderer state for the life of the dialog, shown masked with a reveal toggle
and a copy button. The bulk variant shows a results table (domain → code) with
copy-all and a CSV export whose confirm says plainly that the file contains
transfer secrets. Locked domains still return a code at most registrars; the
dialog notes that the domain must be unlocked before a transfer will go
through, and offers nothing automatic.

### Forwarding isn't cached — and stays that way for now

URL and email forwarding aren't in `Domain`, so they'd need one extra request
per domain to display as columns. They stay behind a per-row dialog that loads
the current rules live when opened. The bulk variant can't preview each domain's
existing rules cheaply; instead it offers a checkbox "Skip domains that already
have rules (one read per domain)" — the job does the GET first and marks the
domain `skipped` if non-empty. Default on, because `set…Forwarding` is a full
replace.

## Data model

Additions to `src/shared/ipc.ts`:

```ts
import type { EmailForward } from '@aoxborrow/registrar-client';

/** A domain-scoped write (or secret read) — the unit shared by inline edits,
 *  bulk jobs, and the MCP tools. */
export type DomainOp =
  | { kind: 'autoRenew'; enabled: boolean }
  | { kind: 'privacy'; enabled: boolean }
  | { kind: 'lock'; locked: boolean }
  | { kind: 'nameservers'; nameservers: string[] }
  | { kind: 'urlForwarding'; forwards: UrlForwardInput[]; skipIfExisting?: boolean }
  | { kind: 'emailForwarding'; forwards: EmailForward[]; skipIfExisting?: boolean }
  | { kind: 'authCode' }
  | { kind: 'renew'; years: number };

export type DomainOpKind = DomainOp['kind'];

/** `masked` is read-only in the library; the UI can only write these two. */
export interface UrlForwardInput {
  host: string;                       // "@" | "www" | subdomain
  url: string;
  type: 'temporary' | 'permanent';
}

export interface DomainTarget {
  registrar: RegistrarName;
  domainName: string;
}

export type DomainOpStatus =
  | 'ok'
  | 'failed'        // registrar said no (message has why)
  | 'unsupported'   // registrar can't do this op (gated up front or NotImplementedError)
  | 'skipped'       // already in the target state / had existing rules
  | 'rate-limited'  // RateLimitError after the client's own retries
  | 'cancelled';

export interface DomainOpResult {
  target: DomainTarget;
  status: DomainOpStatus;
  message: string;
  /** Fields the caller can overlay on the row (autoRenew/privacy/locked/
   *  nameservers, or expirationDate/renewalDate/status after a renew). */
  patch?: Partial<Domain>;
  /** Op-specific payload: the auth code. Never persisted. */
  data?: { authCode?: string };
}

export interface BulkJob {
  id: string;
  op: DomainOp;
  status: 'running' | 'done' | 'cancelled';
  total: number;
  /** Results so far, in completion order. `done === results.length`. */
  results: DomainOpResult[];
  counts: Record<DomainOpStatus, number>;
  startedAt: number;
  finishedAt: number | null;
}

/** Streamed to windows as items complete. */
export interface BulkProgress {
  jobId: string;
  result: DomainOpResult;
  done: number;
  total: number;
}
```

`RegistrarMeta` gains:

```ts
/** The library's capability list (`Feature` ids) for gating controls. */
features: string[];
```

`IpcChannels` gains `applyDomainOp`, `bulkStart`, `bulkCancel`, `bulkGet`;
`IpcEvents` gains `bulkProgress` and `bulkFinished`. `DombotApi` gains:

```ts
applyDomainOp: (target: DomainTarget, op: DomainOp) => Promise<DomainOpResult>;
startBulk: (targets: DomainTarget[], op: DomainOp) => Promise<BulkJob>;
cancelBulk: (jobId: string) => Promise<void>;
/** The current/last job, for re-attaching after navigation. */
getBulkJob: () => Promise<BulkJob | null>;
onBulkProgress: (cb: (p: BulkProgress) => void) => () => void;
onBulkFinished: (cb: (job: BulkJob) => void) => () => void;
```

## Backend

### `services/domain-ops.ts` — the dispatcher

```ts
export async function applyDomainOp(
  target: DomainTarget,
  op: DomainOp,
  opts: { signal?: AbortSignal } = {},
): Promise<DomainOpResult>
```

1. **Pre-check.** `unsupportedReason(registrar, features, op)` → return
   `unsupported` without touching the network.
2. **Dispatch** by `op.kind`:
   - `autoRenew` / `privacy` / `lock` / `nameservers` → the existing `*Cached`
     function. `success: false` from the provider → `failed` with its message.
   - `renew` → `renewDomainCached(name, domain, years, { retries: 0, signal })`
     (extend it to pass `RequestOptions` through). The re-fetched
     expiry/renewal/status becomes `patch`.
   - `urlForwarding` / `emailForwarding` → if `skipIfExisting`, `get…` first
     and return `skipped` when non-empty; then `set…Forwarding`. No cache
     patch (not a cached field), but still broadcast so nothing diverges from
     the other writes.
   - `authCode` → `client.provider.getAuthCode(domain)` (the facade doesn't
     re-expose it; same reach-through the MCP tool uses). Result in `data`.
3. **Classify errors.** `NotImplementedError` → `unsupported`;
   `RateLimitError` → `rate-limited`; `AbortError` → `cancelled`; anything
   else → `failed` with the message.
4. **Broadcast** `portfolioChanged` on success for the inline and MCP paths.
   The bulk runner suppresses the per-item broadcast and relies on progress
   events instead (each carries the `patch`), then broadcasts once at the end.

`renewDomainCached` and friends keep returning the raw `OperationResult` for
the MCP tools' benefit; the tools' `cachedWrite` helper becomes a call to
`applyDomainOp` that serializes the `DomainOpResult`.

### `services/bulk-jobs.ts` — the runner

- `startBulk(targets, op): BulkJob` — refuses if a job is running. Groups
  targets by registrar, creates one **lane** per registrar, and starts them in
  parallel. Each lane runs `concurrency` workers that pull from that
  registrar's queue with `minSpacingMs` between request starts (a shared
  per-lane timestamp, not per worker).
- Each item: `applyDomainOp(target, op, { signal })`, then push the result,
  bump `counts`, and `broadcastBulkProgress(...)`.
- **Rate-limit backoff.** The HTTP client already honors `Retry-After` inside
  its retry loop; if a `rate-limited` result still comes out, the lane pauses
  for `retryAfter ?? 30s` before its next item rather than burning the rest of
  the queue.
- `cancelBulk(id)` aborts the shared `AbortController`; queued items are
  recorded `cancelled` immediately so the count reconciles; in-flight requests
  end via the signal.
- On completion: `status: 'done' | 'cancelled'`, `finishedAt`, one
  `portfolioChanged` broadcast (so the MCP-side `applyPortfolioCacheUpdate`
  path and any second window reconcile), one `bulkFinished` event.
- `getBulkJob()` returns the current or last job.

### Concurrency policy

Starting points from the library's registrar notes; tune against real accounts.

| Registrar  | Lanes | Min spacing | Notes |
| ---------- | :---: | ----------: | --- |
| Dynadot    | 1 | 1000 ms | Regular tier is 1 thread / 60 req-min |
| Porkbun    | 1 | 1000 ms | **renew: 10 000 ms** (1 attempt / 10 s) |
| NameBright | 1 | 1000 ms | ~30 req / 30 s |
| Spaceship  | 1 | 2000 ms | some endpoints 5 req / window |
| Namecheap  | 2 | 1200 ms | ~50 req / min |
| GoDaddy    | 2 | 2500 ms | ~600 req / 23 min |
| Gandi, Cloudflare, NameSilo | 2 | 500 ms | no published limits |
| _default_  | 2 | 500 ms | |
| _any registrar, `renew`_ | 1 | ≥ 2000 ms | money; serialize |

Lives in `bulk-jobs.ts` as a `LANE_POLICY` map keyed by registrar with an
optional per-`kind` override.

### IPC

`src/main/ipc/domains.ts` (new module, registered in `ipc/index.ts`):
`applyDomainOp`, `bulkStart`, `bulkCancel`, `bulkGet`. Thin handlers, as the
existing ones. The old `registrar:setAutoRenew` channel is removed outright —
the store was its only caller and now uses the generic `applyDomainOp`.

`src/main/events.ts` gains `broadcastBulkProgress` / `broadcastBulkFinished`.

### MCP

- `domain_set_autorenew`, `domain_set_lock`, `domain_set_privacy`,
  `domain_nameservers_set`, `domain_renew`, `domain_url_forwarding_set`,
  `domain_email_forwarding_set`, `domain_auth_code_get` → call `applyDomainOp`.
  Output shape unchanged for the `_set` tools (they return the provider's
  `OperationResult` today; keep `{ success, message }` and add `status`).
- A **bulk tool is future work**, but the shape is obvious:
  `portfolio_bulk_apply({ op, targets })` → `startBulk` and poll, or run
  synchronously with a cap. Left out of this cut deliberately.

## Renderer

### Store additions (`store/app.ts`)

- `applyDomainOp(target, op, { optimistic?: Partial<Domain> })` — generic
  replacement for `setAutoRenew`: applies `optimistic` to `enriched` if given,
  sets `mutating[key]`, calls the IPC, overlays `result.patch` on success,
  rolls back on non-`ok`, clears `mutating`. Returns the `DomainOpResult`.
- `selected: Set<string>` and `toggleSelected` / `selectMany` /
  `clearSelection` move from page state into the store so the selection
  survives tab switches. Pruned on every portfolio replace (Sync, registrar
  disable) so keys that vanished don't linger.
- `bulk: BulkJob | null` + `startBulk` / `cancelBulk` / `attachBulk`.
  `attachBulk` (called on Domains mount) does `getBulkJob()` and subscribes
  to progress; each progress event overlays `result.patch` on `enriched` and
  appends the result. Rows that belong to a running job read as `mutating` so
  their inline controls disable.
- `registrars` already carries the metadata; `features` arrives for free.

### Table changes (`pages/Domains.tsx`)

1. **Flip `BULK_SELECT_ENABLED` on** and delete the constant. The checkbox
   column and the header tri-state checkbox already select the *filtered* set
   across pages, which is the right semantics.
2. **Privacy / Locked cells become toggles.** `StateIcon` gets an `onToggle`
   and a `pending` prop and renders as an icon button. Disabled (with the
   unsupported reason as the tooltip) when `unsupportedReason(...)` is
   non-null. Unlock opens a small `Popover` on the cell: "Unlock example.com?
   This allows it to be transferred away." with Unlock / Cancel.
3. **Nameservers cell becomes an editor trigger.** Clicking opens a `Popover`
   with the `NameserversEditor` (below), pre-filled. Save runs the op
   pessimistically; the cell shows a spinner in place of the +N badge.
4. **Row actions menu.** A trailing `⋯` cell (`DropdownMenu`) with:
   *Set nameservers…*, *URL forwarding…*, *Email forwarding…*, *Get auth
   code…*, *Renew…*, a separator, *Assign to folder ▸*, *Hide*. Items the
   registrar can't do are disabled with the reason. Cheap to add and it's the
   only sane home for actions that aren't a column.
5. **Bulk bar** (the existing stub, made real): "N selected · across K
   registrars", Clear, and a *Bulk actions* menu. See below.
6. **Disable Sync while a job runs** (`SyncControl` reads `bulk?.status`). A
   sync mid-job would race the per-item cache patches for no benefit.

### Shared confirmations (`components/`)

- `ConfirmPopover` — the in-place "are you sure?" anchored to a cell (unlock,
  privacy either way, future cell edits). Title, body, action label,
  destructive variant; owns its open state.
- `ConfirmDialog` — the modal counterpart: title, description, caller content,
  optional type-to-confirm word, Cancel + action footer, `busy` lock. Renew
  uses it; the bulk dialog's confirm stage reuses it.

### Shared editors (`components/domains/`)

- `NameserversEditor` — one textarea, one host per line (paste-friendly),
  live validation: trims, lowercases, strips trailing dots, dedupes; hostname
  regex; 2–13 entries (1 allowed with a warning — some registrars accept it).
  A *Presets* select lists the distinct nameserver sets already in the
  portfolio (top 8 by domain count, labelled by `nameserverGroup`) plus the
  last three sets the user saved (persisted in `AppSettings.recentNameservers`).
  Used by the inline popover and the bulk dialog.
- `UrlForwardingEditor` — a list of `{ host, url, type }` rows; host is a
  select of `@` / `www` / custom; URL must parse as http(s). Shows registrar
  caveats inline when the target registrar is known (Gandi: no apex; NameSilo:
  apex only, one rule). In bulk mode the URL accepts a `{domain}` token
  (e.g. `https://landing.example/?d={domain}`), expanded per target.
- `EmailForwardingEditor` — rows of `{ alias, forwardTo }`; alias `@`/`*` for
  catch-all; forwardTo must be an email. NameSilo's five-destination cap noted.
- `AuthCodeDialog` — fetches on open; masked value, reveal, copy; error state.
- `RenewDialog` — years (1–10), estimated cost from the pricing map × years
  with source shown, current → estimated new expiry, a typed `RENEW`
  confirmation. Porkbun note: term is fixed to the registry minimum.
- `BulkActionDialog` — the three-stage container every bulk op uses:
  1. **Configure.** The op's editor (or nothing for the toggles) and an
     **eligibility summary** computed locally from the selection:
     *42 will change · 5 already on (skipped) · 3 unsupported at Cloudflare*
     with an expandable list per bucket. "Already in state" uses the merged
     row; for registrars whose list endpoint omits privacy/lock, un-enriched
     rows are treated as eligible (the registrar's own response decides).
     Renew shows the summed estimate and the typed confirmation here.
  2. **Running.** Progress bar, `done/total`, a live list (most recent first)
     with status chips, Cancel. Closing the dialog doesn't stop the job; the
     bar shows a compact progress pill with *View*.
  3. **Done.** Counts by status, the failures list with messages, **Retry
     failed** (re-opens Configure with only the failed targets; disabled for
     renew), **Export results CSV**, Close.
- `BulkBar` — the selection summary plus the actions menu:

  ```
  Assign to folder ▸      (local)
  Hide                    (local)
  ─────────────
  Auto-renew ▸ On / Off
  Privacy ▸ On / Off
  Lock ▸ Lock / Unlock
  Set nameservers…
  URL forwarding…
  Email forwarding…
  ─────────────
  Get auth codes…
  Renew…
  ─────────────
  Export selected CSV     (reuses domainsToCsv on the selection)
  ```

  Every registrar-backed item is disabled when the job slot is busy. Items
  where *no* selected domain is eligible are disabled with the reason.

### Pure helpers (`lib/domain-ops.ts`, tested)

- `bucketSelection(domains, op, registrars)` → `{ eligible, skipped,
  unsupported }` with reasons, for the eligibility summary and the target list.
- `validateNameservers(text)` → `{ nameservers, errors, warnings }`.
- `validateUrlForwards`, `validateEmailForwards` (shape + registrar caveats).
- `expandTemplate(url, domainName)` for the `{domain}` token.
- `resultsToCsv(job)` for the Done export (and the auth-code export).

## Per-action specs

Each entry: inline behavior · bulk behavior · backend · cache effect · caveats.

**Auto-renew** — already a switch; migrate to `applyDomainOp` with an
optimistic patch. Bulk: On / Off; skip rows already in state. Backend
`setAutoRenewCached`. Cache: `autoRenew`. Caveats: Cloudflare unsupported.

**Privacy** — icon button; confirms in a popover either way, then optimistic. Bulk: On / Off. Backend
`setPrivacyCached`. Cache: `privacy`. Caveats: Porkbun unsupported; GoDaddy
on → unsupported, off → may return a soft failure for free DBP (surfaces as
`failed` with GoDaddy's message); Gandi off → no-op for individuals (we can't
detect this; note it in the dialog when Gandi rows are present).

**Lock** — icon button; lock is immediate, unlock confirms in a popover.
Bulk: Lock / Unlock, unlock carries a warning. Backend `setLockCached`. Cache:
`locked`. Caveats: Cloudflare and Porkbun unsupported.

**Nameservers** — popover editor, pessimistic. Bulk: the same editor applied
to every eligible row; the Configure step previews the set and the count.
Backend `setNameserversCached`. Cache: `nameservers` (which also re-buckets
the Nameservers filter live). Caveats: Cloudflare unsupported; NameBright
unverified in the library (say so in the dialog).

**URL forwarding** — dialog loads current rules live (`getDomainForwarding`),
shows read-only `masked` rules as un-editable with a note that saving drops
them, editor, Save = `setDomainForwarding` full replace. Bulk: editor with the
`{domain}` token and *skip if existing* (default on). No cache field.
Caveats: Gandi no apex; NameSilo apex-only single rule; GoDaddy, NameBright,
Spaceship unsupported.

**Email forwarding** — same shape as URL forwarding with `EmailForwardingEditor`
and `setEmailForwarding`. Caveats: NameSilo ≤ 5 destinations; GoDaddy,
NameBright, Porkbun, Spaceship unsupported.

**Auth code** — dialog, live fetch, masked/reveal/copy, never stored. Bulk:
results table with copy-all and a CSV export behind a "contains transfer
secrets" confirm. Backend `provider.getAuthCode`. Caveats: only Dynadot, Gandi,
GoDaddy, NameBright, Spaceship; the dialog reminds that a locked domain must be
unlocked before transfer.

**Renew** — dialog with years, estimate, new expiry, typed confirmation.
Bulk: same with the summed estimate; lanes forced to 1; `retries: 0`; no Retry
failed. Backend `renewDomainCached` (extended to take `RequestOptions`).
Cache: `expirationDate` / `renewalDate` / `status` from the post-renew
re-fetch. Caveats: Cloudflare unsupported; Porkbun 1 / 10 s and registry-min
term; NameBright unverified. The estimate is dombot's pricing (manual → quote
→ base), clearly labelled an estimate — the registrar charges what it charges.

**Assign to folder / Hide** — local; loop `assignFolder` over the selection;
toast with the count. No job, no dialog (folder picker is the existing menu).

## Edge cases

- **Mixed registrars in one selection.** Normal. Lanes run per registrar; the
  eligibility summary buckets by reason, so the user sees "3 unsupported at
  Cloudflare" before starting, not after.
- **Row edited by two writers.** Inline controls are disabled for rows in a
  running job (`mutating`). An MCP write during a job lands via
  `portfolioChanged` → `applyPortfolioCacheUpdate`, which overlays the cache
  on `enriched`; the job's own patches are already in the cache, so nothing
  is lost.
- **Un-enriched rows.** Privacy/lock may read `false` from a summary-only list.
  Bulk treats those rows as eligible; the registrar's response is the truth,
  and a no-op write is harmless for idempotent ops.
- **Job while Sync would run.** Sync button disabled during a job; the
  background auto-sync (`services/auto-sync.ts`) skips a tick while a job is
  running (one flag check).
- **App quit mid-job.** `before-quit` aborts the job. Completed items are
  done at the registrar and already in the cache. Add a confirm dialog only if
  this proves painful in practice.
- **Soft failures.** A provider returning `success: false` is `failed` with
  its message; the row is not patched.
- **Rate limits.** The client retries with `Retry-After`; if it still
  surfaces, the lane pauses and the item is `rate-limited` — Retry failed
  picks those up.
- **Masked forwards.** Displayed read-only; a save that would drop one asks
  once.
- **Selection after a job.** Kept, so the user can immediately run a second
  op on the same rows. Clear is one click.
- **Hidden domains.** A selection made with the Hidden filter active includes
  hidden rows; nothing special.

## Implementation phases

Each phase is a PR: `npm run typecheck`, `npm run lint`, `npm test` clean.

1. ✅ **Shared model + dispatcher.** `DomainOp` types, `shared/domain-ops.ts`
   with `unsupportedReason` + tests, `services/domain-ops.ts`,
   `RegistrarMeta.features`, `domain:apply` IPC, store `applyDomainOp`.
   Migrate the Auto-Renew switch and the MCP `_set` tools onto it. No visible
   change except MCP results gaining `status`.
2. ✅ **Inline toggles + row menu.** Privacy and Lock toggles (with the unlock
   popover), the `⋯` row menu with *Get auth code…*, *Renew…*, and *Hide*
   (`AuthCodeDialog`, `RenewDialog`).
3. ✅ **Nameservers.** `NameserversEditor` + `validateNameservers` tests, the
   cell popover, `recentNameservers` setting.
4. ✅ **Forwarding dialogs.** `UrlForwardingEditor`, `EmailForwardingEditor`,
   the two per-row dialogs, `applyDomainOp` support for `skipIfExisting`.
5. **Bulk runner.** `services/bulk-jobs.ts`, lane policy, IPC + events,
   store `bulk` slice, selection moved into the store, `BulkBar`,
   `BulkActionDialog` with the toggles, folder assign, hide, export selected.
   Sync disabled during jobs.
6. **Bulk payload ops.** Nameservers, URL/email forwarding (with the
   `{domain}` token and skip-if-existing), auth codes (results table +
   export), renew (cost summary, typed confirm, lane = 1, no retries).
7. **Polish.** Progress pill when the dialog is closed, Retry failed, results
   CSV, docs/README/site copy for "bulk editing".

## Testing

- **Unit (vitest):** `unsupportedReason` over the full matrix above;
  `bucketSelection`; the three validators; `expandTemplate`; `resultsToCsv`;
  the lane scheduler with a fake `applyDomainOp` (spacing, concurrency, cancel
  mid-queue, rate-limit pause).
- **Manual, per registrar sandbox** (Dynadot, Gandi, Namecheap, NameSilo,
  Porkbun, GoDaddy OTE have sandboxes): each op inline and in a 3-row bulk with
  one unsupported row mixed in. Renew only where the sandbox is free.
- **Live spot-checks** on a throwaway domain for the registrars without a
  sandbox (Cloudflare, NameBright, Spaceship), reads and toggles only.

## Future work

- **Bulk MCP tool** (`portfolio_bulk_apply`) over the same runner.
- **Contacts** — bulk registrant/admin/tech updates are the most-requested
  thing not in this cut; needs the contact form and per-registrar rules.
- **DNS records** — the editor deferred here.
- **Revert** for boolean toggles from the Done panel (inverse op on the
  succeeded rows).
- **Folder-cascading settings** (`FolderSettings.autoRenew`,
  `nameserverProfile`) — the folders doc anticipated these; a bulk op is now
  the mechanism to apply them.
- **Cache forwarding rules** in the detail record so they can become filter
  facets and columns.
- **DNSSEC disable** as a bulk op (Dynadot, Gandi, NameSilo, Porkbun support
  it).
