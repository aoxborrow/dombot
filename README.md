# DomBot

[![Latest release](https://img.shields.io/github/v/release/aoxborrow/dombot?label=release)](https://github.com/aoxborrow/dombot/releases/latest)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE)

**All your domains, from every registrar, in one app + MCP.**

DomBot pulls your whole domain portfolio — scattered across GoDaddy, Dynadot,
Cloudflare, and more — into one desktop app, and serves the same portfolio to
your AI agents through a built-in MCP server. It's free, open source, and
local-first: your data and API keys stay on your machine.

**Download** for macOS, Windows, or Linux from
[**dombot.ai**](https://dombot.ai) or the
[Releases](https://github.com/aoxborrow/dombot/releases) page.

<a href="site/public/dombot-domains.png"><img src="site/public/dombot-domains.png" alt="DomBot's Domains screen — every domain across all your registrars in one sortable, filterable table" width="720"></a>

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
- **Export.** One click exports the current (filtered, sorted) view to a
  spreadsheet-friendly CSV.
- **Instant, offline-friendly launch.** The whole portfolio is cached on disk
  and painted the moment the app opens, with no network calls; you refresh on
  demand (it never auto-refreshes) and a timestamp flags when data is going
  stale.
- **Agent-ready.** An embedded local MCP server lets AI agents (Claude Code,
  Claude Desktop, any MCP client) read and manage the same portfolio — see
  [Connecting an AI agent](#connecting-an-ai-agent).

## Configuring registrars

DomBot currently supports **GoDaddy, Cloudflare, Dynadot, NameSilo, Spaceship,
Namecheap, Porkbun, Gandi, and NameBright**, with more on the way.

Add each registrar in **Settings → Registrars** with an API key from that
provider's account — DomBot shows where to find each one. Credentials are stored
encrypted on your device via your OS keychain (Electron `safeStorage`) and are
never sent anywhere but the registrar's own API.

## Connecting an AI agent

DomBot runs a local [MCP](https://modelcontextprotocol.io) server, bound to
your machine only, so any MCP client can work with your portfolio. To connect
Claude Code:

```bash
claude mcp add dombot --transport http http://127.0.0.1:4123/mcp
```

On first connect a browser page opens and DomBot's own window shows an
Approve/Deny prompt with a matching confirmation code. Approve once and the
client stays paired across restarts; manage or revoke paired clients in
**Settings → MCP Clients**. The URL and a ready-to-paste connect command are
also shown on the Home screen.

**Claude Desktop** (and other clients that can only launch a command) use the
app itself as a stdio server. Copy the ready-made entry from **Settings → MCP**
into `claude_desktop_config.json`; it looks like:

```json
{
  "mcpServers": {
    "dombot": {
      "command": "/Applications/DomBot.app/Contents/MacOS/DomBot",
      "args": ["--mcp-stdio"]
    }
  }
}
```

No approval prompt is needed for this route — it runs as you, on your machine —
and if DomBot isn't open when the client starts, it launches automatically.

---

# Development

DomBot is a cross-platform desktop app built with Electron Forge, React 19,
TypeScript (strict), and Vite, styled with Tailwind CSS v4 and Zustand for
state. Registrar API support comes from
[`@aoxborrow/registrar-client`](https://github.com/aoxborrow/registrar-client);
agents connect through an embedded MCP server. Contributions welcome — clone
the repo, `npm install`, and `npm start` to run the app with hot reload.

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

## Credentials in development

In production, registrar credentials are entered in **Settings → Registrars**
and stored encrypted via Electron `safeStorage` — see
[`src/main/services/credentials.ts`](src/main/services/credentials.ts). For
local dev, `.env` (git-ignored, loaded via `dotenv`) is used as a fallback: the
resolver prefers a saved value and falls back to `<PROVIDER>_<FIELD>` from the
environment (see [`.env.example`](.env.example)). Either way the same
credentials feed both the UI and the MCP server.

## Embedded MCP server

The MCP server (see [Connecting an AI agent](#connecting-an-ai-agent)) is a
third _adapter_ over the same `services/` core the UI uses — see
[`src/main/mcp/`](src/main/mcp).

- **Transport:** Streamable HTTP, bound to `127.0.0.1` only. Never exposed off
  the machine.
- **Auth:** OAuth 2.1 (dynamic client registration + PKCE), served by the app.
  The approval prompt lives in DomBot's own window; the issued token is
  persisted (`userData/mcp-tokens.json`) so clients stay paired across
  restarts. Env knobs: `DOMBOT_MCP_PORT` (default `4123`),
  `DOMBOT_MCP_ENABLED=0` to disable, `DOMBOT_MCP_AUTOAPPROVE=1` to skip the
  approval prompt (dev/testing), `DOMBOT_MCP_TOKEN` for a static bearer token
  escape hatch (dev/testing). See
  [`src/main/mcp/oauth.ts`](src/main/mcp/oauth.ts).
- **stdio shim.** `DomBot --mcp-stdio` runs the same binary headless as a
  stdin/stdout bridge to the HTTP server, for clients that can't dial a URL
  (Claude Desktop). It authenticates with a per-install token the app writes to
  `userData/mcp-stdio.json`, launches the app if it isn't running, and
  re-initializes its session transparently if the app restarts. stdout is the
  JSON-RPC channel, so all logging in that mode goes to stderr. See
  [`src/main/mcp/stdio.ts`](src/main/mcp/stdio.ts). Dev builds aren't
  auto-launched — start the app first.
- **Tools.** Named by scope, so a caller can tell at a glance what a tool acts
  on: `portfolio_*` take no scope params, `registrar_*` require a `registrar`
  id, and `domain_*` require `registrar` + `domain`. `registrar` is always
  required (never resolved from state), so a client can act on a freshly
  registered name that isn't in the cached portfolio yet.
  - _Portfolio:_ `registrar_list`, `portfolio_query`, and `portfolio_sync`.
    `portfolio_query` is the primary way to read the portfolio: list, search,
    filter, sort, and page the cached portfolio (by registrar, TLD, folder,
    name, nameserver, auto-renew/lock/privacy, status, and expiry), returning
    only the fields an agent needs plus sync health (`total`, `stale`, and
    per-registrar `errors`). With no filters it returns everything (paged), so
    it doubles as a plain list. It's a pure cache read (no registrar calls);
    `portfolio_sync` runs the live cross-registrar pass that refreshes the
    cache, returning a per-registrar summary. An agent syncs once (or when
    `portfolio_query` reports `stale`/empty), then reads cheaply.
  - _Registrar reads:_ `registrar_test`, `registrar_domains`, `registrar_sync`
    (targeted single-registrar refresh of the cache),
    `registrar_check_availability`, `registrar_pricing`.
  - _Domain reads:_ `domain_get`, `domain_contacts_get`,
    `domain_nameservers_get`, `domain_dns_get`, `domain_email_forwarding_get`,
    `domain_url_forwarding_get`, `domain_renewal_price` (DomBot's own estimate,
    distinct from `registrar_pricing`). `domain_get` and
    `domain_nameservers_get` serve from the detail cache when fresh, fetch live
    and write through otherwise, and take `refresh` to force a live fetch.
  - _Writes (non-money):_ `domain_nameservers_set`, `domain_dns_set`,
    `domain_contacts_set`, `domain_email_forwarding_set`,
    `domain_url_forwarding_set`, `domain_set_autorenew`, `domain_set_lock`,
    `domain_set_privacy`. Forwarding (email alias and URL redirect) is
    per-registrar — unsupported providers return an error.
  - _Writes (money):_ `registrar_register_domain`, `registrar_transfer_domain`,
    `domain_renew`. Not gated behind extra per-call approval — the
    connection-level OAuth approval is the gate — and annotated non-idempotent.
  - _Cache write-through._ A successful write patches the local cache (the same
    cache the desktop UI reads) and pushes an update to any open window, so the
    Domains table reflects the change live — no manual Sync needed.
  - _Cache freshness._ Reads serve the local cache and report `stale` /
    `fetchedAt`; an agent refreshes explicitly with `portfolio_sync` /
    `registrar_sync`. The app also runs a periodic background sync so the cache
    stays warm for MCP-only use (no window ever opened) —
    `DOMBOT_SYNC_INTERVAL_MINUTES` (default `1440`, i.e. 24h; `0` disables).
- **Credentials.** Resolved the same way as the UI (see
  [Credentials in development](#credentials-in-development)); a registrar is
  "configured" when all of its required fields are present.

## License

DomBot is free and open source software: Copyright (C) 2026 Aaron Oxborrow,
licensed under the [GNU Affero General Public License v3.0 or later](LICENSE)
(AGPL-3.0-or-later). You may use, study, share, and modify it; if you distribute
a modified version, it must also be AGPL and ship its source.

Any paid data feeds are a separate, optional add-on service with their own terms
— the app itself is and stays free. The registrar logic in
[`@aoxborrow/registrar-client`](https://github.com/aoxborrow/registrar-client)
is a separate project under the MIT license.
