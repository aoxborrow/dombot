# Remote sync (push / pull with a hosted DomBot)

Status: design / research (2026-09-17). Not yet implemented.

## Goal

Let any DomBot instance move its entire dataset to and from another self-hosted
DomBot instance, so a user can keep a laptop and a hosted instance (or two hosted
instances) in step without re-entering registrar keys. Two explicit, one-shot
actions:

- **Push** — overwrite the remote's data with this instance's data.
- **Pull** — overwrite this instance's data with the remote's data.

There is no merge and no continuous/background sync. Each button is a wholesale,
last-write-wins replacement in one direction, run when the user asks.

### Non-goals

- No field-level merge, no conflict resolution, no three-way diff.
- No automatic/scheduled sync (could come later; out of scope here).
- No multi-user or per-record sharing. It is one operator's instances kept in
  step ("my laptop ↔ my server", or "my server ↔ my other server").

## What travels

The payload is the existing **data bundle** — the same v3 JSON that
`exportData` / `importData` already produce and consume
(`src/core/storage/bundle.ts`). It is a snapshot of every registered namespace
except `auth` and `meta` (`NEVER_EXPORTED`, `bundle.ts`), which means it already
carries:

- `registrar-accounts`, `credentials` (API keys), `proxies` (incl. URL
  passwords)
- `folders`, `pricing-overrides`, `tld-rates`, `registrar-state`, `settings`,
  `mcp`
- **`cache-portfolio`, `cache-detail`** — the portfolio/detail cache

Because the bundle is namespace-general, **any future namespace travels
automatically** — no change to the sync mechanism when we add data. In
particular, manually-added domains will sync for free.

> **Modeling note for the future manual-domains feature.** Manually-added
> domains are authoritative user data, not regenerable cache. If they are stored
> in `cache-portfolio` they will be destroyed by *Clear cache*
> (`clearAllCaches` iterates `CACHE_NAMESPACES`, `src/core/services/cache.ts`).
> Give them their own namespace (e.g. `manual-domains`), alongside `folders` and
> `pricing-overrides`. They then survive a cache clear *and* sync automatically.

Import semantics are already wholesale-replace: a namespace present in the
bundle is cleared and rewritten; a registered namespace *absent* from the bundle
is emptied (`importNamespaces`, `src/core/storage/namespace.ts`). So Pull makes
the local store an exact mirror of the remote, and Push makes the remote an
exact mirror of local — which is exactly the desired overwrite-both-ways
behavior. `importBundle` also re-derives registrar clients, restarts auto-sync,
and broadcasts portfolio/approval changes, so the receiving side is consistent
after the call returns (`bundle.ts`).

## Topologies — who can sync to whom

The **remote (target)** must be a reachable HTTPS server, which only a **web
instance** is. A desktop app has no public URL, so it is always the *local*
side, never a target. Supported directions:

- **desktop → web** ✅ — the laptop case.
- **web A → web B** ✅ — sync between two hosted instances.
- **anything → desktop** ❌ — a desktop is not a server, so it can never be the
  remote end of a Push or Pull.

The critical design point is **where the outbound call runs**, because it
decides whether web-to-web is even possible:

- Run it in the **browser** (renderer JS fetching the target directly) → blocked
  by **CORS**. The target Worker sends no `Access-Control-Allow-Origin`, so the
  browser rejects the response *even though* our bearer exemption satisfies the
  target's server-side `sameOrigin` check.
- Run it in the **host** (desktop main process, or the initiating instance's
  Worker) → **no CORS** — it is a server-to-server request, exactly like the
  desktop case.

So push/pull is implemented as a **host-side core API method**, not
browser-side and not a desktop-only IPC method (see *Implementation surface*).
One implementation serves both hosts: on desktop it runs in the main process; on
web the browser calls its own instance's `/api/syncPush|syncPull` and the
**Worker** makes the outbound call to the target. Web-to-web then works with no
CORS handling on either side, and the Remote sync panel appears on **both** the
desktop and web builds.

**Do not hold the store lock across the outbound fetch.** On the web host, every
`/api/:method` runs under `withRequestLock` with a hydrate/flush around it
(`src/worker/index.ts`). If a sync handler ran the whole operation inside that
lock, the initiating instance would be **stalled for the entire network round
trip**, and — worse — pointing the remote URL at the instance's **own origin**
(or any URL that lands on the same isolate, e.g. `wrangler dev`) would
**deadlock**: the outbound `/api` call needs the lock the initiator is still
holding. So the sync handler must take the store lock **only around the local
export/import step**, never across the outbound HTTP calls:

- **Push**: take the lock → `exportBundle` a snapshot → release → `POST` it to
  the remote.
- **Pull**: `GET` the remote bundle (no lock) → take the lock → `importBundle`.

This likely means the web sync handler is a **dedicated route that opts out of
the standard locked `/api` dispatch**, rather than a plain locked core method.
Additionally, **reject a remote URL equal to the instance's own origin** up
front — self-sync is meaningless and is the obvious deadlock trigger.

## Authentication

The web instance authenticates with a **password** (`DOMBOT_PASSWORD` secret),
and its session token is a signed, HMAC-backed value minted from
`DOMBOT_SECRET` + password (`src/worker/auth.ts`). Reuse that token type — do
**not** invent a new secret or derive a token client-side. But the *existing*
login route cannot be reused as-is, and the reason drives the design.

### Why not the existing `/auth/login`

`/auth/login` is guarded by the same `sameOrigin` CSRF check as `/api/*`
(`src/worker/index.ts`), and `sameOrigin` returns `false` when there is no
`Origin`/`Referer` header matching the target (`src/worker/auth.ts`). A desktop
HTTP client has no such origin, so it is rejected **before** any token is
issued — the bearer flow could never even start. So the token step needs its
own door. (We must not simply relax `sameOrigin` on `/auth/login`: that route
*sets a cookie*, and dropping its CSRF check would open real login-CSRF against
browsers.)

### Server change: a body-token endpoint + bearer on `/api`

Two additions, both narrow:

1. **New `POST /auth/token`** (password mode only). Accepts `{ password }`,
   verifies it with the same constant-time check as login, and returns the
   minted token **in the JSON body** — it sets **no cookie**. Because it sets no
   ambient credential and an attacker page cannot read a cross-origin JSON
   response, it is safe to **exempt from `sameOrigin`**; the password in the body
   is the authorization. Rate-limit it with the same mechanism as login but a
   **separate bucket** (distinct key prefix), **not** the login bucket. Because
   this route is `sameOrigin`-exempt, a cross-origin page can reach it; if it
   shared the login limiter it could burn a visitor's 10-attempts/15-min budget
   and lock that IP out of `/auth/login` (a CSRF-driven login lockout — note
   `/auth/login` only charges the limiter *after* its `sameOrigin` check, so it
   is not itself reachable this way). A separate bucket confines any such abuse
   to the sync path. Optionally also require a non-simple request (e.g. a custom
   header) so browsers must preflight it, blocking simple cross-origin form
   POSTs outright.
2. **Bearer acceptance on `/api/:method`.** In `isAuthenticated` (password
   mode), also accept a valid token from `Authorization: Bearer <token>`
   (`verifySession` on the header). In the `/api` gate, **skip `sameOrigin` when
   the request authenticated via bearer** — a bearer token can't be sent
   ambiently by a browser, so CSRF doesn't apply. Cookie-authenticated requests
   keep the same-origin check unchanged.

Flow: desktop `POST {remoteUrl}/auth/token {password}` → gets token → calls
`{remoteUrl}/api/exportData|importData` with `Authorization: Bearer <token>`.

Why this token rather than "token = the password": it is **server-minted** and
HMAC-signed (can't be forged offline), it **expires** (30-day TTL) and is
**invalidated by a password change** for free, and the raw password crosses the
wire only on the one `/auth/token` call.

This is additive and does not touch the existing browser/cookie path.

### Supported auth modes

Only **`password` mode** supports built-in remote sync, because only it has a
DomBot credential the desktop can present:

- **`cloudflare-access`** — no DomBot login; requires a valid
  `Cf-Access-Jwt-Assertion`. Out of scope for v1; a desktop client would need
  its own CF Access service-token flow.
- **`external`** — `isAuthenticated` always returns `true`, but there is no
  token to mint and `/api/*` still enforces `sameOrigin`, so a desktop client is
  still `403`ed and no bearer exists to trigger the exemption. Also unsupported
  in v1. (Supporting it would mean satisfying whatever upstream proxy fronts the
  instance, which is outside DomBot's control.)

The client detects the mode via `GET /auth/status` and disables Push/Pull with
an explanation when the mode is not `password`.

## Wire security

The bundle crosses the wire **in plaintext at the application layer**, protected
by **TLS only**. This is deliberate and sufficient:

- The receiving instance must read the data to use it (call registrar APIs,
  render the portfolio, serve MCP). It cannot operate on ciphertext it cannot
  open, so end-to-end encryption is fundamentally incompatible with the feature.
- Password-encrypting the bundle adds no real security here: the password
  already gates both endpoints, so encrypting with a key derived from that same
  secret protects against no one who is not already authorized. TLS already
  covers the eavesdropper. And the Worker cannot open a passphrase-sealed bundle
  anyway — `bundle-seal.ts` uses 600k-iteration PBKDF2 specifically because it
  is client-only and exceeds the Workers CPU budget.
- Passphrase sealing (`src/shared/bundle-seal.ts`) remains valuable for the
  **file** export/import path, where a bundle sits at rest in an untrusted place
  with no TLS. That is a different threat model and stays as-is.

Requirements that follow:

- The sync client **must require `https://`** for the remote URL and refuse
  plain HTTP (reject the URL at input, and reject a response that arrived over
  HTTP). This holds for both hosts, including the web build's Worker-side call.
- Secrets at rest are unchanged: the remote re-encrypts on import via its own
  D1/AES-GCM layer; the desktop re-encrypts via OS keychain. Only the transient
  in-flight bundle is plaintext-over-TLS.

### Deliberately *not* guarding outbound targets (no SSRF allowlist)

When the web build initiates a sync, its Worker fetches a user-supplied URL —
an SSRF-shaped surface. We **intentionally do not** add private/link-local/
metadata-IP blocking. The reasoning: the caller is already authenticated to
*their own* instance, and anyone who can reach this panel can already
`exportData` and download the entire dataset outright — so pointing the egress
at an internal address grants no capability they lack. Adding an IP allowlist
would be friction (it would also break syncing to a remote on a private LAN)
for no real gain. The only requirement on the target is **HTTPS**. (Recorded
explicitly so this is understood as a decision, not an oversight.)

## UX

A new **Remote sync** card in the existing **Sync** settings tab
(`src/renderer/pages/settings/DataSettings.tsx`, which renders under the tab
labeled "Sync" in `src/renderer/pages/Settings.tsx`). It appears on **both the
desktop and web builds** — the same renderer serves both, and the outbound call
runs host-side either way (see *Topologies*). Fields and controls:

- **Remote URL** — text input, `https://…`, e.g. `https://aox.dombot.ai`.
  Validated for https; trimmed; no trailing path required.
- **Password** — password input. The remote instance's login password. It is
  **never stored** — it is used once to fetch a token and then discarded (see
  *Secret model*). The field is shown only when a sync needs a token (no cached
  token, or it expired); when a valid cached token exists, Push/Pull run without
  prompting. No "remember password" option.
- **Pull** button — "Replace all data here with the remote's."
- **Push** button — "Replace all data on the remote with this instance's."
- **Status line** — last successful push/pull time; on load, a lightweight
  `GET {remoteUrl}/auth/status` to show reachability and detected auth mode
  (and to warn early if the instance is not in `password` mode).

Both buttons open a **confirmation dialog** first, because both are irreversible
wholesale overwrites:

- Pull: "This replaces everything here — accounts, keys, folders, prices, cached
  domains — with the copy on {host}. Continue?"
- Push: "This replaces everything on {host} with this instance's data.
  Continue?"

### Secret model: never store the password, cache the token

The password is **never persisted**. The user types it only when a sync needs a
token, it is exchanged for a bearer token at `POST {remoteUrl}/auth/token`, and
it is **discarded from memory immediately** after. What gets cached is the
**token** (30-day TTL), so routine syncs run without re-prompting; the password
is asked for again only when there is no cached token or the cached one is
expired/rejected.

This is strictly better than storing the password: the token **self-expires**
and is **invalidated by a password change** server-side, and the reusable
password — which the user may share with other logins — never sits at rest.

The cached token is still a **full-access bearer credential**, so it is treated
as a secret at rest, and its storage must **not** live in the `settings`
namespace (which travels in the bundle — a Pull would clobber it). Store it in a
dedicated host-local `remote-sync` namespace holding `remoteSyncUrl` (non-
secret) and the `token` + its expiry. That namespace:

- is added to `NEVER_EXPORTED` (`src/core/storage/bundle.ts`) so it never
  crosses the wire in either direction, and
- must be **sealed at rest**. The desktop `EncryptedDocStore` seals **only**
  `credentials` and `proxies` today (`src/electron/storage/index.ts`), so
  `remote-sync` **must be added to that sealed set** or the token would be
  written as plaintext JSON under `userData`. On web this is automatic — the
  Worker seals every namespace via its AES-GCM/D1 layer.

(If we ever want to avoid persisting even the token, the same flow works with no
cache — the user simply enters the password on every sync. The 30-day token
cache is purely a convenience layer on top.)

## Implementation surface

Receiver side (worker) — what a *target* instance needs:

- `src/worker/index.ts` — add `POST /auth/token` (password mode, `sameOrigin`-
  exempt, returns the token in the body, rate-limited on a **separate bucket**
  from `/auth/login`, see *Authentication*); skip `sameOrigin` for bearer-
  authenticated `/api` requests.
- `src/worker/auth.ts` — bearer-token acceptance in `isAuthenticated` (password
  mode).

Initiator side — the sync logic runs **host-side** (desktop main process, or the
initiating instance's Worker), which is what makes web-to-web work without CORS
(see *Topologies*):

- Sync handler, `(remoteUrl, password?)` — `password` is passed only when the
  renderer had to prompt for one:
  - Reject `remoteUrl` that is not `https://`, or that equals this instance's
    own origin (self-sync / deadlock guard).
  - **Token:** use the cached, unexpired token for `remoteUrl` if present.
    Otherwise require `password`, `POST {remoteUrl}/auth/token` to mint one,
    cache it (30-day TTL), and **discard the password**. Never persist the
    password.
  - **Pull**: `GET`/`POST {remoteUrl}/api/exportData` (no local lock held) →
    take the store lock → local `importBundle(text)` → release.
  - **Push**: take the store lock → local `exportBundle(...)` → release → `POST
    {remoteUrl}/api/importData` with `{ args: [text] }`.
  - All target calls carry `Authorization: Bearer <token>`. Reuses the existing
    bundle machinery unchanged.
  - On a `401` from `/api/*` (token expired/revoked mid-flight), clear the
    cached token and surface "session expired — re-enter password" so the
    renderer can re-prompt and retry once.
- **Locking (web host).** Do **not** run this as a plain locked core method:
  `/api/:method` holds `withRequestLock` for the whole call, which would stall
  the instance for the network round trip and deadlock a same-origin/`wrangler
  dev` target (see *Topologies*). Implement it as a **dedicated worker route**
  that acquires the store lock only around the local export/import step, outside
  the outbound fetch. On desktop there is no isolate lock, but keep the same
  export-snapshot-then-send / fetch-then-import shape.
- **Wiring.** Expose `syncPush` / `syncPull` to the renderer the usual way —
  `src/shared/ipc.ts` (`DombotApi` + `IpcChannels`), `src/preload.ts` (Electron
  IPC → main process), `src/renderer/api/http.ts` for the web build (pointing at
  the dedicated route rather than the generic `/api/<name>` dispatch), and the
  caller in `DataSettings.tsx`.
- A host-local `remote-sync` namespace — **sealed at rest on both hosts** (add
  it to the desktop `EncryptedDocStore` seal set; already sealed on web) and
  added to `NEVER_EXPORTED` — holding `remoteSyncUrl` and the cached `token` +
  expiry. **No password is stored** (see *Secret model*).

UI:

- The Remote sync card described above in `DataSettings.tsx` (shown on both
  builds).

## Failure modes & edge cases

- **Unreachable / wrong URL / non-HTTPS** — validate up front; surface a clear
  error, do nothing.
- **Wrong password / rate-limited** — `/auth/token` returns 401 / 429 (its own
  rate-limit bucket, 10 / 15 min). Surface plainly; do not retry silently.
- **Expired / revoked cached token** — a cached token past its 30-day TTL, or
  rejected with `401` mid-sync (e.g. the remote's password was rotated), is
  cleared; the UI re-prompts for the password and retries once. No stored
  password to fall back on, by design.
- **Auth mode mismatch** — if `/auth/status` reports a non-`password` mode,
  disable Push/Pull with an explanation. Both `cloudflare-access` and
  `external` are unsupported in v1 (see *Supported auth modes*): neither yields
  a token the initiator can present, and `external` still fails the `/api`
  `sameOrigin` check. (This gates the *target's* mode; the initiating build may
  be desktop or web.)
- **Version skew** — a bundle from a newer DomBot with an unknown namespace is
  skipped on import (`importNamespaces`); an older instance that predates v3
  refuses the bundle (`parseBundle`). Show the refusal message.
- **Partial failure on Push** — the remote's `importBundle` is wholesale and
  flushes before returning; there is no half-applied state visible to future
  reads, but a dropped connection mid-request is possible. Treat Push as
  all-or-nothing from the client's view and re-run on failure.
- **Size** — bundles are capped at 32 MiB (`MAX_BUNDLE_BYTES`); a few hundred
  domains is far under that.

## Open questions

1. ~~Remember the password?~~ **Decided: never store the password.** Prompt only
   when a token is needed, cache the 30-day token, discard the password (see
   *Secret model*).
2. Show a diff/summary before overwriting (counts of accounts, domains) so the
   user sees what they are about to replace? Nice-to-have, not required for v1.
3. ~~Desktop-only or web-to-web?~~ **Decided: web-to-web is in.** Push/pull is
   a host-side core method and the panel ships on both builds; a web instance
   can initiate against another (see *Topologies*). No outbound-target IP
   guarding — HTTPS is the only requirement (see *Deliberately not guarding
   outbound targets*).
