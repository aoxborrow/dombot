# Remote sync (push / pull with a hosted DomBot)

Status: design / research (2026-09-17). Not yet implemented.

## Goal

Let the desktop app move its entire dataset to and from a self-hosted DomBot
web instance, so a user can keep a laptop and a hosted instance in step without
re-entering registrar keys. Two explicit, one-shot actions:

- **Push** — overwrite the remote's data with this desktop's data.
- **Pull** — overwrite this desktop's data with the remote's data.

There is no merge and no continuous/background sync. Each button is a wholesale,
last-write-wins replacement in one direction, run when the user asks.

### Non-goals

- No field-level merge, no conflict resolution, no three-way diff.
- No automatic/scheduled sync (could come later; out of scope here).
- No multi-user or per-record sharing. This is "my laptop ↔ my server".

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
   is the authorization. Reuse the existing login rate-limiter on it.
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
  HTTP).
- Secrets at rest are unchanged: the remote re-encrypts on import via its own
  D1/AES-GCM layer; the desktop re-encrypts via OS keychain. Only the transient
  in-flight bundle is plaintext-over-TLS.

## UX

A new **Remote sync** card in the existing **Sync** settings tab
(`src/renderer/pages/settings/DataSettings.tsx`, which renders under the tab
labeled "Sync" in `src/renderer/pages/Settings.tsx`). Fields and controls:

- **Remote URL** — text input, `https://…`, e.g. `https://aox.dombot.ai`.
  Validated for https; trimmed; no trailing path required.
- **Password** — password input. The instance's login password.
  - Optional "Remember on this device" checkbox → persist via desktop
    `safeStorage` (same custody as credentials). Default off; if off, the field
    is entered each time.
- **Pull** button — "Replace all local data with the remote's."
- **Push** button — "Replace all data on the remote with this device's."
- **Status line** — last successful push/pull time; on load, a lightweight
  `GET {remoteUrl}/auth/status` to show reachability and detected auth mode
  (and to warn early if the instance is not in `password` mode).

Both buttons open a **confirmation dialog** first, because both are irreversible
wholesale overwrites:

- Pull: "This replaces everything on this device — accounts, keys, folders,
  prices, cached domains — with the copy on {host}. Continue?"
- Push: "This replaces everything on {host} with this device's data. Continue?"

Persisted UI state must **not** live in the `settings` namespace — `settings`
travels in the bundle, so a Pull would import the remote's copy and clobber the
saved URL (and any remembered secret). This config is host-local, like `auth`
and `meta`. Store it in a dedicated `remote-sync` namespace that is added to
`NEVER_EXPORTED` (`src/core/storage/bundle.ts`) so it is excluded from every
bundle in both directions: `remoteSyncUrl`, the "remember" flag, and — only if
"remember" is on — the token/password in encrypted (`safeStorage`) storage.
Keeping it out of the bundle also correctly prevents a host-local secret from
ever being pushed to the remote.

## Implementation surface

Backend (worker):

- `src/worker/index.ts` — add `POST /auth/token` (password mode, `sameOrigin`-
  exempt, rate-limited, returns the token in the body); skip `sameOrigin` for
  bearer-authenticated `/api` requests.
- `src/worker/auth.ts` — bearer-token acceptance in `isAuthenticated` (password
  mode).

Desktop / core:

- A small `remote-sync` service: given `{ remoteUrl, password }`, exchange the
  password for a token at `POST {remoteUrl}/auth/token`, then:
  - **Pull**: `POST {remoteUrl}/api/exportData` → local `importBundle(text)`.
  - **Push**: local `exportBundle(...)` → `POST {remoteUrl}/api/importData`
    with `{ args: [text] }`.
  - All calls carry `Authorization: Bearer <token>`. Reuses the existing bundle
    machinery unchanged.
- A host-local `remote-sync` namespace (added to `NEVER_EXPORTED`) for the saved
  URL / remember-flag / optional stored secret.
- New IPC methods `syncPush` / `syncPull` following the `exportData` /
  `importData` pattern across the five touchpoints: `src/shared/ipc.ts`
  (`DombotApi` + `IpcChannels`), `src/core/api/index.ts`, `src/preload.ts`,
  `src/renderer/api/http.ts`, and the caller in `DataSettings.tsx`.
  - Note: these run in the desktop host only (they reach *out* to a remote).
    The web host does not need them; it is the receiver via its existing
    `/api/exportData` / `/api/importData`.

UI:

- The Remote sync card described above in `DataSettings.tsx`.

## Failure modes & edge cases

- **Unreachable / wrong URL / non-HTTPS** — validate up front; surface a clear
  error, do nothing.
- **Wrong password / rate-limited** — `/auth/token` returns 401 / 429 (the
  reused login rate limit is 10 / 15 min). Surface plainly; do not retry
  silently.
- **Auth mode mismatch** — if `/auth/status` reports a non-`password` mode,
  disable Push/Pull with an explanation. Both `cloudflare-access` and
  `external` are unsupported in v1 (see *Supported auth modes*): neither yields
  a token the desktop can present, and `external` still fails the `/api`
  `sameOrigin` check.
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

1. Remember the password by default, or always prompt? (Leaning: off by
   default, opt-in via checkbox.)
2. Show a diff/summary before overwriting (counts of accounts, domains) so the
   user sees what they are about to replace? Nice-to-have, not required for v1.
3. Do we want a symmetric "this instance can also push/pull to another" on the
   web build, or is reaching-out desktop-only for v1? (Leaning: desktop-only;
   the web instance is always the receiver.)
