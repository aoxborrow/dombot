# Domain editing — inline and bulk

How DomBot changes a domain at its registrar, from a row of the Domains table,
from a bulk job over a selection, or from an MCP tool. All three go through
one write path, so the behavior, cache patching, and error handling are the
same whoever started the change.

The editable settings are auto-renew, WHOIS privacy, transfer lock,
nameservers, URL forwarding and email forwarding, plus two actions that
aren't settings: renew, and fetch the auth (EPP) code. Folders, notes and
prices are local edits and touch no registrar.

## What each registrar supports

From the provider implementations in `@aoxborrow/registrar-client`. "Core"
features are on every provider's `features` list even when the method throws
`NotImplementedError`, so the library's capability list alone isn't enough to
gate the UI; DomBot keeps the known gaps itself (see
[Capability gating](#capability-gating)).

| Registrar  | Auto-renew |  Privacy  | Lock | Nameservers | Renew | URL fwd | Email fwd | Auth code |
| ---------- | :--------: | :-------: | :--: | :---------: | :---: | :-----: | :-------: | :-------: |
| Cloudflare |     ✗¹     |     ✓     |  ✗¹  |     ✗¹      |  ✗¹   |    ✓    |     ✓     |     ✗     |
| Dynadot    |     ✓      |     ✓     |  ✓   |      ✓      |   ✓   |    ✓    |     ✓     |     ✓     |
| Gandi      |     ✓      |    ✓²     |  ✓   |      ✓      |   ✓   |   ✓³    |     ✓     |     ✓     |
| GoDaddy    |     ✓      | off only⁴ |  ✓   |      ✓      |   ✓   |   ✗⁵    |     ✗     |     ✓     |
| NameBright |     ✓      |     ✓     |  ✓   |     ✓⁶      |  ✓⁶   |    ✗    |     ✗     |     ✓     |
| Namecheap  |     ✓      |    ✓¹²    |  ✓   |      ✓      |   ✓   |    ✓    |     ✓     |     ✗     |
| Name.com   |     ✓      |     ✓     |  ✓   |      ✓      |   ✓   |    ✗    |     ✗     |     ✓     |
| NameSilo   |     ✓      |     ✓     |  ✓   |      ✓      |   ✓   |   ✓⁷    |    ✓⁸     |    ✗⁹     |
| Porkbun    |     ✓      |    ✗¹⁰    | ✗¹⁰  |      ✓      |  ✓¹¹  |    ✓    |     ✗     |     ✗     |
| Spaceship  |     ✓      |     ✓     |  ✓   |      ✓      |   ✓   |    ✗    |     ✗     |     ✓     |

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

## How a write runs

### One operation model, three callers

`DomainOp` (`src/shared/ipc.ts`) is a discriminated union of the ops above.
`applyDomainOp(target, op, opts)` (`src/core/services/domain-ops.ts`)
dispatches each to the registrar through the cached service functions in
`src/core/services/registrars.ts`. The row controls (through the API), the
bulk runner (`src/core/services/bulk-jobs.ts`) and the `domain_*` MCP tools
all call it, so:

- cache patching and the `portfolioChanged` broadcast happen in one place;
- errors are classified once: `unsupported`, `rate-limited`, `failed`,
  `cancelled`, or `unknown` when a write's outcome can't be confirmed (see
  the [retry standard](web-deployment.md#retry-standard));
- a target names its account (`accountId`), resolved before the write.

### Bulk jobs

A bulk edit is a persisted job: the op plus a list of targets, advanced in
steps with one lane per registrar (see [Concurrency policy](#concurrency-policy)).
Each item calls `applyDomainOp`, and its result carries the patch so the row
updates as the item completes. One job runs at a time, the Sync button and
auto-sync wait while it runs, and Cancel stops lanes from picking up more
work. The Done step shows counts by status, the failures, Retry failed (not
for renew), and Export results CSV. How the two hosts drive the steps is in
[web-deployment.md](web-deployment.md#long-running-work).

### Optimistic for toggles, pessimistic for everything else

- **Auto-renew, privacy, lock** flip the cell immediately and roll back on
  error. Cheap, idempotent, and usually sub-second.
- **Nameservers, forwarding, renew** show a pending state and only update on
  the registrar's success. These carry payloads, aren't cheaply reversible,
  and a renewal's patch depends on a re-fetched expiry.
- **Bulk** is always pessimistic per item.

## Friction proportional to risk

| Action                  | Inline                                                                       | Bulk                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Auto-renew on/off, lock | one click, no confirm                                                        | dialog Start is the confirm                                                                                |
| **Privacy on/off**      | inline confirm popover on the cell (off exposes WHOIS; on can be a purchase) | dialog Start is the confirm                                                                                |
| **Unlock**              | inline confirm popover on the cell                                           | dialog with an explicit "enables transfer-out" warning                                                     |
| Nameservers             | popover editor; Save is the confirm                                          | dialog shows the set + "replaces on N domains"                                                             |
| URL / email forwarding  | dialog; loads current rules; Save warns if it removes any                    | dialog warns full-replace; option to skip domains that already have rules                                  |
| Auth code               | no confirm (read); shown masked with reveal/copy                             | results table; export warns it's a secret                                                                  |
| **Renew**               | dialog with years, price estimate, new expiry; typed confirmation            | same plus total cost across the selection; typed confirmation; lanes forced to 1; **no automatic retries** |

Renew is never retried blind: a timed-out renewal may have gone through. The
library never resends a write whose outcome is unknown, DomBot re-reads the
domain to settle it, and Retry failed is never offered for renew.

## Capability gating

`RegistrarMeta.features` carries the library's capability list, and a small
DomBot-owned map holds the **known core gaps**: cases where a core method
throws `NotImplementedError` or is conditionally unusable.

```ts
// src/shared/domain-ops.ts (pure; imported by core and the renderer), abridged
const KNOWN_GAPS: Partial<
  Record<RegistrarName, (op: DomainOp) => string | null>
> = {
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
uses it to disable controls (with the reason as the tooltip) and to bucket a
bulk selection; the bulk runner uses it to mark items `unsupported` without a
network call. A `NotImplementedError` the map didn't predict is still
classified `unsupported` at run time: the map is a UX nicety, not the source
of truth.

## Auth codes are secrets

Never written to the caches or any file by DomBot. Fetched live on demand,
held in renderer state for the life of the dialog, shown masked with a reveal
toggle and a copy button. A bulk job keeps them in memory only; its stored
copy is redacted. The bulk results table offers copy-all and a CSV export
whose confirmation says plainly that the file contains transfer secrets.
Locked domains still return a code at most registrars; the dialog notes that
the domain must be unlocked before a transfer will go through.

## Forwarding isn't cached

URL and email forwarding aren't in `Domain`, so showing them as columns would
cost one extra request per domain. They stay behind a per-row dialog that
loads the current rules live. `set…Forwarding` is a full replace, so the bulk
variant offers "Skip domains that already have rules" (on by default): the
job reads first and marks a domain `skipped` if it has rules. In bulk, a URL
can contain a `{domain}` token, expanded per target.

## Concurrency policy

Starting points from the library's registrar notes; tune against real
accounts. `LANE_POLICY` in `bulk-jobs.ts`.

| Registrar                | Lanes | Min spacing | Notes                                   |
| ------------------------ | :---: | ----------: | --------------------------------------- |
| Dynadot                  |   1   |     1000 ms | Regular tier is 1 thread / 60 req-min   |
| Porkbun                  |   1   |     1000 ms | **renew: 10 000 ms** (1 attempt / 10 s) |
| NameBright               |   1   |     1000 ms | ~30 req / 30 s                          |
| Spaceship                |   1   |     2000 ms | some endpoints 5 req / window           |
| Namecheap                |   2   |     1200 ms | ~50 req / min                           |
| GoDaddy                  |   2   |     2500 ms | ~600 req / 23 min                       |
| _default_                |   2   |      500 ms | no published limits                     |
| _any registrar, `renew`_ |   1   |   ≥ 2000 ms | money; serialize                        |

The library honors `Retry-After` on a 429. If an item still comes back
`rate-limited`, its lane pauses for 30 s before the next item rather than
burning the rest of the queue.

## Edge cases

- **Mixed registrars in one selection.** Normal. Lanes run per registrar, and
  the eligibility summary buckets by reason, so "3 unsupported at Cloudflare"
  shows before starting, not after.
- **Row edited by two writers.** Inline controls are disabled for rows in a
  running job. An MCP write during a job lands through `portfolioChanged`,
  and the job's own patches are already in the cache, so nothing is lost.
- **Un-enriched rows.** Privacy and lock may read `false` from a summary-only
  list. Bulk treats those rows as eligible; the registrar's response is the
  truth, and a no-op write is harmless for idempotent ops.
- **App quit mid-job.** Completed items are done at the registrar and already
  in the cache. On the next desktop launch the job is closed out, not
  resumed: items that never ran are marked interrupted.
- **Soft failures.** A provider returning `success: false` is `failed` with
  its message; the row is not patched. GoDaddy's privacy-off for free DBP and
  Namecheap's privacy without WhoisGuard surface this way.
- **Gandi privacy off** is a silent no-op for individual registrants; DomBot
  can't detect it.
- **Masked forwards** are shown read-only; a save that would drop one asks
  first.
- **Selection after a job** is kept, so a second op can run on the same rows.
- **Hidden domains.** A selection made with the Hidden filter active includes
  hidden rows; nothing special.

## Future work

- **Contacts** editing, single and bulk
  ([#146](https://github.com/aoxborrow/dombot/issues/146)).
- **DNS record editor**
  ([#147](https://github.com/aoxborrow/dombot/issues/147)).
- **Bulk-edit follow-ups:** reverting toggles from the Done step, bulk
  DNSSEC off, and caching forwarding rules so they can be columns and filters
  ([#150](https://github.com/aoxborrow/dombot/issues/150)).
- **Folder follow-ups,** including per-folder settings that cascade to their
  names ([#152](https://github.com/aoxborrow/dombot/issues/152)).
- **A bulk MCP tool** over the same runner
  ([#111](https://github.com/aoxborrow/dombot/issues/111)).
