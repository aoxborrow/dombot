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

The web instance already authenticates with a **password** (`DOMBOT_PASSWORD`
secret) via `POST /auth/login`, which mints a signed, HMAC-backed session token
(`src/worker/auth.ts`). Reuse that — do **not** invent a new secret or derive a
token client-side.

Flow:

1. Desktop calls `POST {remoteUrl}/auth/login` with `{ password }`.
2. The response sets the `dombot_session` cookie. The desktop reads that token
   value out of the `Set-Cookie` header and stores it (in memory for the
   operation; optionally persisted — see below).
3. Desktop calls the remote API with `Authorization: Bearer <token>` instead of
   relying on the cookie.

Why the session token rather than "token = the password":

- It is **server-minted** and HMAC-signed by a key derived from
  `DOMBOT_SECRET` + password, so it cannot be forged offline.
- It **expires** (30-day TTL) and is **invalidated by a password change** for
  free, because the signing key depends on the password.
- The raw password crosses the wire only on the single login call.

Only the `password` auth mode is covered by "enter the password". Instances in
`cloudflare-access` or `external` mode do not have a DomBot login; the bearer
path below still works for `external`, and `cloudflare-access` would need the
CF Access flow (out of scope for v1 — document as unsupported).

### Server change: accept a bearer token and exempt it from same-origin

Today every `/api/*` call passes an `isAuthenticated` check **and** a
`sameOrigin` CSRF check (`src/worker/index.ts`, `sameOrigin` in
`src/worker/auth.ts`). `sameOrigin` returns `false` when there is no
`Origin`/`Referer` header, so a desktop HTTP client is rejected as-is.

Change:

1. In `isAuthenticated` (password mode), accept a valid session token from the
   `Authorization: Bearer <token>` header in addition to the cookie
   (`verifySession` on the header value).
2. In the `/api/:method` gate, **skip the `sameOrigin` check when the request
   authenticated via bearer** (a bearer token cannot be sent ambiently by a
   browser, so CSRF does not apply to it). Cookie-authenticated requests keep
   the same-origin check unchanged.

This is additive and does not touch the existing browser/cookie path. It also
gives us a proper programmatic-access primitive for anything future.

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

Persisted UI state lives in the `settings` namespace: `remoteSyncUrl` (and, if
"remember" is on, the password in encrypted storage; otherwise not stored).

## Implementation surface

Backend (worker):

- `src/worker/auth.ts` — bearer-token acceptance in `isAuthenticated`.
- `src/worker/index.ts` — skip `sameOrigin` for bearer-authenticated `/api`
  requests.

Desktop / core:

- A small `remote-sync` service: given `{ remoteUrl, password }`, log in, get a
  bearer token, then:
  - **Pull**: `POST {remoteUrl}/api/exportData` → local `importBundle(text)`.
  - **Push**: local `exportBundle(...)` → `POST {remoteUrl}/api/importData`
    with `{ args: [text] }`.
  - Reuses the existing bundle machinery unchanged.
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
- **Wrong password / rate-limited** — `/auth/login` returns 401 / 429
  (login rate limit is 10 / 15 min). Surface plainly; do not retry silently.
- **Auth mode mismatch** — if `/auth/status` reports a non-`password` mode,
  disable Push/Pull with an explanation (except `external`, which needs no
  login).
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
