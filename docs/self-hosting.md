# Self-hosting DomBot on Cloudflare

Run your own private DomBot in the browser: the same app as the desktop
build, served by a Cloudflare Worker with your data in a D1 database,
encrypted under a key only you hold. Two Cloudflare products, two secrets,
no other services. (Design notes: [web-deployment.md](web-deployment.md).)

## The one-click way

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aoxborrow/dombot)

The button forks this repository into your GitHub account, creates the D1
database, and prompts for the two secrets:

- `DOMBOT_SECRET` — the root key. Everything in D1 is encrypted under it.
  Generate it with `openssl rand -base64 32`. Lose it and the instance's data
  is unreadable; there is no recovery, so keep it in your password manager.
- `DOMBOT_PASSWORD` — your login password. Same command, or one of your own.

It then builds and deploys. Open the URL it gives you and sign in. Your fork
also gets a workflow (below) that redeploys on push once you add a Cloudflare
API token to it, so updating is `git pull upstream main && git push`.

## The CLI way

You need a Cloudflare account (the free plan runs the app; a full sync of a
large portfolio may need **Workers Paid**, $5/month, for the extra CPU time —
see [Limits](#limits)), Node 22+, and this repository cloned or forked.

```bash
npm ci
npx wrangler login
npx wrangler d1 create dombot
```

Put the `database_id` the last command prints, and a name for your Worker,
in a `wrangler.local.json` next to `wrangler.jsonc`:

```json
{
  "name": "dombot-yourname",
  "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

That file is gitignored. Every `npm run web:*` script applies it on top of
the template (`scripts/wrangler.mjs`), so your instance's details never land
in a commit and pulling updates never conflicts. It also accepts `vars`,
`routes` (for a custom domain), and any other top-level wrangler key. If you
would rather edit `wrangler.jsonc` directly, that still works. Then:

```bash
npm run web:secrets
```

That generates and applies the two secrets and prints them **once** — put
them in your password manager:

- `DOMBOT_SECRET` — the root key. Everything in D1 is encrypted under it.
  Lose it and the instance's data is unreadable; there is no recovery.
- `DOMBOT_PASSWORD` — your login password.

Finally:

```bash
npm run web:deploy
```

This builds the renderer, applies the D1 schema, and deploys the Worker.
Open the URL it prints and sign in.

## Redeploying automatically

Two ways to have your instance follow a branch. Neither touches
`DOMBOT_SECRET` / `DOMBOT_PASSWORD`; those stay Worker secrets.

**Workers Builds (no token).** In the Cloudflare dashboard open your Worker
→ Settings → Builds, connect the repository (yours or a fork) and the branch
to follow, and set:

| Setting        | Value            |
| -------------- | ---------------- |
| Build command  | `npm run build`  |
| Deploy command | `npm run deploy` |

plus these build variables, which stand in for the `wrangler.local.json` a
build machine doesn't have:

| Variable                        | Value                                                             |
| ------------------------------- | ----------------------------------------------------------------- |
| `DOMBOT_WORKER_NAME`            | your Worker's name                                                |
| `DOMBOT_D1_DATABASE_ID`         | your D1 database id                                               |
| `DOMBOT_D1_DATABASE_NAME`       | its name, if not `dombot`                                         |
| `DOMBOT_CUSTOM_DOMAIN`          | optional: your own hostname, on a zone in your Cloudflare account |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1` (skips a large download)                                      |

`npm run deploy` applies any new D1 migrations and then deploys. The
dashboard may warn that the repository's `wrangler.jsonc` names a different
Worker; that's the public template, and the deploy uses your name. Don't
merge a pull request that offers to rename it.

**GitHub Actions.** `.github/workflows/deploy-worker.yml` deploys on every
push to `main` of _your_ fork, once two repository secrets exist (Settings →
Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN` (an API token from
the "Edit Cloudflare Workers" template with D1 edit permission added) and
`CLOUDFLARE_ACCOUNT_ID`. Without them the workflow exits quietly. Set the
same `DOMBOT_WORKER_NAME` / `DOMBOT_D1_DATABASE_ID` (and optionally
`DOMBOT_D1_DATABASE_NAME` / `DOMBOT_CUSTOM_DOMAIN`) values as repository
_variables_ so the deploy targets your Worker and database.

## Day to day

- **Sync** runs from an hourly cron. It only does work when the cache is
  older than the interval in Settings → Sync, so that setting is what
  decides the real cadence. "Off" disables it.
- **Forgot the password?** Rotate it; every session is signed out:

  ```bash
  npm run web:rotate-password
  ```

  To choose your own instead of a generated one:

  ```bash
  DOMBOT_PASSWORD='something-long' npm run web:rotate-password
  ```

- **Brute-force protection**: each source IP gets at most 10 attempts per
  15-minute window. D1 reserves attempts atomically across isolates; another
  source's failures cannot lock out your login. Successful login resets your
  source's window. Apply migration `0002_login_attempts.sql` before upgrading
  (the deploy script applies migrations). Source addresses are stored as HMACs,
  not raw IPs. Cloudflare's `CF-Connecting-IP` header is required outside local
  development. Use a long random password; distributed attackers still warrant
  an additional edge rate-limit rule or Cloudflare Access restricted to you.
- **Updating**: pull, then `npm run web:deploy` again (or push, with the
  workflow above).
- **Backups and moving**: Settings → Sync → **Export data** writes everything
  (registrar keys, portfolio, folders, prices, settings, MCP pairings) to one
  JSON file, optionally sealed with a passphrase (in your browser, so the
  passphrase never leaves it); **Import data** replaces the
  instance's contents with a file. This is how you move from the desktop app
  to your instance, and the only backup for data whose key you could lose.
- **Rotating the root key**: `DOMBOT_SECRET` can't simply be replaced — the
  data is encrypted under it. `DOMBOT_URL=https://<your-host> npm run
web:rotate-secret` exports a sealed bundle to disk, sets a new secret, and
  imports the bundle back (password login only; behind a gate, do the same
  three steps by hand).
- **Bulk jobs** are stepped by your browser tab. Closing the tab pauses a
  running job; reopening resumes it. A job interrupted mid-request shows
  those items as "outcome unknown" rather than re-running them.

## Using Cloudflare Access or another gate instead of the password

Set `DOMBOT_AUTH` in `wrangler.jsonc` (`vars`):

- `password` (default) — the built-in login above.
- `cloudflare-access` — put the Worker behind a Cloudflare Access
  application, then set `CF_ACCESS_TEAM_DOMAIN`
  (`https://<team>.cloudflareaccess.com`) and `CF_ACCESS_AUD` (the
  application's audience tag). The Worker verifies the Access JWT on every
  request; `DOMBOT_PASSWORD` is unused.
- `external` — you've put your own gate in front (a reverse proxy, a
  platform's password protection). The app runs with **no login of its
  own**. Only choose this if the gate is really there.

MCP clients can't pass an Access login or a password prompt. Behind a gate,
MCP works only if the gate excludes the MCP paths (`/mcp`, `/authorize`,
`/token`, `/register`, `/revoke`, `/oauth/status`, `/.well-known/*`), which
Cloudflare Access can do and platform password protection generally can't.

Version preview URLs are disabled by default (`preview_urls: false`) so a gate
configured for the production hostname cannot be bypassed through a preview
hostname. If you enable previews, protect those hostnames separately as well.

## Connecting an MCP client

Your instance is a remote MCP server at `https://<your-host>/mcp`, off by
default. Turn it on in **Settings → MCP**, then add it to a client, e.g.:

```bash
claude mcp add dombot --transport http https://<your-host>/mcp
```

The first connection opens a browser page showing a short code; the same
code appears in DomBot (keep a tab open) — approve it there and the client
is paired until you revoke it on the same settings page. Pairing uses OAuth
2.1 with PKCE; the endpoint accepts nothing else, and nothing about a
pairing is stored except a hash of its token. Claude Desktop, Claude Code,
and other clients that speak remote MCP with OAuth work as-is; the desktop
app's stdio bridge isn't needed (or available) here.

## Local development

```bash
npm run web:migrate:local        # once: create the local D1 schema
printf 'DOMBOT_SECRET=%s\nDOMBOT_PASSWORD=dev\n' "$(openssl rand -base64 32)" > .dev.vars
npm run web:dev                  # builds the renderer, runs wrangler dev
```

Open http://localhost:8787. `curl "http://localhost:8787/cdn-cgi/local/scheduled"`
fires the cron by hand.

## Limits

- Workers Free allows 10 ms of CPU per request. Listing a few hundred
  domains across several registrars (with XML parsing) can exceed it; if
  Sync fails with a CPU-limit error, move to Workers Paid.
- Some registrars require API calls to come from allow-listed IP addresses
  (Namecheap always; Dynadot optionally). A Worker's outbound IP isn't
  fixed, so those registrars may not work from a hosted instance. They
  keep working in the desktop app.

## What's stored where

|                                                                        | Where                                               | Encrypted                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| Registrar API keys, portfolio cache, folders, settings, bulk-job state | D1 `docs` table                                     | Yes — AES-256-GCM under a key derived from `DOMBOT_SECRET` |
| `DOMBOT_SECRET`, `DOMBOT_PASSWORD`                                     | Worker secrets                                      | Cloudflare-managed; write-only                             |
| Your login session                                                     | An HttpOnly, SameSite=Strict cookie in your browser | Signed with a key derived from both secrets                |

Nothing about authentication is stored in the database. Rotating the
password invalidates every session because the session-signing key is
derived from it.

## Optional fixed IP proxy for Namecheap

When configuring Namecheap in **Settings → Registrars**, turn on **Use fixed IP
proxy** if the machine running DomBot cannot connect from an allowlisted IPv4
address. Enter:

- **Proxy URL:** an HTTP or HTTPS CONNECT proxy, as
  `http://username:password@host:port` or `https://username:password@host:port`,
  percent-encoding special characters in the username or password. The host may
  be a hostname or a public IPv4 address; credentials are optional. With an
  HTTPS proxy the connection to the proxy itself is encrypted and its
  certificate is verified against the hostname, so use a hostname there rather
  than a bare IP. With an HTTP proxy the username and password travel
  unencrypted to the proxy (the Namecheap request inside the tunnel is still
  HTTPS). IPv6 literals, private/reserved IPv4 addresses, `localhost`, SOCKS
  URLs, paths and query strings are rejected.
- **Outgoing IPv4 address:** the IP Namecheap sees, which may differ from the
  proxy endpoint. Add it to your Namecheap API allowlist before syncing.

Save starts the normal sync. This connection is used by all Namecheap operations,
including scheduled sync and MCP. Other registrars keep their normal connections.
Proxy failure never silently switches to a direct request.

The proxy fields are stored with the Namecheap credentials under the existing
host encryption scheme and included in data exports. A plain export therefore
contains proxy credentials too; use the export passphrase option when appropriate.
The saved direct Client IP is retained separately. Turn the proxy switch off and
save to remove the proxy credentials and restore direct configuration. If the
account was first configured with a proxy, enter a direct Client IP before saving
in direct mode.

### Transport limitations and security review

Workers use pinned `tunnelfetch` 1.13.0 with certificate verification enabled,
redirects unfollowed, bounded timeouts and a 2 MiB decoded-response limit. A new
client is closed after every request so no open socket crosses Worker invocation
boundaries. Native Workers `startTls` cannot verify a different destination after
an HTTP CONNECT tunnel. `tunnelfetch` implements TLS 1.2/1.3 and certificate
validation in JavaScript/WebCrypto; its authors state that it has not had an
external security audit. This opt-in feature requires review of that additional
trust boundary and may need Workers Paid for the additional CPU cost.

Desktop uses `https-proxy-agent` with Node's native TLS verification. An HTTPS
proxy URL encrypts the CONNECT handshake, including any proxy password; a
separate verified TLS connection protects Namecheap traffic inside the tunnel
either way. No setting disables certificate verification. On the Worker,
Cloudflare additionally blocks outbound sockets to private network ranges
whatever the proxy hostname resolves to.

Only Namecheap's production API is reachable through this transport. Namecheap
uses GET for writes as well as reads, so retries use an explicit read-command
allowlist. Writes, renewals and unknown commands are never automatically replayed.
After an uncertain write failure, check the outcome in Namecheap before retrying.
Provider error codes are shown without raw response bodies or credential-bearing
request URLs.

References: [Namecheap API parameters](https://www.namecheap.com/support/api/global-parameters/),
[Cloudflare sockets implementation](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/sockets.c++),
[tunnelfetch security and maturity](https://github.com/latentharbor/tunnelfetch#readme).
