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
  ~180 single-dictionary-word domains (at most two share a name on a second
  TLD) across GoDaddy, Porkbun, Cloudflare, Dynadot,
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
2. ✅ `src/renderer/api/demo.ts` — a third `DombotApi` implementation that
   calls the core's method table in-process over a `MemoryDocStore` with
   bulk auto-drive on, and feeds core events straight to the `onX`
   subscriptions. `vite.demo.config.mts` builds it to `dist/demo`
   (`npm run demo:build`; `npm run demo:dev` for a dev server on 5199). The
   `__DOMBOT_DEMO__` define keeps the demo out of the desktop and web
   bundles.
3. ✅ Demo mode (`isDemo()` in `src/renderer/lib/platform.ts`): a strip
   across the top ("Demo Mode. Fake domains and credentials, nothing leaves
   browser.") with a Reset button
   (reload → fresh seed);
   the footer reads "Demo mode". Every page keeps its normal copy; only the
   controls that would change something real are disabled: saving or
   adding registrar credentials, the MCP switch, Import. Sync, export and
   CSV still work.
4. ✅ Published at **demo.dombot.ai** as a static-assets Worker
   (`wrangler.demo.jsonc`, `npm run demo:deploy`), redeployed by
   `.github/workflows/deploy-demo.yml` on every merge to main that touches
   the app. The workflow runs only in the upstream repository (gated on the
   repo name) and only when its own secrets are set, so a fork never
   deploys a demo, and the Deploy button / `web:deploy` never read this
   config.

   One-time setup (upstream only):
   - The `dombot.ai` zone is on Cloudflare DNS (a Workers custom domain
     needs that). The marketing site deploys the same way, as the
     `dombot-site` Worker (`wrangler.site.jsonc`, `deploy-site.yml`,
     `npm run site:deploy`).
   - A Cloudflare API token with **Workers Scripts: Edit** on the account
     and **Workers Routes: Edit** + **DNS: Edit** on the `dombot.ai` zone
     (custom domains create their own DNS records), stored as the repo
     secret `DOMBOT_CLOUDFLARE_API_TOKEN`, plus
     `DOMBOT_CLOUDFLARE_ACCOUNT_ID`. One token covers both Workers. The
     names are deliberately _not_ the `CLOUDFLARE_*` ones the self-hosting
     workflow uses, so setting one can't switch on the other.
   - The first deploy of each Worker attaches its custom domain.

Open: whether visitor changes persist across reloads (`localStorage` mirror
plus Reset) and whether the desktop app gets a "try with sample data" mode,
which the same seed would provide.
