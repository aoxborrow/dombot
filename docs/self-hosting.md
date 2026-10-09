# Self-hosting DomBot on Cloudflare

Run your own private DomBot in the browser: the same app as the desktop
build, served by a Cloudflare Worker with your data in a D1 database,
encrypted under a key only you hold. Two Cloudflare products, two secrets,
no other services. (Design notes: [web-deployment.md](web-deployment.md).)

## Choosing a setup

| Setup                                                               | Getting started            | Updating                                       |
| ------------------------------------------------------------------- | -------------------------- | ---------------------------------------------- |
| [Fork + Cloudflare dashboard](#recommended-fork-it-then-connect-it) | a few minutes, no terminal | **Sync fork** on GitHub; Cloudflare redeploys  |
| [Deploy button](#the-deploy-button)                                 | fastest, one page          | trickier, needs git once — **not recommended** |
| [CLI](#the-cli-way)                                                 | a terminal and Node 22.13+ | `git pull`, `npm run web:deploy`               |

All three run the same app on the same two Cloudflare products. You need a
Cloudflare account (the free plan runs the app; a full sync of a large
portfolio may need **Workers Paid**, $5/month, for the extra CPU time — see
[Limits](#limits)).

Whichever you pick, you'll set two secrets:

- `DOMBOT_SECRET` — the root key. Everything in D1 is encrypted under it.
  Generate it with `openssl rand -base64 32`. Lose it and the instance's data
  is unreadable; there is no recovery, so keep it in your password manager.
- `DOMBOT_PASSWORD` — your login password. Same command, or one of your own.

## Recommended: fork it, then connect it

1. **Fork** [aoxborrow/dombot](https://github.com/aoxborrow/dombot) on GitHub.
   GitHub keeps forks of a public repository public; nothing of yours goes in
   it — the secrets live in Cloudflare and your data in D1.
2. **Create the database.** In the Cloudflare dashboard: Storage & databases →
   D1 SQLite Database → Create, name it `dombot`, and copy its database ID.
3. **Create the Worker from your fork.** Workers & Pages → Create application
   → Continue with GitHub, pick your fork, choose a name for your Worker
   (e.g. `dombot-yourname`), and set:

   | Setting        | Value            |
   | -------------- | ---------------- |
   | Build command  | `npm run build`  |
   | Deploy command | `npm run deploy` |

   plus these build variables, which tell the deploy which Worker and database
   are yours:

   | Variable                        | Value                                                             |
   | ------------------------------- | ----------------------------------------------------------------- |
   | `DOMBOT_WORKER_NAME`            | your Worker's name                                                |
   | `DOMBOT_D1_DATABASE_ID`         | the database ID from step 2                                       |
   | `DOMBOT_D1_DATABASE_NAME`       | its name, if not `dombot`                                         |
   | `DOMBOT_CUSTOM_DOMAIN`          | optional: your own hostname, on a zone in your Cloudflare account |
   | `ELECTRON_SKIP_BINARY_DOWNLOAD` | `1` (skips a large download)                                      |

   The dashboard may warn that the repository's `wrangler.jsonc` names a
   different Worker; that's the public template, and the deploy uses your
   name. Don't merge a pull request that offers to rename it.

4. **Add the two secrets.** Your Worker → Settings → Variables and secrets →
   Add, type **Secret**: `DOMBOT_SECRET` and `DOMBOT_PASSWORD` (see above).
5. Open the Worker's URL and sign in.

**Updating:** on your fork's GitHub page, **Sync fork → Update branch**.
Cloudflare builds the new commit and `npm run deploy` applies any new D1
migrations before it deploys. Your instance's details are build variables, not
edits to the code, so syncing never conflicts.

## The Deploy button

Fastest to start, but updates are trickier, so it isn't the recommended route.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aoxborrow/dombot)

On one page it creates a repository in your GitHub account, the D1 database,
and the Worker, and asks for the two secrets. Leave `DOMBOT_AUTH` as
`password` (to use Cloudflare Access instead, see
[below](#using-cloudflare-access-instead-of-the-password)).

What it creates is a **copy, not a fork**: one "source repo import" commit
with none of this repository's history and without its `.github/workflows`,
plus your Worker name and database ID written into `wrangler.jsonc` (and the
name into `package.json`). So there's no **Sync fork** button, and a plain
`git pull` from this repository is refused ("unrelated histories").

Don't press the button again to update: it always makes a new instance.

**Updating, once, by hand.** This joins your copy to this repository's history
and moves your instance's details into build variables, after which updates
are a plain pull:

1. In Cloudflare, your Worker → Settings → Builds → Variables, add
   `DOMBOT_WORKER_NAME` (your Worker's name), `DOMBOT_D1_DATABASE_ID` and
   `DOMBOT_D1_DATABASE_NAME` (both in your `wrangler.jsonc`).
2. Then:

   ```bash
   git clone https://github.com/<you>/<your-repo> && cd <your-repo>
   git remote add upstream https://github.com/aoxborrow/dombot
   git fetch upstream
   git merge --allow-unrelated-histories upstream/main
   git checkout --theirs package.json wrangler.jsonc   # the template again
   git add -A && git commit -m "Join upstream history"
   git push
   ```

   The push brings this repository's workflows along, so your git credentials
   must be allowed to change workflow files (`gh auth login` grants that).

From then on, update with `git pull upstream main && git push`. Cloudflare
redeploys on every push, and your data stays where it is.

## The CLI way

You need Node 22.13+ and this repository cloned or forked.

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
them in your password manager. Finally:

```bash
npm run web:deploy
```

This builds the renderer, applies the D1 schema, and deploys the Worker.
Open the URL it prints and sign in.

**Updating:** `git pull`, then `npm run web:deploy` again.

**Deploying from GitHub Actions instead.** `.github/workflows/deploy-worker.yml`
deploys on every push to `main` of _your_ fork, once two repository secrets
exist (Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN` (an
API token from the "Edit Cloudflare Workers" template with D1 edit permission
added) and `CLOUDFLARE_ACCOUNT_ID`. Without them the workflow exits quietly.
Set the same `DOMBOT_WORKER_NAME` / `DOMBOT_D1_DATABASE_ID` (and optionally
`DOMBOT_D1_DATABASE_NAME` / `DOMBOT_CUSTOM_DOMAIN`, and the
[Access](#using-cloudflare-access-instead-of-the-password) variables) values as
repository _variables_ so the deploy targets your Worker and database. Don't use it
alongside Cloudflare's own builds, or every push deploys twice.

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
- **Updating** depends on how you set up: see
  [fork](#recommended-fork-it-then-connect-it),
  [Deploy button](#the-deploy-button) or [CLI](#the-cli-way).
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

## Using Cloudflare Access instead of the password

1. **Put the Worker behind Access.** Your Worker → **Access** → **Protect this
   Worker behind Access**, scope **All traffic**, and a policy such as
   **Cloudflare account** (members of your Cloudflare account). This needs no
   Zero Trust plan. The page then shows the application's **AUD tag** and a
   JWKS URL, `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.
2. **Switch DomBot to it** with three values:

   | Variable                | Value                                 |
   | ----------------------- | ------------------------------------- |
   | `DOMBOT_AUTH`           | `cloudflare-access`                   |
   | `CF_ACCESS_TEAM_DOMAIN` | `https://<team>.cloudflareaccess.com` |
   | `CF_ACCESS_AUD`         | the AUD tag                           |

   Set them where your other instance details live: build variables for a
   fork (or a Deploy-button copy you've joined), repository variables for the
   GitHub Actions deploy, `vars` in `wrangler.local.json` for the CLI. Then redeploy. Setting them on the
   Worker's own Variables page doesn't stick: the next deploy replaces them.

DomBot then verifies the Access token on every request, and `DOMBOT_PASSWORD`
is unused.

**MCP behind Access.** MCP clients can't sign in to Access, so the MCP paths
have to skip it. That needs a second Access application covering just those
paths, which Cloudflare only offers once Zero Trust is set up (the free plan
is enough):

1. Zero Trust → Access controls → Applications → Create new application →
   Self-hosted.
2. Under Public hostnames, add one destination per path on your instance's
   host: `/mcp`, `/authorize`, `/token`, `/register`, `/revoke`,
   `/oauth/status` and `/.well-known/*`. For a `workers.dev` address, use
   **Switch to custom input** and enter `<host>/<path>`.
3. Add a policy with action **Bypass** and include **Everyone**, then save.

Cloudflare checks this path-specific application before the Worker-wide one,
so everything else stays behind Access. The paths aren't left open: they
answer only to DomBot's own MCP sign-in, and stay off until you turn MCP on.
Approving a pairing happens inside DomBot, behind Access as usual.

**Another gate.** Set `DOMBOT_AUTH` to `external` if you've put your own gate
in front (a reverse proxy, a platform's password protection). The app then
runs with **no login of its own**, so only choose this if the gate is really
there. Most such gates can't exempt the MCP paths.

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

## Optional fixed IP proxy

Some registrars only accept API requests from an address you have allowlisted.
If the machine running DomBot has no fixed address of its own, which is always
true of a Worker, send those requests through a proxy that does. It works the
same in the desktop app and on a self-hosted instance, so one proxy account and
one allowlisted address can serve both.

**1. Set the proxy up once, under Settings → Proxy.**

- **Proxy URL:** an HTTP or HTTPS CONNECT proxy, as
  `http://username:password@host:port` or `https://username:password@host:port`,
  percent-encoding special characters in the username or password. The host may
  be a hostname or a public IPv4 address; credentials are optional. With an
  HTTPS proxy the connection to the proxy itself is encrypted and its
  certificate is verified against the hostname, so use a hostname there rather
  than a bare IP. With an HTTP proxy the username and password travel
  unencrypted to the proxy (the registrar request inside the tunnel is still
  HTTPS). IPv6 literals, private/reserved IPv4 addresses, `localhost`, SOCKS
  URLs, paths and query strings are rejected.
- **Outgoing IPv4 address:** the address registrars see, which may differ from
  the proxy endpoint. Add it to each registrar's API allowlist.
- **Test** sends one request through the proxy and reports the address it left
  from, so a wrong outgoing address shows up here rather than as a registrar
  rejection. It checks the values in the form, saved or not.

**2. Turn on “Use fixed IP proxy” for each account that needs it**, in that
account's card under Settings → Registrars. It works for every registrar.
Saving re-syncs the account over the new route. For Namecheap, the
proxy's outgoing address replaces the Client IP, so an account that only ever
connects through the proxy needs no Client IP of its own. A Client IP you did
enter is kept, and is used again if you turn the toggle off.

The route applies to everything that account does, including scheduled sync and
MCP. Accounts without the toggle keep their normal connections. A proxy failure
never silently switches to a direct request. The proxy can't be removed while an
account still uses it; the Proxy page lists those accounts.

The proxy is stored under the same host encryption as registrar credentials and
is included in data exports. A plain export therefore contains the proxy
password too; use the export passphrase option when appropriate. MCP reports
only whether an account uses the proxy, never its address or credentials.

**Upgrading:** earlier versions kept the proxy inside each Namecheap account's
credentials. On first start after upgrading it is moved to Settings → Proxy and
those accounts keep using it; nothing needs re-entering. Older data exports are
converted the same way on import.

### Transport limitations and security review

A proxied account makes exactly the requests it would make directly.
`@aoxborrow/registrar-client` builds each request and DomBot hands it to the
host's tunnel instead of the network, so timeouts, retries, error handling and
the redaction of credentials from diagnostics are the same either way. Requests
are pinned to the registrar's own API origin over HTTPS; anything else is
refused rather than tunnelled. Redirects are never followed.

Workers use pinned `tunnelfetch` 1.13.0 with certificate verification enabled,
bounded timeouts and a 2 MiB decoded-response limit. A new client is closed
after every request so no open socket crosses Worker invocation boundaries.
Native Workers `startTls` cannot verify a different destination after an HTTP
CONNECT tunnel. `tunnelfetch` implements TLS 1.2/1.3 and certificate validation
in JavaScript/WebCrypto; its authors state that it has not had an external
security audit. This opt-in feature requires review of that additional trust
boundary and may need Workers Paid for the additional CPU cost.

Desktop uses `https-proxy-agent` with Node's native TLS verification. An HTTPS
proxy URL encrypts the CONNECT handshake, including any proxy password; a
separate verified TLS connection protects registrar traffic inside the tunnel
either way. No setting disables certificate verification. On the Worker,
Cloudflare additionally blocks outbound sockets to private network ranges
whatever the proxy hostname resolves to.

A failure before the tunnel is up (proxy unreachable, wrong proxy password,
CONNECT refused, certificate not verifiable) means the registrar never saw the
request. It is reported as a proxy problem in plain words, never with the proxy
URL, and is retried for any operation. Once a request may have reached the
registrar, the rules below apply exactly as they do without a proxy.

### When a change may or may not have gone through

If a write times out, loses its connection mid-response, or gets a 5xx, the
registrar may already have applied it. DomBot never sends it again on its own:
a second renewal is charged twice. Instead it re-reads the domain and tells you
what actually happened:

- **The change is there.** Reported as done.
- **It isn't, and repeating it is harmless** (auto-renew, lock, privacy,
  nameservers, fetching an auth code). Reported as failed and safe to try again.
- **It isn't, but it costs money, or DomBot can't tell.** Reported as
  **Unconfirmed**, with a note to check the domain at the registrar first. A
  renewal is only ever confirmed by its expiry date moving, and an unconfirmed
  one is never offered for retry, since registrars can take a while to show it.
  URL and email forwarding changes are reported this way too.

Reads are simply retried. This applies to the app, bulk jobs and MCP alike, and
to direct and proxied accounts alike.

References: [Namecheap API parameters](https://www.namecheap.com/support/api/global-parameters/),
[Cloudflare sockets implementation](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/sockets.c++),
[tunnelfetch security and maturity](https://github.com/latentharbor/tunnelfetch#readme).
