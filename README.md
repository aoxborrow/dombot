# dombot

Cross-platform desktop app built with **Electron Forge**, **React**, **TypeScript**, and **Vite**.

## Stack

| Layer      | Choice                                          |
| ---------- | ----------------------------------------------- |
| Shell      | Electron 44 + Electron Forge (Vite plugin)      |
| UI         | React 19                                        |
| Language   | TypeScript (strict)                             |
| Bundler    | Vite 5                                          |
| Styling    | Tailwind CSS v4 (`@tailwindcss/vite`)           |
| Routing    | React Router (HashRouter)                       |
| State      | Zustand                                         |
| Tooling    | ESLint + Prettier                               |

## Getting started

```bash
npm install
npm start
```

## Scripts

| Command             | Description                                        |
| ------------------- | -------------------------------------------------- |
| `npm start`         | Run the app with hot reload (Forge + Vite)         |
| `npm run package`   | Package the app into an unpacked bundle            |
| `npm run make`      | Build distributables (dmg/zip/deb/rpm/squirrel)    |
| `npm run lint`      | Lint `.ts`/`.tsx` files                            |
| `npm run format`    | Format the codebase with Prettier                  |
| `npm run typecheck` | Type-check without emitting                        |

## Project layout

```
src/
├─ main.ts              # Main process: window creation, app lifecycle
├─ ipc.ts               # Main-process ipcMain handlers
├─ preload.ts           # contextBridge — exposes the typed window.api
├─ shared/
│  ├─ ipc.ts            # Shared IPC contract (channels + types)
│  └─ window.d.ts       # Ambient typing for window.api
└─ renderer/            # React app (renderer process)
   ├─ main.tsx          # React entry — mounts <App/> in a HashRouter
   ├─ App.tsx           # Layout + routes
   ├─ index.css         # Tailwind entry
   ├─ pages/            # Route components
   └─ store/            # Zustand stores
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
