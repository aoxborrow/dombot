# DomBot

**DomBot is a desktop app for managing a domain portfolio that's spread across
many registrars — from one place.** If you hold names at Dynadot, Namecheap,
GoDaddy, Cloudflare, Gandi, and others, each has its own dashboard, its own
login, and its own idea of what "expiring soon" looks like, so there's no single
view of what you own, what's about to renew, or what it all costs. DomBot pulls
every registrar into one table, one renewal forecast, and one set of controls.

It's a cross-platform desktop app built with **Electron Forge**, **React**,
**TypeScript**, and **Vite**.

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

Domain portfolios sprawl. Once you're past a handful of names across two or
three registrars, the questions that actually matter — _What's about to expire?
What will I pay this quarter? Which of these auto-renew? Where are my nameservers
pointed?_ — have no single answer, because the data lives behind several
dashboards. DomBot's premise is that the portfolio is one thing even when the
registrars aren't: it gives you a consolidated, always-current view, flags the
domains that need attention before they lapse, turns renewal dates into a
spending forecast, and hands that same consolidated control surface to AI agents
over MCP.

## Stack

| Layer    | Choice                                            |
| -------- | ------------------------------------------------- |
| Shell    | Electron 44 + Electron Forge (Vite plugin)        |
| UI       | React 19                                          |
| Language | TypeScript (strict)                               |
| Bundler  | Vite 5                                            |
| Styling  | Tailwind CSS v4 (`@tailwindcss/vite`)             |
| Routing  | React Router (HashRouter)                         |
| State    | Zustand                                           |
| Agents   | Embedded MCP server (`@modelcontextprotocol/sdk`) |
| Tooling  | ESLint + Prettier                                 |

## Getting started

```bash
npm install
npm start
```

## Scripts

| Command             | Description                                     |
| ------------------- | ----------------------------------------------- |
| `npm start`         | Run the app with hot reload (Forge + Vite)      |
| `npm run package`   | Package the app into an unpacked bundle         |
| `npm run make`      | Build distributables (dmg/zip/deb/rpm/squirrel) |
| `npm run lint`      | Lint `.ts`/`.tsx` files                         |
| `npm run format`    | Format the codebase with Prettier               |
| `npm run typecheck` | Type-check without emitting                     |
| `npm run build:site` | Minify the landing page (`site/src` → `site/dist`) |

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

## Local development against registrar-client

DomBot's registrar logic comes from
[`@aoxborrow/registrar-client`](https://github.com/aoxborrow/registrar-client),
developed in the sibling repo at `../registrar-client`. Until that package is
published to npm, DomBot consumes it **directly from source** via a dev-time
alias — no build, watch, or `npm link` step:

- [`vite.main.config.ts`](vite.main.config.ts) aliases the package to
  `../registrar-client/src/index.ts` (the library is used in the main process).
- [`tsconfig.json`](tsconfig.json) has a matching `paths` entry so `tsc` and the
  editor resolve types from source.

The library's own runtime deps resolve from `../registrar-client/node_modules`,
so both repos just need `npm install` run in them. Once the package is on npm,
`npm install @aoxborrow/registrar-client` and remove the alias + `paths` entry.

In production, registrar credentials are entered once in **Settings →
Registrars** and stored encrypted on the device via Electron `safeStorage`
(Keychain/DPAPI) — see [`src/main/services/credentials.ts`](src/main/services/credentials.ts).
For local dev, `.env` (git-ignored, loaded via `dotenv`) is used as a fallback:
the resolver prefers a saved value and falls back to
`<PROVIDER>_<FIELD>` from the environment. Either way the same credentials feed
both the UI and the MCP server.

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
    `domain_nameservers_get`, `domain_dns_get`, `domain_renewal_price`
    (DomBot's own estimate, distinct from `registrar_pricing`).
  - _Writes (non-money):_ `domain_nameservers_set`, `domain_dns_set`,
    `domain_contacts_set`, `domain_set_autorenew`, `domain_set_lock`,
    `domain_set_privacy`.
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
