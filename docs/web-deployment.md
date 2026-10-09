# Web deployment — how the web host works

How DomBot runs as a private web app on Cloudflare, beside the desktop build.
Both hosts run the same renderer and the same services; only the host around
them differs. For deploying and running an instance, see
[self-hosting.md](self-hosting.md).

The Cloudflare deployment uses two products — **Workers** (with static assets
and a cron trigger) and **D1** — plus two secrets. No KV, Queues, R2, Durable
Objects or Pages, and Cloudflare Access is optional.

- **One codebase, two hosts.** `src/core` (services, storage, API contract,
  MCP tools) has no `electron` imports. `src/electron` and `src/worker` are
  thin hosts. A domain op, a sync or a folder edit behaves the same in both.
- **Credentials are edited in the app.** Registrar keys are entered in
  Settings and stored encrypted in D1. The only secrets the operator manages
  out of band are one root key and one generated login password.
- **Everything is encrypted at rest.** Portfolio and detail caches carry EPP
  auth codes and contact data, so every stored value is sealed with the root
  key. Someone with D1 console access sees ciphertext.
- **Private by default.** Single-user login with a generated password held as
  a Worker secret, locked from the first request — or Cloudflare Access or a
  platform gate instead, via `DOMBOT_AUTH`. The MCP endpoint keeps its own
  OAuth flow, with approvals in the web UI.
- **One instance, one person, one portfolio.** There is no multi-user mode and
  no hosted DomBot service.

## Architecture

```
src/
  shared/        types + API contract
  renderer/      React app, plus a login page and an HTTP api shim
  core/          host-agnostic: services, storage interface, api dispatcher,
                 hono router, mcp tools + oauth, bulk runner, sync
  electron/      main process: window, preload IPC, FS storage, safeStorage,
                 stdio shim, timers
  worker/        cloudflare: fetch handler, scheduled handler, D1 storage,
                 session auth
```

### Storage: `DocStore`

Every store is "a namespace of JSON values keyed by string", and that is the
interface (`src/core/storage/doc-store.ts`, abridged):

```ts
interface DocStore {
  get(ns: string, key: string): Promise<unknown | null>;
  put(ns: string, key: string, value: unknown): Promise<void>;
  putMany(ns: string, entries: [string, unknown][]): Promise<void>;
  delete(ns: string, key: string): Promise<void>;
  list(ns: string): Promise<Record<string, unknown>>;
  clear(ns: string): Promise<void>;
}
```

Namespaces are listed, with their names and flags, in
[storage-model.md](storage-model.md). Services keep an in-memory copy of each
namespace (`Namespace`, `src/core/storage/namespace.ts`); loading and
persisting go through the store.

Implementations:

- **`FsDocStore`** (Electron): one JSON file per namespace, `{ key: value }`.
  Credentials are sealed by an `EncryptedDocStore` decorator whose cipher is
  `safeStorage` on desktop.
- **`D1DocStore`** (Worker): a single table.

  ```sql
  CREATE TABLE docs (
    ns TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
    updated_at INTEGER NOT NULL, PRIMARY KEY (ns, key)
  );
  ```

  Strongly consistent, transactional (`batch()`), and trivially the same
  table on Postgres/SQLite/MySQL for another host. KV was rejected for
  eventual consistency (read-after-write on settings would flake); a Durable
  Object with SQLite would also work well for a single tenant but is
  Cloudflare-only and adds a product.

- **One request at a time per isolate.** The core keeps each namespace in
  module memory and the Worker re-hydrates it for every handler that has
  state (login, an authenticated `/api/*` call, the MCP paths) — after the
  checks that need no store, so an unauthenticated request never costs a
  decrypt of D1; assets and `/auth/status` never hydrate.
  An isolate interleaves concurrent requests at each `await`, so those
  requests run through a per-isolate lock (`src/worker/lock.ts`): hydrate →
  handle → flush is atomic, a `getRevisions` poll can't reset the bulk
  runner under a step in flight, and login attempts count one by one.
  Isolates still run in parallel with each other; hydration keeps them
  consistent with what's durable. `flushWrites()` rejects if a write
  failed, and the request answers 500 rather than claiming the save.

- **`EncryptedDocStore`** decorator: seals each value with AES-256-GCM before
  the inner `put`, opens on `get`/`list`. Envelope `{ v: 1, iv, ct }` base64.
  On the Worker every namespace goes through it; on Electron only
  `registrar-credentials` and `registrar-proxies` (the rest stays plain JSON,
  since the OS user boundary is the desktop trust model).

### The two secrets

Both are generated, set once as Worker secrets, and never stored in D1:

- **`DOMBOT_SECRET`** — 32 random bytes, base64. Root key for data. From it,
  HKDF (WebCrypto, identical code on every host) derives an AES-256-GCM key
  for `EncryptedDocStore` and the session-signing key.
- **`DOMBOT_PASSWORD`** — 32 random bytes, base64. The login password. It is
  a secret binding, not a stored hash, so the database holds no
  authentication material at all and the instance is locked from its very
  first request — there is no setup page and no window in which a stranger
  could claim it.

`npm run web:secrets` generates both, applies them with `wrangler secret put`,
and prints them once so the operator can put them in a password manager. The
deploy docs give the equivalent two `openssl rand -base64 32` lines for people
who'd rather do it by hand. Lose `DOMBOT_SECRET` and the data is unreadable by
design; the docs say so, and the export bundle is the backup.
`npm run web:rotate-secret` re-encrypts every doc under a new root key by
round-tripping the data through a sealed bundle.

### Auth for the web UI

Single user, no external identity provider, no auth state in the database.

1. **Login** compares the submitted password against the `DOMBOT_PASSWORD`
   binding in constant time, hashing both sides first so length leaks
   nothing. No PBKDF2: the value is 32 random bytes, not a human password.
   Failed attempts are counted per source in a `login_attempts` D1 table
   (`src/worker/login-rate-limit.ts`): 10 per 15 minutes, with the source
   address stored only as an HMAC.
2. **Session** → `dombot_session` cookie: HttpOnly, Secure, SameSite=Strict,
   HMAC-SHA256-signed `{ issuedAt, expiresAt }`, 30-day expiry. The signing
   key is HKDF-derived from `DOMBOT_SECRET` _mixed with a hash of
   `DOMBOT_PASSWORD`_, so rotating the password invalidates every session
   automatically — no generation counter, no "sign out everywhere" feature.
3. **Mutations** additionally require an `Origin` header matching the request
   host (belt-and-braces with SameSite).
4. **No reset page, no change-password page, no setup page.** Rotating the
   password is a command (below).

**Recovery.** Forgot the password, or want to rotate it:

```bash
npm run web:rotate-password
```

That generates a fresh value, applies it via `wrangler secret put
DOMBOT_PASSWORD`, and prints it. Takes effect on the next request and logs
every existing session out. Recovery therefore requires Cloudflare account
access, which is the right bar — nothing about the password can be changed
from the browser. Lost `DOMBOT_SECRET` as well: set a new one, wipe the
`docs` table, re-enter registrar keys, and the first sync rebuilds the
portfolio. Everything that isn't registrar data (folders, prices, history,
notes, imported domains, MCP pairings) is lost unless an export bundle restores
it.

The same command accepts an operator-supplied value for anyone who insists on
a memorable password; the docs don't advertise it, and the login backoff is
the only strength control.

### Auth modes: built-in, Cloudflare Access, platform gates

A `DOMBOT_AUTH` var selects how the UI and `/api/*` are protected. Three
modes; the MCP routes are handled separately (below).

- **`password`** (default) — the built-in login above. Works on any host.
- **`cloudflare-access`** — Cloudflare Access (Zero Trust, free for up to 50
  users) fronts the Worker. The Worker does **not** merely trust that Access
  ran: it verifies the `Cf-Access-Jwt-Assertion` JWT on every request against
  the team's JWKS (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`)
  and the application's audience tag, both supplied as plain vars
  (`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`). A request that reaches the
  Worker without a valid token is rejected. No login page, no session cookie;
  "Sign out" links to `/cdn-cgi/access/logout`. `DOMBOT_PASSWORD` is unused.
- **`external`** — a platform gate the function can't verify from inside:
  Vercel Password Protection / Deployment Protection, or any reverse proxy
  with its own auth. The platform enforces the gate before the function runs,
  so the app runs with no login of its own. This is an explicit opt-in
  because a misconfigured gate leaves the app open; the deploy docs say so in
  bold, and the status bar reads "Gated externally". A warning when no gate is
  evident is [#154](https://github.com/aoxborrow/dombot/issues/154).

Modes layer: `password` behind Access or behind Vercel protection is fine for
anyone who wants two doors. The mode only decides what DomBot itself checks.

**MCP behind a gate — a documented limitation.** MCP clients can't complete
an Access login or a Vercel password prompt. With Access, the operator _can_
scope the Access application to the UI and `/api/*` and leave `/mcp`,
`/authorize`, `/token`, `/register`, `/revoke`, `/oauth/status`, and
`/.well-known/*` outside it, in which case DomBot's own OAuth handles MCP as
usual (the approval still happens inside the protected UI); the setup guide
lists those paths. With Vercel protection there are no path exclusions, so
MCP simply doesn't work. Either way the MCP settings page in
`cloudflare-access` / `external` mode says so: MCP clients can't pass the
gate, so it must exclude the MCP paths. No bypass-token tricks.

### API: one contract, two transports

`DombotApi` is typed in `src/shared/ipc.ts`. The method table in
`src/core/api/index.ts` maps each name to a zod input schema (`schemas.ts`)
and a handler. From it:

- **Electron:** `src/electron/ipc.ts` registers an `ipcMain.handle` per
  entry. Preload exposes `window.api`.
- **Web:** Hono route `POST /api/:method` with a JSON `args` array, over the
  same table. Validation matters here because it's a network endpoint
  (behind auth, but still). The renderer uses `createHttpApi(): DombotApi`
  (`src/renderer/api/http.ts`) when there is no `window.api`.

Methods that are host-specific get host-aware implementations behind the same
name: `openExternal` (web: renderer just uses `<a target="_blank">`), `saveCsv`
(web: browser Blob download), `getAppInfo` (web: `platform: 'web'`,
`version` from the build), `getMcpInfo` (web: public MCP URL, no stdio
command).

**Events.** The `onX` subscriptions (`bulkProgress`, `bulkFinished`,
`portfolioChanged`, `approvalsChanged`) are pushed over IPC on desktop. On the
web, change counters in `meta` (`src/core/revision.ts`) stand in for them:
the HTTP api polls `getRevisions()` every 2 s while a bulk job runs and every
15 s otherwise, paused while the tab is hidden, and refetches only what moved.
Same interface either way; the renderer doesn't know.

### Long-running work

Workers can't hold a job in memory across requests (isolates come and go, and
there may be more than one), so long-running work is persisted and driven
from outside.

**Bulk jobs** are persisted and step-driven (`src/core/services/bulk-jobs.ts`).
The job (targets, op, results, counts, `cancelRequested`, per-registrar
`notBefore` timestamps for the rate-limit spacing) lives in `bulk-jobs/<id>`.
`stepBulk(jobId)` processes one slice — up to N items whose registrar lane is
ready — and returns the snapshot. Who calls it repeatedly:

- Electron: the host loops itself (`driveBulk`).
- Web: the renderer, while the app is open. Closing the tab pauses the job;
  reopening resumes it. That's acceptable for a one-person tool and needs no
  Queues or Workflows. A 200-domain Porkbun job (10 s spacing) takes about
  35 minutes with the tab open.

Cancel is a flag on the doc that the next step honors. A job survives a
Worker restart, an app crash, and a laptop lid. A job found still running at
desktop launch is closed out rather than resumed — renew is money, so nothing
restarts on its own: items that never ran are marked interrupted, and the
results report is the retry surface.

**Auto-sync** is `syncAll()` in core, invoked by a host scheduler:

- Electron: a `setInterval` honoring `autoSyncIntervalMinutes`.
- Worker: an **hourly** Cron Trigger (`"crons": ["0 * * * *"]`) →
  `scheduled()` → `syncAll()`, which reads `autoSyncIntervalMinutes` and
  returns immediately unless the last sync is older than that interval. The
  cron cadence is the _floor_ — it matches the shortest option the Settings
  control offers ("Every hour") — and the setting decides the actual
  frequency, so the web host honors every interval the desktop does. A
  no-op tick costs a few milliseconds. Cron handlers get 15 minutes of wall
  clock; a full-portfolio sync across several registrars fits.
  Per-registrar sync also runs in a request when the user hits Sync.

**Nameserver lookup**, for registrars that don't report nameservers, uses
DNS-over-HTTPS (`src/core/dns.ts`:
`https://cloudflare-dns.com/dns-query?name=…&type=NS` with
`accept: application/dns-json`, with Google's resolver as a fallback). One
code path for both hosts.

### MCP server on the web

- Transport: `WebStandardStreamableHTTPServerTransport` in **stateless** mode
  (no `sessionIdGenerator`), so no session map to lose between isolates.
  Server-initiated notifications aren't available in this mode; the tools in
  `src/core/mcp/tools.ts` are stateless over the services and don't use them.
- OAuth provider (`src/core/mcp/oauth.ts`): same logic, but clients, auth
  codes, tokens, and pending approvals all live in the `mcp` namespace of the
  `DocStore`, so the authorize request, the in-app approval, and the token
  exchange can each land on a different isolate. Access tokens are random and
  stored by SHA-256 hash — the store never holds a usable bearer token —
  which also makes revocation a plain delete. Registrations that never pair
  are pruned (1 h TTL, capped at 50) since `/register` is public.
- Approval flow: unchanged from the user's side. The `/authorize` waiting
  page is served by the Worker; the ApprovalModal in the web UI (logged in)
  approves it; the waiting page polls `/oauth/status`. Issuer URL is the
  request origin.
- The MCP routes are Hono, in core (`src/core/mcp/routes.ts`), mounted by
  both hosts (`@hono/node-server` on Electron), with DomBot's own OAuth
  handlers: RFC 8414/9728 discovery, 7591 registration, authorize with PKCE
  S256, token, and 7009 revoke. The stdio shim is Electron-only; on the web,
  Claude Desktop and other clients connect to `https://<host>/mcp` as a remote
  MCP server with OAuth, which they support natively.

### Renderer changes

Deliberately small:

- `src/renderer/main.tsx` installs `createHttpApi()` as `window.api` when
  there is no preload, and shows the login page until a session exists.
- `src/renderer/lib/platform.ts` says which host it is (and which auth mode),
  used by CSV export (dialog vs. download), external links, the MCP settings
  page (no stdio section; "Connect with this URL"), and the About panel.
- The HTTP api drives `stepBulk` on the web while a job runs.

### Build and deploy (Cloudflare)

- `wrangler.jsonc`: `main: src/worker/index.ts`, static assets from
  `dist/web` (`not_found_handling: single-page-application`,
  `run_worker_first`), one D1 binding (`DB`), an hourly cron trigger,
  `compatibility_flags: ["nodejs_compat"]`, and `DOMBOT_AUTH` as a plain var.
  Personal overrides go in a gitignored `wrangler.local.json`, merged in by
  `scripts/wrangler.mjs`.
- `npm run web:build` is the renderer's Vite build for the web
  (`vite.web.config.mts`). `npm run web:dev` builds it and runs `wrangler dev`
  with local D1. `npm run deploy` applies D1 migrations and runs
  `wrangler deploy`; `npm run web:deploy` builds first.
- D1 schema via `wrangler d1 migrations` (`migrations/`: the `docs` table and
  the `login_attempts` table).
- **Deploy to Cloudflare button** in the README and on dombot.ai
  (`deploy.workers.cloudflare.com/?url=github.com/aoxborrow/dombot`). It
  forks the repo, provisions the D1 database declared in `wrangler.jsonc`,
  runs the build, and prompts for `DOMBOT_SECRET` and `DOMBOT_PASSWORD`
  (described in `.dev.vars.example` and `package.json`'s `cloudflare`
  block). `.github/workflows/deploy-worker.yml` redeploys a fork on push once
  it has a Cloudflare API token.

Workers Free allows 10 ms of CPU per invocation, and a registrar sync that
parses XML for hundreds of domains can exceed it. Workers Paid ($5/month)
allows 30 s (raisable to 5 minutes); [self-hosting.md](self-hosting.md#limits)
says when to switch.

### Desktop migration

Older desktop installs kept each service's data in its own JSON file. Those
were already `{ key: value }` maps, so `FsDocStore` (one file per namespace)
loads them unchanged, and `runMigrations` renames them to the current
namespaces ([storage-model.md](storage-model.md#migration)). The one real
migration is credentials, which used to be one safeStorage-encrypted blob
(`src/electron/storage/migrate.ts`):

1. On first launch, before hydration, `migrateLegacyCredentials()` looks for
   `credentials.dat`. Absent → done.
2. It parses the blob (plaintext first, for the opt-in fallback; else
   safeStorage decrypt) and `put`s each registrar into the credentials
   namespace through the encrypting store, so each entry is re-sealed
   individually and stays encrypted throughout.
3. The legacy file is renamed `credentials.dat.pre-v1.bak` (kept for one
   release). If the blob can't be decrypted right now (no keyring available),
   it's left in place and retried next launch — nothing is lost.

Idempotent, and covered by tests that seed a plaintext blob, an encrypted
blob, and an unreadable one.

**Desktop → web transfer.** Settings → Sync exports a JSON bundle of every
exported namespace (`src/core/storage/bundle.ts`), optionally sealed with a
passphrase in the browser (`src/shared/bundle-seal.ts`, PBKDF2 + AES-GCM, so
the key stretching never runs on the Worker). The other instance imports it
from Settings → Sync, so a desktop user can move to their own instance
without re-entering keys or redoing folders.

### Cloud-agnostic seams

What another host has to supply, and nothing more. Only the Cloudflare and
Electron hosts exist; the Vercel column is what an adapter would use.

| Seam       | Cloudflare                                        | Vercel (not built)                                       | Electron                            |
| ---------- | ------------------------------------------------- | -------------------------------------------------------- | ----------------------------------- |
| `DocStore` | D1                                                | Neon/Postgres or Upstash (same `docs` table)             | JSON files                          |
| Secrets    | `DOMBOT_SECRET` + `DOMBOT_PASSWORD` bindings      | env vars                                                 | safeStorage (no root key, no login) |
| Auth gate  | `password`, or `cloudflare-access` (JWT verified) | `password`, or `external` (Vercel protection)            | none (local user)                   |
| HTTP       | Hono `fetch` handler + static assets              | Hono on Vercel Functions + static                        | `@hono/node-server` (MCP only)      |
| Scheduler  | Cron Trigger → `syncAll()`                        | `vercel.json` cron → `/api/cron/sync` with `CRON_SECRET` | `setInterval`                       |
| Bulk steps | client-driven                                     | client-driven                                            | self-driven loop                    |

The Worker host (`src/worker/index.ts`) is about 300 lines. A Vercel host
would be the same file with a different storage import and a cron route.

## Retry standard

One rule for every registrar, direct or through the fixed IP proxy, on both
hosts. The user-facing summary is in
[self-hosting.md](self-hosting.md#when-a-change-may-or-may-not-have-gone-through).

### What hurts when sent twice

The HTTP method can't be the signal: Namecheap sends writes as GET, and
Porkbun sends reads as POST. What matters is the effect of a repeat:

- **Renew.** Charges twice and adds two terms. The one that costs money.
- **Writes that create records** at registrars whose API adds DNS or
  forwarding entries one at a time. A repeat leaves duplicates.
- **Register and transfer-in.** The repeat fails with "unavailable" or
  "already pending", so the user sees a failure for something that succeeded.
- Everything else sets a state (auto-renew, lock, nameservers, contacts,
  privacy flag, forwarding, DNSSEC disable) and is harmless to repeat.

### The rule

`@aoxborrow/registrar-client` decides by where the failure happened and
whether the call is a read or a write. It classifies by feature method, not
by HTTP method: `get*`, `list*`, `check*` and `testConnection` are reads;
everything else is a write. A new method is classified explicitly;
unclassified means write.

| Failure                                                                                                        | Read                          | Write                                         |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------- |
| Registrar never saw the request: DNS failure, connection refused, TLS handshake failure, any proxy-stage error | Retry                         | Retry                                         |
| 429 (explicitly rejected)                                                                                      | Retry, honoring `Retry-After` | Retry, honoring `Retry-After`                 |
| Outcome unknown: timeout after the request was sent, connection dropped mid-response, 5xx                      | Retry                         | **Do not retry.** Raise `OutcomeUnknownError` |
| Any other response (4xx, provider error body)                                                                  | Fail                          | Fail                                          |

`OutcomeUnknownError` carries the feature name and the underlying cause, and
is not retryable. Providers that fold errors into an `OperationResult`
report the same case as `outcome: 'unknown'`.

### What DomBot does with an unknown outcome

It resolves it instead of asking the user to. `applyDomainOp`
(`src/core/services/domain-ops.ts`) re-fetches the domain once after an
unknown outcome and compares the relevant field with what the write
intended:

- **Applied.** Report success and patch the cache, as a normal success would.
- **Not applied, and harmless to repeat** (auto-renew, lock, privacy,
  nameservers, an auth-code request). Report failed and safe to try again.
- **Not applied but it costs money, the re-fetch failed, or there is no field
  to check** (a renewal whose expiry hasn't moved, forwarding changes). Report
  the `unknown` status, shown as "Unconfirmed": check the domain first. A
  renewal is never called safe to retry, because registrars can take a while
  to show one.

Bulk jobs record the same three states per domain, and "not applied" rows are
eligible for the retry action. MCP tools return the same wording.

### Proxy errors versus registrar errors

A CONNECT proxy has a hard boundary: the tunnel is established or it is not.
Everything before that point belongs to the proxy and means the registrar
never saw the request: proxy unreachable, 407, a non-2xx reply to CONNECT, a
TLS failure to the proxy itself, a registrar certificate that can't be
verified inside the tunnel. Desktop (`https-proxy-agent`) raises a
`ProxyStageError` for these and the Worker's `tunnelfetch` raises its own
coded errors. `sendThroughProxy` (`src/core/services/proxy-transport.ts`)
maps both to a plain message marked with the library's `markNotSent`, so they
retry for any call and surface as proxy problems ("The proxy rejected the
username or password"), never as registrar errors, and never with the proxy
URL.

Once the tunnel is up the traffic is end-to-end TLS with the registrar, and
failures are the same as on a direct connection. A tunnel that drops
mid-request is an unknown outcome and follows the table.
