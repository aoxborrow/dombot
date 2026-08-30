# dombot

Cross-platform desktop app built with **Electron Forge**, **React**, **TypeScript**, and **Vite**.

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

dombot's registrar logic comes from
[`@aoxborrow/registrar-client`](https://github.com/aoxborrow/registrar-client),
developed in the sibling repo at `../registrar-client`. Until that package is
published to npm, dombot consumes it **directly from source** via a dev-time
alias — no build, watch, or `npm link` step:

- [`vite.main.config.ts`](vite.main.config.ts) aliases the package to
  `../registrar-client/src/index.ts` (the library is used in the main process).
- [`tsconfig.json`](tsconfig.json) has a matching `paths` entry so `tsc` and the
  editor resolve types from source.

The library's own runtime deps resolve from `../registrar-client/node_modules`,
so both repos just need `npm install` run in them. Once the package is on npm,
`npm install @aoxborrow/registrar-client` and remove the alias + `paths` entry.

Registrar credentials are read from `.env` (git-ignored) by the main process via
`dotenv`. The Dynadot demo on the Home page needs `DYNADOT_API_KEY` and
`DYNADOT_API_SECRET`.

## Embedded MCP server

The app runs a local [MCP](https://modelcontextprotocol.io) server so agents
(Claude Code, Claude Desktop, any MCP client) can manage the portfolio. It's a
third _adapter_ over the same `services/` core the UI uses — see
[`src/main/mcp/`](src/main/mcp).

- **Transport:** Streamable HTTP, bound to `127.0.0.1` only. Never exposed off
  the machine.
- **Auth:** a single bearer token (one authorization → full access). Pinnable in
  dev via `DOMBOT_MCP_TOKEN`; the port via `DOMBOT_MCP_PORT` (default `4123`).
  Disable the server with `DOMBOT_MCP_ENABLED=0`.
- **Tools (read-only for now):** `list_domains`, `check_availability`,
  `get_dns_records`. Mutating/money-moving tools are intentionally omitted.

The URL, token, and a ready-to-paste connect command are shown on the Home
screen. To connect Claude Code:

```bash
claude mcp add dombot --transport http http://127.0.0.1:4123/mcp \
  --header "Authorization: Bearer <token-from-the-app>"
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
