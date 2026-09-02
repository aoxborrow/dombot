# DomBot

**All your domains, from every registrar, in one app + MCP.**

DomBot pulls your whole domain portfolio — scattered across GoDaddy, Dynadot,
Cloudflare, and more — into one desktop app, and serves the same portfolio to
your AI agents through a built-in MCP server. It's free, open source, and
local-first: your data and API keys stay on your machine.

[**dombot.ai**](https://dombot.ai) · macOS · Windows · Linux

## Download & install

Grab the latest build for macOS (Apple Silicon & Intel), Windows, or Linux from
[**dombot.ai**](https://dombot.ai) or the
[**Releases**](https://github.com/aoxborrow/dombot/releases) page.

- **macOS** — signed and notarized; open it like any other app.
- **Windows** — the installer is unsigned, so on first launch SmartScreen may
  appear → **More info** → **Run anyway**.

## What it does

- **One portfolio, every registrar.** Aggregates all your domains across the
  registrars you configure into a single sortable, filterable table — search by
  name, filter by TLD / registrar / nameserver, and see registrar, creation and
  expiry dates, auto-renew, transfer lock, WHOIS privacy, and nameservers side
  by side. Expiry dates are color-coded by urgency, and at-risk domains
  (expired, grace, redemption, hold) get a status badge.
- **Renewal costs at a glance.** A renewals dashboard forecasts your spend:
  yearly total, amount due in the next 90 days, a month-by-month renewal chart,
  and breakdowns by registrar and TLD. Prices come from registrar quotes where
  available and a base per-TLD price database otherwise, and you can enter a
  price by hand for anything still unpriced.
- **Aftermarket values.** Shows Afternic buy-it-now / offer prices (via DomDB)
  next to each domain, so resale value sits alongside carrying cost.
- **Export.** One click exports the current (filtered, sorted) view to a
  spreadsheet-friendly CSV.
- **Safe management actions.** Update nameservers, toggle auto-renew, and
  lock/unlock — deliberately read-only for anything that moves money (no
  register, renew, or transfer).
- **Instant, offline-friendly launch.** The whole portfolio is cached on disk
  and painted the moment the app opens, with no network calls; you refresh on
  demand (it never auto-refreshes) and a timestamp flags when data is going
  stale.
- **Agent-ready.** An embedded local MCP server lets AI agents (Claude Code,
  Claude Desktop, any MCP client) read and manage the same portfolio — see
  [Embedded MCP server](#embedded-mcp-server).

## Why it's useful

Registrars each have their own dashboard, login, and idea of "expiring soon," so
once you're past a handful of names the questions that actually matter — _What's
about to expire? What will I pay this quarter? Which of these auto-renew? Where
are my nameservers pointed?_ — have no single answer. DomBot makes the portfolio
one thing again: a consolidated, always-current view that flags the domains
needing attention before they lapse, turns renewal dates into a spending
forecast, and hands that same control surface to AI agents over MCP.

## Configuring registrars

Registrar credentials are entered once in **Settings → Registrars** and stored
encrypted on the device via Electron `safeStorage` (Keychain on macOS, DPAPI on
Windows) — DomBot never sends them anywhere but the registrar's own API. Each
registrar's required fields come from
[`@aoxborrow/registrar-client`](https://github.com/aoxborrow/registrar-client),
which documents how to obtain an API key for each supported provider.

---

# Development

DomBot is a cross-platform desktop app built with Electron Forge, React 19,
TypeScript (strict), and Vite, styled with Tailwind CSS v4 and Zustand for
state. Registrar API support comes from
[`@aoxborrow/registrar-client`](https://github.com/aoxborrow/registrar-client);
agents connect through an embedded MCP server. Contributions welcome.

## Getting started

```bash
npm install
npm start
```

## Scripts

| Command              | Description                                        |
| -------------------- | -------------------------------------------------- |
| `npm start`          | Run the app with hot reload (Forge + Vite)         |
| `npm run package`    | Package the app into an unpacked bundle            |
| `npm run make`       | Build distributables (zip/deb/rpm/Squirrel)        |
| `npm run lint`       | Lint `.ts`/`.tsx` files                            |
| `npm run format`     | Format the codebase with Prettier                  |
| `npm run typecheck`  | Type-check without emitting                        |
| `npm run site:build` | Minify the landing page (`site/src` → `site/dist`) |

## Project layout

The tree mirrors Electron's process boundary — `main/` (Node backend),
`renderer/` (React frontend), `preload.ts` (the bridge), and `shared/` (the
type-safe contract between them):

```
src/
├─ main/                   # ─── BACKEND (Node process) ───
│  ├─ index.ts             # app lifecycle + window creation (the entry)
│  ├─ ipc/                 # ipcMain handlers, one module per feature area
│  │  ├─ index.ts          #   registerIpcHandlers() — wires them all up
│  │  ├─ app.ts            #   ping, getAppInfo
│  │  └─ registrars.ts     #   listDynadotDomains (thin: calls a service)
│  └─ services/            # real logic, testable without Electron
│     └─ registrars.ts     #   builds & caches RegistrarClient instances
│
├─ preload.ts              # contextBridge — assembles the typed window.api
│                          # (kept separate: its own sandboxed context)
│
├─ renderer/               # ─── FRONTEND (Chromium window, React) ───
│  ├─ main.tsx             # React entry — mounts <App/> in a HashRouter
│  ├─ App.tsx              # layout + routes
│  ├─ index.css            # Tailwind entry
│  ├─ pages/               # route-level screens
│  ├─ components/          # reusable UI
│  └─ store/               # Zustand stores
│
└─ shared/                 # ─── BOTH SIDES ───
   ├─ ipc.ts               # channel names + the DombotApi contract
   └─ window.d.ts          # ambient typing for window.api
```

**How a request flows** (e.g. loading the Dynadot portfolio): renderer calls
`window.api.listDynadotDomains()` → `preload.ts` forwards it over IPC →
`main/ipc/registrars.ts` handles it → `main/services/registrars.ts` calls the
library → the `Domain[]` result travels back to the store, which re-renders.
Handlers stay thin; the logic lives in `services/`.

## The registrar-client dependency

DomBot's registrar logic comes from
[`@aoxborrow/registrar-client`](https://www.npmjs.com/package/@aoxborrow/registrar-client)
([source](https://github.com/aoxborrow/registrar-client)) — a standalone,
provider-agnostic client for many registrar APIs, used in the main process. It's
an ordinary npm dependency, so a plain `npm install` pulls it in (and Vite
bundles it into the main-process build); no alias or link step is required.

To develop DomBot against **unreleased local changes** in the sibling repo at
`../registrar-client`, `npm link` it:

```bash
cd ../registrar-client && npm run build && npm link   # build dist/, register the link
cd -                    && npm link @aoxborrow/registrar-client
```

Rebuild the library (`npm run build`, or `npx tsup --watch` for iteration) to
pick up edits. Return to the published version with
`npm unlink @aoxborrow/registrar-client && npm install`.

### Credentials in development

In production, registrar credentials are entered in **Settings → Registrars**
and stored encrypted via Electron `safeStorage` — see
[`src/main/services/credentials.ts`](src/main/services/credentials.ts). For
local dev, `.env` (git-ignored, loaded via `dotenv`) is used as a fallback: the
resolver prefers a saved value and falls back to `<PROVIDER>_<FIELD>` from the
environment (see [`.env.example`](.env.example)). Either way the same
credentials feed both the UI and the MCP server.

## Embedded MCP server

The app runs a local [MCP](https://modelcontextprotocol.io) server so agents
(Claude Code, Claude Desktop, any MCP client) can manage the portfolio. It's a
third _adapter_ over the same `services/` core the UI uses — see
[`src/main/mcp/`](src/main/mcp).

- **Transport:** Streamable HTTP, bound to `127.0.0.1` only. Never exposed off
  the machine.
- **Auth:** OAuth 2.1 (dynamic client registration + PKCE), served by the app.
  On first connect a browser waiting page opens and **DomBot's own window shows
  an Approve/Deny prompt** (client name + a confirmation code that matches the
  browser page). Approve once and the client is paired; the issued token is
  persisted (`userData/mcp-tokens.json`) so it stays paired across restarts.
  Manage or revoke paired clients in **Settings → MCP Clients**. Env knobs:
  `DOMBOT_MCP_PORT` (default `4123`), `DOMBOT_MCP_ENABLED=0` to disable,
  `DOMBOT_MCP_AUTOAPPROVE=1` to skip the approval prompt (dev/testing),
  `DOMBOT_MCP_TOKEN` for a static bearer token escape hatch (dev/testing). See
  [`src/main/mcp/oauth.ts`](src/main/mcp/oauth.ts).
- **Tools.** Named by scope, so a caller can tell at a glance what a tool acts
  on: `portfolio_*` take no scope params, `registrar_*` require a `registrar`
  id, and `domain_*` require `registrar` + `domain`. `registrar` is always
  required (never resolved from state), so a client can act on a freshly
  registered name that isn't in the cached portfolio yet.
  - _Portfolio:_ `registrar_list`, `portfolio_list` (aggregated across
    configured registrars).
  - _Registrar reads:_ `registrar_test`, `registrar_domains`,
    `registrar_check_availability`, `registrar_pricing`.
  - _Domain reads:_ `domain_get`, `domain_contacts_get`,
    `domain_nameservers_get`, `domain_dns_get`, `domain_email_forwarding_get`,
    `domain_url_forwarding_get`, `domain_renewal_price` (DomBot's own estimate,
    distinct from `registrar_pricing`).
  - _Writes (non-money):_ `domain_nameservers_set`, `domain_dns_set`,
    `domain_contacts_set`, `domain_email_forwarding_set`,
    `domain_url_forwarding_set`, `domain_set_autorenew`, `domain_set_lock`,
    `domain_set_privacy`. Forwarding (email alias and URL redirect) is
    per-registrar — unsupported providers return an error.
  - _Writes (money):_ `registrar_register_domain`, `registrar_transfer_domain`,
    `domain_renew`. Not gated behind extra per-call approval — the
    connection-level OAuth approval is the gate — and annotated non-idempotent.
- **Credentials.** A client is built per registrar from `.env` using each
  provider's `configFields` and the `<PROVIDER>_<FIELD>` naming convention (see
  [`.env.example`](.env.example)). "Configured" means all required vars present.

The URL and a ready-to-paste connect command are shown on the Home screen. To
connect Claude Code (no token needed — approve in the page that opens):

```bash
claude mcp add dombot --transport http http://127.0.0.1:4123/mcp
```

## Architecture notes

- **Security.** The renderer runs with `contextIsolation` and `sandbox` enabled
  and `nodeIntegration` disabled. It reaches the main process only through the
  typed bridge exposed on `window.api`.
- **Typed IPC.** [`src/shared/ipc.ts`](src/shared/ipc.ts) is the single source
  of truth: it defines channel names, payload/return types, and the `DombotApi`
  interface consumed by both the preload script and the renderer. Add a method
  there and both sides are type-checked.
- **Renderer Vite config is `.mts`.** Tailwind v4's Vite plugin is ESM-only, so
  [`vite.renderer.config.mts`](vite.renderer.config.mts) is an ES module while
  the project stays CommonJS.
- **HashRouter.** The packaged app loads over `file://`, where history-based
  routing does not resolve — hash routing avoids that.

## Cutting a release

Binaries are built and published by GitHub Actions
([`.github/workflows/release.yml`](.github/workflows/release.yml)). There are
three ways to run it:

- **Push a version tag** (builds + publishes):
  ```bash
  npm version patch      # or minor / major — commits + creates tag vX.Y.Z
  git push --follow-tags # pushing the tag triggers the release workflow
  ```
- **From the Actions tab** (no terminal): bump the version in `package.json`
  (via a PR), then **Actions → Release → Run workflow**, tick **publish**. It
  tags `v<package.json version>` and publishes (and refuses if that version was
  already released).
- **Validate only**: run the workflow with **publish** left off — it builds and
  uploads the installers as artifacts on the run, without publishing a Release.

The workflow fans out across macOS (arm64 + x64), Windows (x64), and Linux
(x64), runs `npm run make` on each, and uploads the results — `.dmg` + `.zip`
(macOS), `Setup.exe` (Windows), `.deb` + `.rpm` (Linux) — to a draft Release,
which it publishes once all platforms succeed. The `.dmg` is assembled from the
packaged `.app` with `hdiutil` (macOS's built-in tool), sidestepping
`maker-dmg`'s fragile native `appdmg` dependency.

### Code signing

**macOS** builds are Developer ID signed and notarized, so they launch with no
Gatekeeper prompt. Signing activates when these repository secrets are present
(Settings → Secrets and variables → Actions); without them the mac build falls
back to **ad-hoc signed** (valid signature, not notarized) and the signing step
is skipped:

| Secret | What it is |
| ------ | ---------- |
| `MACOS_CERTIFICATE_P12` | Base64 of your **Developer ID Application** cert exported from Keychain as `.p12` (`base64 -i cert.p12 \| pbcopy`) |
| `MACOS_CERTIFICATE_PASSWORD` | Password you set on that `.p12` export |
| `APPLE_SIGNING_IDENTITY` | The identity string, e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_API_KEY_P8` | Base64 of your App Store Connect API key `.p8` (Notary) |
| `APPLE_API_KEY_ID` | The API key's Key ID |
| `APPLE_API_ISSUER` | The API key's Issuer ID |

With those set, the release workflow imports the cert into a temporary keychain,
`forge.config.ts` signs with hardened runtime and notarizes via the Notary API,
and the app is stapled — producing a no-prompt download. Requires an
[Apple Developer Program](https://developer.apple.com/programs/) membership.

**Windows** signing is not wired in; the installer relies on the SmartScreen
workaround. Adding it later (e.g. Azure Trusted Signing) would remove that
prompt.

## License

DomBot is free and open source software: Copyright (C) 2026 Aaron Oxborrow,
licensed under the [GNU Affero General Public License v3.0 or later](LICENSE)
(AGPL-3.0-or-later). You may use, study, share, and modify it; if you distribute
a modified version, it must also be AGPL and ship its source.

Any paid data feeds are a separate, optional add-on service with their own terms
— the app itself is and stays free. The registrar logic in
[`@aoxborrow/registrar-client`](https://github.com/aoxborrow/registrar-client)
is a separate project under the MIT license.
