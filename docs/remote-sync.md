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

- **Push**: hydrate → take the lock → `exportBundle` a snapshot → release →
  `POST` it to the remote.
- **Pull**: `GET` the remote bundle (no lock) → take the lock → `importBundle` →
  `flushWrites` → release.

This means the web sync handler is a **dedicated route that opts out of the
standard locked `/api` dispatch** — but it must still keep that dispatch's
**hydrate-before / flush-after** lifecycle (see *Implementation surface*);
dropping it would export an empty bundle on a cold isolate or fail to persist a
Pull. Additionally, **reject a remote URL equal to the instance's own origin**
up front — self-sync is meaningless and is the obvious deadlock trigger.

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

Why mint a token at all rather than authenticate each `/api` call with the
password directly: it reuses the receiver's existing session/bearer machinery
unchanged, and keeps the raw password to a single `/auth/token` call instead of
sending it on every request. The token is used only for this one sync and then
discarded (see *Secret model*), so its 30-day TTL is irrelevant here — it never
outlives the operation.

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
- **Do not follow redirects on the outbound sync/token calls.** `fetch` follows
  redirects by default, and a `307`/`308` **re-sends the method and body** to the
  new location — so a malicious or compromised remote could redirect
  `POST /auth/token` to capture the **cleartext password**, or redirect
  `POST /api/importData` (Push) to capture the **entire bundle (every registrar
  API key and proxy password)**; a `https→http` redirect would also silently
  downgrade the transport. Use `redirect: 'manual'` (as
  `src/core/services/proxy-transport.ts` already does) and treat any redirect —
  certainly any cross-origin or scheme-downgrading one — as an error. Without
  this, redirect-following defeats the HTTPS requirement above.
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

### Trust model — a Pull imports fully-trusted state

`importBundle` replaces the local store wholesale, including **proxy profiles**
and **MCP pairings**. So a Pull grants the remote **complete control of local
state**: a malicious remote could plant a proxy profile that routes your future
registrar API calls through an attacker-controlled proxy (MITM of registrar
credentials), or plant MCP OAuth pairings. TLS plus the user typing the URL is
the *only* authenticity guarantee — bundles are not signed. This is inherent to
"Pull overwrites," and the rule that follows is: **only sync with instances you
own.** The confirmation dialog must name the target host so the user is choosing
that trust deliberately (also mitigates handing the entered password to a
mistyped/attacker host). Import-time validation (account records, proxy
public-IP checks in `parseBundle`) is not an authenticity control — it only
rejects malformed data, not hostile-but-well-formed data.

## UX

A new **Remote sync** card in the existing **Sync** settings tab
(`src/renderer/pages/settings/DataSettings.tsx`, which renders under the tab
labeled "Sync" in `src/renderer/pages/Settings.tsx`). It appears on **both the
desktop and web builds** — the same renderer serves both, and the outbound call
runs host-side either way (see *Topologies*). Fields and controls:

- **Remote URL** — text input, `https://…`, e.g. `https://aox.dombot.ai`.
  Validated for https; trimmed; no trailing path required.
- **Password** — password input. The remote instance's login password, entered
  **on each Push/Pull** (like the passphrase on a file export) and **never
  stored** (see *Secret model*). No "remember password" option.
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

### Secret model: nothing stored, password entered per sync

**No secret is ever persisted** — the model mirrors the passphrase on a file
export. The user enters the remote password **on each Push/Pull**. That password
is exchanged for a bearer token at `POST {remoteUrl}/auth/token`, the token is
used for that one operation's `/api` calls, and **both the password and the
token are discarded** when the sync finishes. The token never touches disk; it
lives only in memory for the duration of the sync. Sync is an occasional,
deliberate action, not an ongoing background process, so there is nothing to
cache and no "session" to keep.

The only thing worth remembering between syncs is the **remote URL**, which is
not a secret. Store just `remoteSyncUrl` in a dedicated host-local `remote-sync`
namespace, added to `NEVER_EXPORTED` (`src/core/storage/bundle.ts`) so a Pull
does not clobber it. Because that namespace holds **no secret**, it needs **no
sealing** — this fully retires the earlier at-rest-credential concern (there is
no password or token at rest to protect).

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

- Sync handler, `(remoteUrl, password)` — the password is supplied fresh for
  every call and never persisted:
  - Reject `remoteUrl` that is not `https://`, or that equals this instance's
    own origin (self-sync / deadlock guard).
  - **Token (ephemeral):** `POST {remoteUrl}/auth/token` with the password to
    mint a token, held in memory for this operation only. Discard both the
    password and the token when the handler returns.
  - **Pull**: `GET`/`POST {remoteUrl}/api/exportData` (no local lock held) →
    take the store lock → `hydrateStores()` → local `importBundle(text)` →
    `flushWrites()` → release.
  - **Push**: take the store lock → `hydrateStores()` → local
    `exportBundle(...)` → release → `POST {remoteUrl}/api/importData` with
    `{ args: [text] }`.
  - All target calls carry `Authorization: Bearer <token>`. Reuses the existing
    bundle machinery unchanged.
  - A `401` from `/api/*` (wrong password, or the remote's password changed)
    surfaces plainly so the user can re-enter and retry. Nothing to invalidate —
    no token was stored.
- **Locking + hydration (web host).** Do **not** run this as a plain locked core
  method: `/api/:method` holds `withRequestLock` for the whole call, which would
  stall the instance for the network round trip and deadlock a same-origin/
  `wrangler dev` target (see *Topologies*). But the standard `/api` wrapper also
  does two things the sync **must not skip**: it **hydrates** the store from D1
  before the handler and **flushes** writes to D1 after it. Because
  `exportNamespaces` skips any namespace that is not loaded, a Push on a **cold
  isolate without hydration exports an empty bundle — which would wipe all data
  on the remote** — and a Pull that returns before `flushWrites()` may not
  persist. So the **dedicated worker route must still hydrate before, and flush
  after, the local step**; it only moves the *outbound fetch* outside the lock,
  it does not drop the hydrate/flush lifecycle. Concretely: `hydrate` → (Pull:
  fetch first) → lock → export/import → `flushWrites` → unlock, with the network
  call never inside the lock. On desktop there is no isolate lock, but keep the
  same shape.
- **Wiring.** Expose `syncPush` / `syncPull` to the renderer the usual way —
  `src/shared/ipc.ts` (`DombotApi` + `IpcChannels`), `src/preload.ts` (Electron
  IPC → main process), `src/renderer/api/http.ts` for the web build (pointing at
  the dedicated route rather than the generic `/api/<name>` dispatch), and the
  caller in `DataSettings.tsx`.
- A host-local `remote-sync` namespace holding only `remoteSyncUrl` (non-
  secret), added to `NEVER_EXPORTED` so a Pull doesn't clobber it. **No secret
  is stored, so no sealing is needed** (see *Secret model*).

UI:

- The Remote sync card described above in `DataSettings.tsx` (shown on both
  builds).

## Failure modes & edge cases

- **Unreachable / wrong URL / non-HTTPS** — validate up front; surface a clear
  error, do nothing.
- **Wrong password / rate-limited** — `/auth/token` returns 401 / 429 (its own
  rate-limit bucket, 10 / 15 min). Surface plainly; do not retry silently. The
  user re-enters the password to try again (nothing was stored).
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

1. ~~Remember the password / cache a token?~~ **Decided: store nothing.** The
   password is entered on each Push/Pull and discarded, exactly like a file
   export's passphrase; the token is ephemeral (see *Secret model*). Sync is an
   occasional action, not an ongoing session.
2. Show a diff/summary before overwriting (counts of accounts, domains) so the
   user sees what they are about to replace? Nice-to-have, not required for v1.
3. ~~Desktop-only or web-to-web?~~ **Decided: web-to-web is in.** Push/pull is
   a host-side core method and the panel ships on both builds; a web instance
   can initiate against another (see *Topologies*). No outbound-target IP
   guarding — HTTPS is the only requirement (see *Deliberately not guarding
   outbound targets*).
