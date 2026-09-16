# Demo site

A public, browsable DomBot with an invented portfolio: real registrar names
and real renewal prices, fake domains, fake credentials, and nothing that
ever leaves the visitor's browser. Every part of the UI works — sync, detail
panels, bulk updates, renewals, folders, export — against an in-memory
registrar that accepts every write and never talks to anyone.

## How it works

`src/core` is host-agnostic, so the whole app (renderer + core) can run
inside one static page with no server. The demo swaps exactly one seam: the
provider behind `getRegistrarClient()`.

- **`src/core/demo/registrar.ts`** — `DemoRegistrar`, a `Registrar` served
  from a `DemoWorld` of records. It advertises the _real_ provider's feature
  list for its registrar name, so the UI gates ops exactly as it does for
  real accounts (Cloudflare still can't change nameservers, NameBright still
  has no DNSSEC). Writes mutate the world and report success; an op the real
  provider lacks throws the library's `NotImplementedError`. Pricing comes
  from the bundled base table, so it's true.
- **`src/core/demo/seed.ts`** — a deterministic generator (seeded PRNG) for
  ~180 plausible domains across GoDaddy, Porkbun, Cloudflare, Dynadot,
  Namecheap and Spaceship, with realistic expiry spread (a few overdue, some
  due soon, a few multi-year), auto-renew/lock/privacy mixes, varied
  delegation (registrar default, Cloudflare, a few custom), contacts, DNS
  records, DNSSEC on a handful, four folders, and a few manual prices.
  Gandi, NameSilo, NameBright and Name.com are left unconfigured so the
  settings page shows both states.
- **`src/core/demo/index.ts`** — `installDemo()`: installs the factory
  (`configureRegistrarFactory` in `services/registrars.ts`), seeds fake
  credentials for the configured accounts (so they show as connected and the
  form pre-fills), creates the folders and manual prices. The host then runs a
  sync and the portfolio cache fills exactly as on a real first launch.

## Phases

1. ✅ Fake registrar + seed generator + factory hook, with tests.
2. A third `DombotApi` implementation, `src/renderer/api/demo.ts`, that calls
   the core's method table in-process over a `MemoryDocStore` with bulk
   auto-drive on, and feeds core events straight to the `onX` subscriptions.
   A demo Vite config producing `dist/demo`.
3. Demo affordances: a banner ("Demo portfolio — the domains are invented,
   the prices are real, nothing you do here leaves your browser") with a
   Reset button; registrar credential forms read-only with a note; MCP tab
   hidden; import disabled (export and CSV still work).
4. Publish under the site and link it from the site hero and the README.

Open: whether visitor changes persist across reloads (`localStorage` mirror
plus Reset) and whether the desktop app gets a "try with sample data" mode,
which the same seed would provide.
