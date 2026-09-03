# Security

DomBot holds your registrar API keys, which can read and change your domains. So
the design goal isn't to ask you to trust us — it's to make the important claims
**verifiable by a skeptic who doesn't trust us at all.** This document states
what DomBot does with your credentials and, for each claim, how you can confirm
it yourself.

## The trust model, in one line

DomBot is **local-first with no backend of its own.** Your credentials are
stored encrypted on your machine and are sent to exactly one place: the API of
the registrar they belong to. There is no DomBot server for them to be uploaded
to — so "the app phones home with my keys" isn't something you have to take our
word on; it's structurally absent, and you can watch the network to prove it.

## What DomBot does with your credentials

- **Storage.** Registrar API keys entered in **Settings → Registrars** are
  encrypted with your operating system's credential store — Keychain on macOS,
  DPAPI on Windows, the system keyring (libsecret/kwallet) on Linux — via
  Electron [`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage).
  The encrypted blob lives in a `0600` (owner-only) file in the app's user-data
  directory. See [`src/main/services/credentials.ts`](src/main/services/credentials.ts).
  If the OS has no encryption available, DomBot **refuses to save** rather than
  writing plaintext keys to disk (a plaintext fallback exists only behind an
  explicit `DOMBOT_ALLOW_PLAINTEXT_CREDENTIALS=1` opt-in for headless setups).
- **Use.** Credentials are read only to make requests **directly from your
  machine to that registrar's own API.** The registrar HTTP calls live in
  [`@aoxborrow/registrar-client`](https://github.com/aoxborrow/registrar-client),
  a separate open-source package.
- **No telemetry, analytics, or crash reporting.** The app contains no Sentry,
  no analytics SDK, no usage pings — nothing that could carry a key off-device.
- **No auto-update phone-home.** Updates are downloaded manually from GitHub
  Releases; the app doesn't call an update server.

## The local MCP server

DomBot runs an MCP server so AI agents can manage your portfolio. It is bound to
**`127.0.0.1` only** and never exposed off the machine, and pairing a client
requires a one-time in-app **Approve/Deny** prompt with a matching code. See
[`src/main/mcp/server.ts`](src/main/mcp/server.ts) and the README's
[Embedded MCP server](README.md#embedded-mcp-server) section.

## Verify it yourself

You don't have to believe any of the above. Here's how to check.

### 1. Watch the network

Run DomBot behind an inspecting proxy and use it normally — add a registrar,
sync your portfolio, browse. You'll see connections **only to your configured
registrars' own API hosts** (and, on first agent connect, loopback traffic for
MCP). No DomBot-operated host appears, because there isn't one.

- **macOS:** [Little Snitch](https://www.obdev.at/products/littlesnitch/) or
  [Charles](https://www.charlesproxy.com/) / [mitmproxy](https://mitmproxy.org/).
- **Windows/Linux:** [mitmproxy](https://mitmproxy.org/) or
  [Wireshark](https://www.wireshark.org/) (hostnames are visible via SNI even
  without TLS interception).

### 2. Read the source

The whole app is [AGPL-3.0](LICENSE) and open. The three things worth reading:

- Credential storage — [`src/main/services/credentials.ts`](src/main/services/credentials.ts)
- Where registrar credentials are resolved (GUI store only, no env fallback) —
  [`src/main/services/registrars.ts`](src/main/services/registrars.ts) (`resolveField`)
- The actual registrar HTTP calls —
  [`@aoxborrow/registrar-client`](https://github.com/aoxborrow/registrar-client)

### 3. Confirm the binary matches the source

Every published release is **built in public CI** (GitHub Actions), not on a
maintainer's laptop, and carries a **build-provenance attestation** that
cryptographically ties the downloaded artifact to the exact commit and workflow
that produced it. Verify a download before running it:

```bash
gh attestation verify <path-to-download> --repo aoxborrow/dombot
```

A passing check means the binary you have was built by DomBot's release workflow
from this repository's source — so the source you audited is the app you're
running, and there's no room to slip in a different, key-stealing build.

## Application hardening

For defense-in-depth against a compromised dependency (the more realistic threat
than the author, once the above is verifiable):

- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and
  `sandbox: true`; the UI reaches the main process only through a typed preload
  bridge. ([`src/main/index.ts`](src/main/index.ts))
- A strict **Content-Security-Policy** keeps the renderer same-origin — no
  remote scripts, styles, images, or network connections can load.
- The renderer can't navigate away from its own content, and external links open
  in your real browser rather than an in-app window.
- Electron **Fuses** disable `RunAsNode`, Node CLI/inspect args, and the
  `NODE_OPTIONS` env var, and enforce ASAR integrity. ([`forge.config.ts`](forge.config.ts))
- macOS releases are **signed and notarized** by Apple.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue. Use
GitHub's [private vulnerability reporting](https://github.com/aoxborrow/dombot/security/advisories/new)
for this repository, or email **aaron@oxborrow.com**. We'll acknowledge receipt
and keep you updated on a fix.
