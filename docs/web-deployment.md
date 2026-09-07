# Web deployment — self-hosting DomBot on Cloudflare

A planning doc for making DomBot deployable as a private web app, so a user can
run their own instance on Cloudflare (and, with one more adapter, on Vercel or
any fetch-handler host) instead of the desktop build. The desktop app stays
first-class; the web build is the same renderer and the same services behind a
different host.

The shape of the work: pull everything that isn't Electron-specific out of
`src/main` into a host-agnostic core, put a small storage interface under the
services, and add a second host (a Cloudflare Worker) next to the existing one
(Electron). The Cloudflare deployment uses exactly two products — **Workers**
(with static assets and a cron trigger) and **D1** — plus two secrets.

## Goals

- **One codebase, two hosts.** `src/core` (services, storage, API contract,
  MCP tools) has no `electron` imports. `src/electron` and `src/worker` are
  thin hosts. No feature forks: a domain op, a sync, a folder edit behaves the
  same in both.
- **Minimal services.** Workers + D1 + two secrets + one cron. No KV, no
  Queues, no R2, no Durable Objects, no Pages, no Access requirement.
- **Credentials editable in the app.** Registrar keys are entered in Settings
  exactly as today and stored encrypted in D1. The only secrets the operator
  manages out-of-band are one root key and one generated login password.
- **Everything encrypted at rest.** Not just credentials: portfolio and detail
  caches carry EPP auth codes and contact data, so every stored value is
  sealed with the root key. Someone with D1 console access sees ciphertext.
- **Private by default.** Single-user login with a generated password held as a
  Worker secret, locked from the first request — or Cloudflare Access / a
  platform gate instead, via `DOMBOT_AUTH`; the
  MCP endpoint keeps its OAuth flow, with approvals in the web UI.
- **Automatic desktop migration.** Existing installs move to the new storage
  layout on first launch with no user action.
- **Cloud-agnostic seams** (lower priority). Storage is a four-method
  interface; the HTTP layer is Hono; scheduling is one `syncAll()` call. A
  Vercel host is a follow-up adapter, not a rewrite.

## Non-goals (for this cut)

- **Multi-user / multi-tenant.** One instance = one person = one portfolio.
- **A hosted DomBot service.** This is self-deployment only.
- **Vercel adapter implementation.** The seams are built; the adapter ships
  later (see [Cloud-agnostic seams](#cloud-agnostic-seams)).
- **Realtime push (WebSocket/SSE).** Polling on a revision counter is enough
  for one user; SSE is a later upgrade behind the same `onX` interface.
- **Key rotation UI.** A `rotate-secret` script that re-encrypts is enough.

## Where the code stands today

- **Renderer** talks only to `window.api: DombotApi` (typed in
  `src/shared/ipc.ts`, ~40 methods, four subscription-style events). Nothing
  in `src/renderer` or `src/shared` imports Node or Electron. This is the
  contract the web build keeps intact.
- **Services** (`src/main/services/*`) are pure logic except for storage: each
  persists its own JSON file under `app.getPath('userData')` —
  `cache-portfolio.json`, `cache-detail.json`, `folders.json`, `settings.json`,
  `pricing-overrides.json`, `registrar-state.json`, `credentials.dat`
  (safeStorage-encrypted), `mcp-tokens.json`, `mcp-stdio.json`.
- **`@aoxborrow/registrar-client`** uses only `fetch` and `fast-xml-parser`.
  No Node built-ins. It will run on `workerd` as-is. The one Node dependency
  in the sync path is `node:dns` (`resolveNs` in registrars.ts) for registrars
  that don't report nameservers.
- **Background work** is in-process: `auto-sync.ts` is a `setInterval`;
  `bulk-jobs.ts` runs a job in memory with an `AbortController` and pushes
  progress to windows via `BrowserWindow.webContents.send`.
- **MCP server** is Express + `StreamableHTTPServerTransport` with an
  in-memory session map and an in-memory OAuth provider whose tokens persist
  to `mcp-tokens.json`. The SDK we already depend on (1.30) also ships
  `WebStandardStreamableHTTPServerTransport`, the fetch-based equivalent.

## Target architecture

```
src/
  shared/        types + API contract (as today)
  renderer/      React app (as today, plus a login page + an HTTP api shim)
  core/          host-agnostic: services, storage interface, api dispatcher,
                 hono router, mcp tools + oauth, bulk runner, sync
  electron/      main process: window, preload IPC, FS storage, safeStorage,
                 stdio shim, timers   (today's src/main minus the services)
  worker/        cloudflare: fetch handler, scheduled handler, D1 storage,
                 session auth, wrangler.jsonc
```

### Storage: `DocStore`

Every store today is "a namespace of JSON values keyed by string". Make that
the interface:

```ts
interface DocStore {
  get(ns: string, key: string): Promise<unknown | null>;
  put(ns: string, key: string, value: unknown): Promise<void>;
  delete(ns: string, key: string): Promise<void>;
  list(ns: string): Promise<Record<string, unknown>>;
}
```

Namespaces: `cache-portfolio`, `cache-detail`, `folders`, `settings`,
`pricing-overrides`, `registrar-state`, `credentials`, `mcp`, `bulk-jobs`,
`auth`, `meta`. Services keep their in-memory
copies exactly as now; only `load`/`persist` change, and they become async
(the IPC handlers are already async, so this is mechanical).

Implementations:

- **`FsDocStore`** (Electron): one JSON file per namespace, `{ key: value }`.
  Cache files already have this shape. Credentials stay safeStorage-wrapped
  by an `EncryptedDocStore` decorator whose cipher is `safeStorage` on
  desktop.
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
  `credentials` (the rest stays plain JSON, as today, since the OS user
  boundary is the desktop trust model).

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
design; the docs say so, and the export bundle (phase 6) is the backup story.
`scripts/rotate-secret` (later) re-encrypts every doc under a new root key.

### Auth for the web UI

Single user, no external identity provider, no auth state in the database.

1. **Login** compares the submitted password against the `DOMBOT_PASSWORD`
   binding in constant time, hashing both sides first so length leaks
   nothing. No PBKDF2: the value is 32 random bytes, not a human password.
   Failed attempts are recorded in `auth/attempts` with exponential backoff.
2. **Session** → `dombot_session` cookie: HttpOnly, Secure, SameSite=Strict,
   HMAC-SHA256-signed `{ issuedAt, expiresAt }`, 30-day expiry. The signing
   key is HKDF-derived from `DOMBOT_SECRET` _mixed with a hash of
   `DOMBOT_PASSWORD`_, so rotating the password invalidates every session
   automatically — no generation counter, no "sign out everywhere" feature.
3. **Mutations** additionally require an `Origin` header matching the request
   host (belt-and-braces with SameSite).
4. **No reset page, no change-password page, no setup page.** Settings →
   Security is a note explaining how to rotate.

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
portfolio; folders, manual prices, and MCP pairings are what's actually lost.

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
  bold, and the UI shows a persistent banner when it sees no evidence of a
  gate (on Vercel, the `_vercel_jwt` cookie), so a bad config is visible
  rather than silent.

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
`cloudflare-access` / `external` mode says so plainly: _"Your deployment is
behind an external gate. MCP clients can't pass it; use `password` mode or
exclude the MCP paths from the gate."_ No bypass-token tricks.

### API: one contract, two transports

`DombotApi` already exists as a typed object. Add a method table in
`src/core/api.ts`: name → zod input schema → handler. From it:

- **Electron:** `registerIpcHandlers()` becomes a loop over the table
  (`ipcMain.handle(name, (_, ...args) => handler(...parse(args)))`), replacing
  the eight hand-written `ipc/*.ts` files. Preload keeps exposing
  `window.api`.
- **Web:** Hono route `POST /api/:method` with a JSON `args` array, same loop.
  Validation matters here because it's a network endpoint (behind auth, but
  still). The renderer gets `createHttpApi(): DombotApi` and picks
  `window.api ?? createHttpApi()` at startup.

Methods that are host-specific get host-aware implementations behind the same
name: `openExternal` (web: renderer just uses `<a target="_blank">`), `saveCsv`
(web: browser Blob download), `getAppInfo` (web: `platform: 'web'`,
`version` from the build), `getMcpInfo` (web: public MCP URL, no stdio
command).

**Events.** The four `onX` subscriptions (`bulkProgress`, `bulkFinished`,
`portfolioChanged`, `approvalsChanged`) become a `meta/revision` counter in
the store plus `GET /api/events?since=N`, which returns what changed. The web
`DombotApi` polls it: every 2s while a bulk job runs, every 15s otherwise,
paused when the tab is hidden. Electron keeps push. Same interface either
way; the renderer doesn't know.

### Long-running work

Workers can't hold a job in memory across requests (isolates come and go, and
there may be more than one). Two things need restructuring; both end up
better on desktop too.

**Bulk jobs** become persisted and step-driven. The job (targets, op,
results, counts, `cancelRequested`, per-registrar `notBefore` timestamps for
the rate-limit spacing) lives in `bulk-jobs/<id>`. `bulk.step(jobId)`
processes one slice — up to N items whose registrar lane is ready — and
returns the snapshot. Who calls `step` repeatedly:

- Electron: the host loops itself, as now.
- Web: the renderer, while the job page is open (it already polls). Closing
  the tab pauses the job; reopening resumes it. That's acceptable for a
  one-person tool and needs no Queues/Workflows. `ctx.waitUntil` can run a
  couple of extra steps after each response to make it feel continuous.

Cancel is a flag on the doc that the next step honors. A job survives a
Worker restart, an app crash, and a laptop lid — a real improvement over
today's in-memory `AbortController`.

**Auto-sync** becomes `syncAll()` in core, invoked by a host scheduler:

- Electron: the existing `setInterval` honoring `autoSyncIntervalMinutes`.
- Worker: an **hourly** Cron Trigger (`"crons": ["0 * * * *"]`) →
  `scheduled()` → `syncAll()`, which reads `autoSyncIntervalMinutes` and
  returns immediately unless the last sync is older than that interval. The
  cron cadence is the _floor_ — it matches the shortest option the Settings
  control offers ("Every hour") — and the setting decides the actual
  frequency, so the web host honors every interval the desktop does. A
  no-op tick costs a few milliseconds. Cron handlers get 15 minutes of wall
  clock; a full-portfolio sync across several registrars fits.
  Per-registrar sync also runs in a request when the user hits Sync, as
  today.

**Nameserver lookup** moves from `node:dns` to DNS-over-HTTPS
(`https://cloudflare-dns.com/dns-query?name=…&type=NS` with
`accept: application/dns-json`, with Google's resolver as a fallback). One
code path for both hosts.

### MCP server on the web

- Transport: `WebStandardStreamableHTTPServerTransport` in **stateless** mode
  (no `sessionIdGenerator`), so no session map to lose between isolates. The
  tools in `mcp/tools.ts` are already stateless over the services.
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
- Hono replaces Express for the MCP routes in core (`src/core/mcp/routes.ts`),
  mounted by both hosts (`@hono/node-server` on Electron). Express and `cors`
  are removed; the SDK's Express-only auth router is replaced by ~150 lines of
  equivalent Hono handlers (RFC 8414/9728 discovery, 7591 registration,
  authorize with PKCE S256, token, 7009 revoke). The stdio shim stays
  Electron-only; on the web, Claude Desktop and other
  clients connect to `https://<host>/mcp` as a remote MCP server with OAuth,
  which they support natively.

### Renderer changes

Deliberately small:

- `src/renderer/api.ts`: `window.api ?? createHttpApi()`.
- `platform` in the store (`'electron' | 'web'`), used only by: CSV export
  (dialog vs. download), external links, the MCP settings page (hide the
  stdio section; show "Connect with this URL"), and the About panel.
- New route: `/login`, plus a Settings → Security note. Web-only; the router
  doesn't register them on Electron.
- Bulk-job UI drives `step` on web (a hook that calls it while `running`).

### Build and deploy (Cloudflare)

- `wrangler.jsonc`: `main: src/worker/index.ts`, `assets: { directory:
dist/renderer, not_found_handling: single-page-application }`, one D1
  binding, `triggers.crons`, `compatibility_flags: ["nodejs_compat"]` (for
  `fast-xml-parser`'s Buffer touchpoints; verify in phase 0 whether it's
  even needed).
- `npm run web:build` = renderer Vite build with a `web` mode (no Electron
  aliases; module-preload polyfill back on) + `wrangler deploy` bundling the
  worker. `npm run web:dev` = `wrangler dev` with local D1 + Vite proxy.
- D1 schema via `wrangler d1 migrations` (one migration, the `docs` table).
- **Deploy to Cloudflare button** in the README and on dombot.ai
  (`deploy.workers.cloudflare.com/?url=github.com/aoxborrow/dombot`). It
  forks the repo, provisions the D1 database declared in `wrangler.jsonc`,
  runs the build, and prompts for `DOMBOT_SECRET` and `DOMBOT_PASSWORD` (if
  the deploy flow can't prompt for secrets, `npm run web:secrets` is step 2). Plus a
  `.github/workflows/deploy-worker.yml` for people who'd rather deploy from
  their fork on push (needs `CLOUDFLARE_API_TOKEN` + account id).
- A "Self-host" page on the marketing site with the three steps: click
  deploy, run `npm run web:secrets`, open the URL and log in.

Plan: Workers Free has a 10 ms CPU limit per invocation; a registrar sync
that parses XML for hundreds of domains will likely exceed it. Expect to
document **Workers Paid ($5/month)**, which allows 30 s CPU (raisable to 5
min). Phase 0 measures this.

### Desktop migration

Smaller than it sounds: the FsDocStore names its files after the namespaces
(`cache-portfolio.json`, `folders.json`, `settings.json`,
`registrar-state.json`, `pricing-overrides.json`) and every one of those was
already a `{ key: value }` map, so they load unchanged. The only real
migration is credentials, which used to be one safeStorage-encrypted blob:

1. On first launch, before hydration, `migrateLegacyCredentials()` looks for
   `credentials.dat`. Absent → done.
2. It parses the blob (plaintext first, for the opt-in fallback; else
   safeStorage decrypt) and `put`s each registrar into the `credentials`
   namespace through the encrypting store, so each entry is re-sealed
   individually and stays encrypted throughout.
3. The legacy file is renamed `credentials.dat.pre-v1.bak` (kept for one
   release). If the blob can't be decrypted right now (no keyring available),
   it's left in place and retried next launch — nothing is lost.

Idempotent, and covered by tests that seed a plaintext blob, an encrypted
blob, and an unreadable one.

**Desktop → web transfer** (nice-to-have, phase 6): Settings → Export data
produces a JSON bundle of every namespace, optionally passphrase-encrypted;
the web instance imports it from Settings. Lets a desktop user
move to their own instance without re-entering keys or redoing folders.

### Cloud-agnostic seams

What another host has to supply, and nothing more:

| Seam       | Cloudflare                                        | Vercel (later)                                           | Electron                            |
| ---------- | ------------------------------------------------- | -------------------------------------------------------- | ----------------------------------- |
| `DocStore` | D1                                                | Neon/Postgres or Upstash (same `docs` table)             | JSON files                          |
| Secrets    | `DOMBOT_SECRET` + `DOMBOT_PASSWORD` bindings      | env vars                                                 | safeStorage (no root key, no login) |
| Auth gate  | `password`, or `cloudflare-access` (JWT verified) | `password`, or `external` (Vercel protection)            | none (local user)                   |
| HTTP       | Hono `fetch` handler + static assets              | Hono on Vercel Functions + static                        | `@hono/node-server` (MCP only)      |
| Scheduler  | Cron Trigger → `syncAll()`                        | `vercel.json` cron → `/api/cron/sync` with `CRON_SECRET` | `setInterval`                       |
| Bulk steps | client-driven + `waitUntil`                       | client-driven                                            | self-driven loop                    |

The Worker host is ~300 lines. A Vercel host is the same file with a
different storage import and a cron route.

## Risks and things to verify first

- **Registrar IP allowlists.** Namecheap requires the caller's IP to be
  whitelisted; Dynadot can be configured that way too. Workers egress from
  Cloudflare's shared IP ranges, which aren't fixed per account. Phase 0 tests
  whether whitelisting Cloudflare's published ranges satisfies Namecheap and
  Dynadot. If not, those registrars are documented as desktop-only (or
  "works on Vercel with the static-IP add-on"), and the Settings UI says so
  when `platform === 'web'`.
- **CPU time.** See the Workers Paid note above. Measure a full sync of a
  ~300-domain portfolio under `wrangler dev`.
- **Bulk-job pacing on the web.** Client-driven stepping means a 200-domain
  Porkbun job (10 s spacing) takes ~35 minutes with the tab open. Acceptable
  for v1; `waitUntil` chaining or a Cloudflare Workflow is the upgrade path.
- **MCP stateless mode** drops server-initiated notifications. The tools
  don't use them today; confirm nothing in `tools.ts` relies on
  `sendNotification`.
- **`fast-xml-parser` on workerd** — pure JS, expected fine; confirm.
- **Renderer bundle assumptions.** The Electron build disables the
  module-preload polyfill for CSP reasons; the web build serves from an
  origin and can use a normal CSP header set by the Worker (mirror the
  strict one in `src/main/index.ts`, plus `connect-src 'self'`).

## Phases

Each phase leaves the desktop app shippable. Phases 1–3 are pure refactors
with no user-visible change; they're where most of the risk is retired.

### Phase 0 — Spike (½ day)

Run `@aoxborrow/registrar-client` inside `wrangler dev` against one real
registrar: list domains, fetch a detail, measure CPU time. Try Namecheap
with Cloudflare's IP ranges whitelisted. Verify Access JWT validation. Decide Free vs Paid and the
allowlist story. No code lands.

### Phase 1 — Core extraction + `DocStore`

- Create `src/core`; move `services/*`, `mcp/tools.ts`, `mcp/portfolio-query.ts`,
  `shared/domain-ops.ts` into it. `electron` imports replaced by a `Host`
  object (`store: DocStore`, `secrets`, `now`) passed at startup.
- `FsDocStore`, `EncryptedDocStore` (with a `safeStorage` cipher and an
  AES-GCM cipher), `D1DocStore` (unit-tested against `better-sqlite3` or
  wrangler's local D1).
- `migrateStorage()` with the legacy-file test.
- DNS-over-HTTPS nameserver lookup.
- Exit: desktop app behaves identically; `src/core` has zero `electron`
  imports (enforced by an ESLint `no-restricted-imports` rule).

### Phase 2 — API table + events

- `src/core/api.ts` method table with zod schemas; Electron IPC generated
  from it; the eight `ipc/*.ts` files deleted.
- `meta/revision` + `events(since)` in core; Electron still pushes.
- Exit: same behavior, ~400 fewer lines of hand-written IPC glue.

### Phase 3 — Persisted bulk jobs + `syncAll()`

- Job doc + `stepBulk()`; Electron loops it (`driveBulk`). Cancel via flag.
  A job found still running at launch is closed out as cancelled with an
  "interrupted" message rather than resumed — renew is money, so nothing
  restarts on its own; the results report is the retry surface. (A "Resume
  interrupted job?" prompt can come later.)
- `syncAll(ifOlderThanMs?)` extracted from `auto-sync.ts`.

### Phase 4 — Worker host + web renderer

- `src/worker/index.ts`: Hono app, `D1DocStore` under `EncryptedDocStore`,
  HKDF key derivation, `DOMBOT_AUTH` middleware (password / Access JWT /
  external), `/api/:method`,
  `/api/events`, `scheduled()`, static assets, CSP headers.
- Renderer: `createHttpApi()`, `platform`, login page + security note,
  bulk-step hook, web Vite mode.
- `wrangler.jsonc`, D1 migration, `web:dev` / `web:build` / `web:deploy`
  scripts. CI job that builds the worker and runs `wrangler deploy --dry-run`.
- Exit: a working private instance on a `*.workers.dev` URL.

### Phase 5 — MCP on the web

- Hono MCP routes in core; web-standard transport, stateless; OAuth state in
  `DocStore`; tokens stored by hash. Electron mounts the same routes via
  `@hono/node-server`; Express removed. Desktop `mcp-tokens.json` migrates
  into the `mcp` namespace on first launch.
- Approval page + status endpoint on the Worker; MCP settings page shows the
  remote URL.
- Exit: Claude Desktop / Claude Code connect to `https://<host>/mcp` with the
  same approve-in-app flow.

### Phase 6 — Deploy experience

- Deploy-to-Cloudflare button, `deploy-worker.yml`, "Self-host" page on the
  site, README section, `web:secrets` / `web:rotate-password` /
  `rotate-secret` scripts.
- Export / import data bundle.
- Release: desktop 1.2.0 (with the storage migration) and the first
  web-deployable tag together, since they share the storage layout.

### Later

- Vercel host adapter (Neon + cron route).
- SSE for events; `waitUntil`-chained or Workflow-driven bulk jobs.
- Optional passkey login as a second factor.
