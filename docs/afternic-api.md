# Afternic Portfolio API

The Afternic Aftermarket Portfolio API client inside DomBot, and what
DomBot builds on it. All six phases below are built; what's left is under
"Open questions" and in [afternic-api-issues.md](afternic-api-issues.md). The API left beta in October 2026. Docs:
<https://api.afternic.com/docs/portfolio-api/>. The full OpenAPI 3.0 spec is
published at `/docs/portfolio-api/openapi-bundled.yaml`, so we can generate or
check types against it rather than transcribing the reference pages.

Everything under "Observed" was checked live against the account in `.env`
(2026-10-27) with `scripts/afternic/afternic.mjs`.

## The API at a glance

24 operations in five groups, all under
`https://api.afternic.com/v3/aftermarket/customers/my`:

| Group              | Operations                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Domains (listings) | list, get, get many by name, create, replace (PUT), update (PATCH), delete, upsert many, relist many, delete many |
| Stats              | account views/leads per day, one domain's views/leads per day                                                     |
| Sales              | list, get, update (auth code), send message to the transaction agent                                              |
| Account settings   | get, update (defaults for new listings)                                                                           |
| Jobs               | list, create, get, update (close/cancel), upload CSV, download results                                            |

Conventions:

- **Auth:** `Authorization: sso-key KEY:SECRET`. A `User-Agent` is required;
  requests without one are rejected. `X-Request-Id` (a UUID) is optional and is
  what support asks for.
- **Customer:** always `my`.
- **Money:** USD only, integer microunits (1 USD = 1,000,000), whole dollars
  only. Minimum offer has a floor of $20.
- **Paging:** `limit`/`offset`, and the response has `pagination.total` and
  `next`/`previous`/`first`/`last` links.
- **Rate limit:** 150 requests a minute across everything; 429 has
  `Retry-After`.
- **Batches:** up to 500 names per `$each` call; each name gets its own
  `code` and `error` in a map keyed by name, even when the call is 200.

### Observed: where the API and the docs disagree

What to report to Afternic is collected in
[afternic-api-issues.md](afternic-api-issues.md).

| Topic                  | Docs                                                    | Actual                                                                                                                          |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Stats `startDate`      | start of the window ("30 days starting Sep 1")          | the **end** of the window; days count backwards from it. Omit it for the last N days.                                           |
| Stats `days`           | 1–366 in the guide                                      | 1–365 (the reference is right)                                                                                                  |
| Sales `limit`          | max 1000                                                | max **100** (`limit must be at most 100`)                                                                                       |
| Settings path          | —                                                       | `/accountSettings`, camelCase; `/accountsettings` is a 404                                                                      |
| `PATCH ?resource=true` | returns the updated domain                              | returns 204 anyway; re-read to confirm                                                                                          |
| `tld` on a domain      | in the example response                                 | not returned                                                                                                                    |
| `includes=offerCount`  | per-domain offer count                                  | a no-op since 2026-10-28 (changelog): the field is gone and the value is due to leave `includes`. DomBot doesn't ask for it.    |
| `includes=searches`    | searches 30/90/365d                                     | not returned here: needs a Discount Domain Club Domain Pro membership, which this account doesn't have (many DomBot users will) |
| Per-domain leads       | list sorts by `LEADS_DESC`, examples show `intakeLeads` | never returned; the only per-domain leads are from `/stats/{domain}`                                                            |
| `registrar` include    | an enum (`GODADDY`, …)                                  | free text: `"Dynadot Inc"` and `"Dynadot, LLC"`, `UNKNOWN`, sometimes missing                                                   |
| New listing defaults   | —                                                       | the account's settings, but `maxLeasePeriod` is cut to the price cap: 30 at $2,500, the account's 60 at $25,000                 |

Other observed behavior worth designing around:

- A create goes `PENDING` and turned `ACTIVE` within about five minutes of
  pointing the nameservers at `ns1/ns2.afternic.com`.
- Changes made in the Afternic web UI show up in the API immediately (floor
  price on domanio.com).
- Deleting a listing and creating it again keeps its original `createdAt`. It
  went back to `PENDING` once (2026-10-28) and was `ACTIVE` again within a
  minute or two; on 2026-10-29 it came back `ACTIVE` straight away.
- A bulk call answers a name it couldn't act on with that name's own status
  and no error body (`{"name": {"code": 404}}` for delete), inside a 200.
- `RESYNC` on an `ACTIVE` listing succeeds and changes nothing visible.
- Creating a listing that exists returns 409, as documented.
- Prices must keep minimum offer ≤ floor ≤ Buy Now (equal allowed), checked
  against the whole saved listing: a PATCH of just the floor is refused if it
  falls below the saved minimum offer. Each break is a 422 `MALFORMED_INPUT`
  naming the field (`floorPrice cannot be less than minbidPrice`). The
  client checks the prices given together before sending.
- The lander only changes what the name's own page shows. Buyers also reach
  a listing through GoDaddy and partner registrars, which show its Buy Now
  price and minimum offer whatever the lander is.
- A one-row bulk job finished in about a second, from upload to `COMPLETED`.
- A job's results file is `operation,domain,result,errorMessage`, with a
  byte-order mark before the first data row (not before the header). Results
  seen: `UPDATE_PROCESSED`, `NO_CHANGE`, and `FAILED` with a message
  (`failed to parse buynowprice: abc`,
  `domain : failed validation on 'domainNameFormat' condition`). The job
  details count `totalRequests`, `totalSuccess` and `totalFailures`.
- A name twice in one job file: on 2026-10-28 it got one result and the
  file's other rows went missing from the results; on 2026-10-29 every row
  got a result, but the name's rows were merged into one update that failed
  on the other row's error. The client writes each name once.
- The job file's `Domain` cell sets the lander's display name:
  `DOMANIO.com` renamed the display. The client writes the plain name unless
  a `displayName` was asked for.
- **Max lease period is capped by price, silently.** On a $2,500 listing, 24
  saved and 31 or 36 were ignored with no error, through both PATCH and a job
  (`NO_CHANGE`); since 2026-10-29 anything over the cap is cut to 30 instead,
  still with no error. The values across this account fit a minimum monthly
  payment of roughly $81–83. It's Afternic's rule: the dashboard's Lease to
  Own settings say a domain priced too low for the default maximum lease
  period is set "as close as possible". Compare the saved listing with what
  was asked and say when Afternic kept a different value.
- **Lease to Own, per the Afternic dashboard** (not in the API docs): it needs
  a Buy Now price between $495 and $5,000,000; the account's settings apply
  to new listings only; and the default maximum lease period sets a
  commission discount: 2–12 months 0%, 13–24 months 5%, 25–36 months 10%,
  37–60 months 15%.
- **The sales list includes purchases.** Domains the account bought on
  Afternic come back from `GET /sales` as ordinary completed sales, with no
  field saying which side the account was on. `GET /sales/{id}` answers 404
  for exactly those, and they're the only completed Buy Now records without
  `disbursedAt` (afternic-api-issues.md, issue 1). DomBot leaves out
  completed Buy Now records with no payout date, which drops the purchases
  and keeps leases, sales under way and cancelled ones; a sold event an
  earlier sync wrote for one is removed.
- Sales history covers every sale back to 2020, not just recent ones, once
  you pass a wide `soldAtStartDate`. The default window is the last month.
- `GET /sales/{id}` includes the transfer `authCode` in plain text. The list
  did too until 2026-10-29, and now leaves out both `authCode` and `saleTotal`
  (afternic-api-issues.md, issue 9).
- Leased sales carry `installmentAmount`, `totalInstallments`,
  `totalInstallmentsPaid`, and the previous/next installment dates, but no
  `saleTotal` or `disbursedAt`.
- Account stats added up to 581 views and 2 leads for the year, while per-domain
  stats across the current 50 listings only add up to 48 views. The rest are
  presumably on names that sold or were delisted.

## What to implement

All of it except Replace domain (PUT): 23 of the 24 operations, plus every
`includes` option. Many DomBot users have Discount Domain Club memberships
(search data) and portfolios over 10,000 names (bulk), so neither is optional.

### Implement

| Operation                                                   | Why DomBot wants it                                                                                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| List domains (all filters, all `includes`)                  | The listing snapshot: which names are listed, at what prices, status, lander, leasing, Fast Transfer, registrar, and (for Domain Pro members) search counts. Basis of sync.                                        |
| Get domain, get many by name                                | Refresh one name or a selection after an edit, without re-pulling everything.                                                                                                                                      |
| Create domain                                               | "List on Afternic" from DomBot.                                                                                                                                                                                    |
| Update domain (PATCH)                                       | Price and lander edits. Maps onto DomBot's asking price.                                                                                                                                                           |
| Delete domain                                               | Delist. Also needed when a name sells elsewhere or is dropped.                                                                                                                                                     |
| Upsert many                                                 | Bulk list/reprice up to 500 at a time; the bulk path for "push my prices to Afternic".                                                                                                                             |
| Delete many                                                 | Bulk delist.                                                                                                                                                                                                       |
| Relist many (`RESYNC`, `REACTIVATE`)                        | Fixes `INACTIVE`/`FAILED_COMPLIANCE` listings; DomBot can offer it next to those statuses. Exact effect of each mode needs a live test.                                                                            |
| Account stats, domain stats                                 | Views and leads per day: the only traffic data the API has. Feeds dashboards.                                                                                                                                      |
| List sales, get sale                                        | Full sales history with commission and payout dates; feeds `sold` events and reporting.                                                                                                                            |
| Update sale (auth code)                                     | When a sale is `AWAITING_AUTH_CODE`, DomBot can fetch the code from the registrar (registrar-client `getAuthCode`) and submit it. This is the most valuable automation in the whole API.                           |
| Send sale message                                           | Small, and the only way to reach the transaction agent from DomBot. Needs a confirm step since it's a message to a person.                                                                                         |
| Get / update account settings                               | Defaults for new listings. Tiny; useful in Settings.                                                                                                                                                               |
| Search statistics (`includes=searches`)                     | GoDaddy search counts per name (total and unique, 30/90/365 days) for Domain Pro members. One of the best demand signals available; feeds columns, sorting, and reporting. Hidden when the account doesn't get it. |
| Bulk jobs: create, list, get, upload, results, close/cancel | Large portfolios. See below.                                                                                                                                                                                       |

### Leave out

- **Replace domain (PUT).** It resets every omitted field to its default, so a
  PUT with just prices would silently turn off leasing and change the lander.
  Create + PATCH cover every real case.

### Bulk: `$each` calls and jobs

There are two bulk paths, and DomBot needs both:

- **`$each` calls** (upsert, delete, relist, get many): JSON, synchronous,
  500 names a call with a result per name. A 10,000-name portfolio is 20
  calls, well inside 150 a minute. Use these for anything driven from the
  Domains table: a selection, a bulk reprice, a delist.
- **Jobs**: asynchronous. Create a job, upload a CSV (up to 100 MB), poll its
  state and `percentComplete`, download a CSV of per-row results. One upload
  instead of hundreds of calls, so it stays clear of the rate limit while
  other sync is running. Use for whole-portfolio pushes and imports past a
  threshold (say 5,000 names), and for reconcile.

Things to know about jobs:

- The CSV is a **different format** from the JSON endpoints: plain dollars,
  `Y`/`N`, lander names as words (`Buy It Now`, `Request Price`,
  `Custom Lander`, `Cashparking`), and a required header row. The client owns
  both conversions so callers pass the same listing objects either way.
- At most 3 jobs can sit in `CREATED` at once; reuse an open one rather than
  failing.
- Results are streamed CSV and can return 504; retry the download.
- The columns, in order: `Domain`, `Buy Now Price`, `Floor Price`,
  `Min Offer`, `Lease to Own`, `Max Lease Period`, `Sale Lander`,
  `Show Buy Now Option`, `Show Lease to Own Option`, `Show Make Offer Option`,
  `Hidden` (Afternic's
  [bulk upload template](https://www.afternic.com/forms/bulk_upload_sample_v3.xlsx)).
  A blank cell leaves that setting alone. There's no column for `featured`.
- `RECONCILE_JOB` is almost certainly the template's "Replace" option, which
  the template describes as "remove all listings in your portfolio and
  replace them with the domains in your CSV file". It's the most dangerous
  call in the API: the client never runs one for a caller (`runJob` only
  makes `BULK_JOB`s), and DomBot shouldn't offer it without showing exactly
  which listings would go. Not tested live: on this account a mistake would
  delist real names.
- DomBot already has a `bulk-jobs` service (`src/core/services/bulk-jobs.ts`)
  for its own bulk operations. Name Afternic's "Afternic jobs" in code and UI
  so the two aren't confused.

## Where the client lives

In DomBot, under a `markets` folder that will hold every marketplace (Sedo,
Atom, Dan, …): the client in `src/core/markets/afternic/`, and the service
that maps it onto DomBot's records in `src/core/services/markets/afternic.ts`.
`src/core` already runs in both the Electron main process and the Worker, so
the client works for desktop and self-hosted web alike, and there's no
package to version and release.

```
src/core/markets/
  afternic/
    client.ts       AfternicClient: one method per operation
    types.ts        listing, sale, stats, job, settings types (dollars, not microunits)
    wire.ts         the API's JSON shapes and the microunit conversions
    convert.ts      wire shapes → types
    jobs-csv.ts     listing objects ↔ the bulk-jobs CSV format
    errors.ts       AfternicError
    rate-limit.ts   the per-account 150/min token bucket
    registrars.ts   free-text registrar → registrar-client key
    fixtures.ts     live response shapes with made-up names, for tests
    *.test.ts       unit tests; *.live.test.ts run against the real API
  sedo/           later
  atom/           later
src/core/services/markets/
  afternic.ts     sync and writes: Afternic types ↔ DomBot records
```

Keep each market client free of DomBot's storage and services, talking only
through its own types; the service does the mapping. That keeps the option to
lift a client into a package later. The shared market types and the
Afternic adapter that maps into them are in [markets.md](markets.md).

### Client shape

- `AfternicClient({ apiKey, apiSecret, userAgent, fetch? })`, with an
  injectable `fetch` so it can go through DomBot's proxy transport like
  registrar calls do.
- One method per operation. The API calls a listing a "domain"; the client
  says "listing" so it never reads as a registrar domain: `listListings`,
  `getListing`, `getListings`, `createListing`, `updateListing`,
  `deleteListing`, `upsertListings`, `deleteListings`, `relistListings`,
  `getAccountStats`, `getDomainStats`, `listSales`, `getSale`, `updateSale`,
  `sendSaleMessage`, `getAccountSettings`, `updateAccountSettings`,
  `listJobs`, `createJob`, `getJob`, `uploadJob`, `getJobResults`,
  `closeJob`, `cancelJob`; plus `allListings()` and `allSales()`, which walk
  every page, and a `runJob(listings)` helper that creates, uploads, polls
  and returns parsed results.
- **Paging big portfolios:** `allListings()` pages at 500 in a fixed order
  (`NAME_ASC`) and re-checks `pagination.total` at the end; if it changed
  mid-walk, the caller knows the snapshot may be torn and can re-run it.
- **Money at the edges:** the client converts microunits to whole-dollar
  numbers on the way in and back on the way out, and rejects cents. Callers
  never see microunits. (DomBot stores canonical decimal strings, so the
  conversion to its `"2500"` form lives in the service.)
- **Stats with honest dates:** take `{ days, endDate? }` and send it as
  `startDate`, so the backwards window is handled once, in one place.
- **Batches:** chunk anything over 500 automatically and return one merged
  per-name result map, so callers handle per-name failures the same way for 3
  names or 3,000.
- **Rate limiting:** a token bucket at 150/min shared by every client for the
  same key (one per account, not per instance, since sync and a user's bulk
  edit can run at once); retry 429 with `Retry-After` and 5xx with backoff;
  never retry other 4xx. A 10,000-name portfolio with per-domain stats is
  10,000 calls, over an hour of budget, so per-domain stats must be fetched
  incrementally and cached (see Reporting).
- **Optional data stays optional:** `searches`, `registrar` and
  `fastTransferStatus` are null when Afternic doesn't send them, never a
  made-up 0, so the UI can hide search columns for an account where no listing
  has search data.
- **Errors:** one `AfternicError` with `status`, `code`, `message`,
  `fields[]`, and the `requestId` we sent, so failures can quote it to support.
- **Normalize what's messy:** map the free-text `registrar` to a stable key
  where we can (`"Dynadot Inc"` and `"Dynadot, LLC"` → `dynadot`, aligned with
  registrar-client names) and keep the raw string alongside.
- Types generated from or checked against the published OpenAPI spec, with the
  "Observed" corrections applied on top.

### Testing

- **Unit tests** in DomBot's normal `npm test` run, against fixtures in the
  exact shapes the live API returned but with made-up names and amounts (the
  repo is public; real fixtures would publish a portfolio and its sales):
  paging, money conversion,
  batch chunking and result merging, jobs CSV both ways, error parsing, the
  stats date window, retry and rate-limit behavior.
- **Live tests** (`*.live.test.ts`), kept out of `npm test` and CI:
  `npm run test:live` runs them with `vitest.live.config.ts`, which loads the
  nearest `.env`. Each suite skips when its credentials are missing, so the
  same command will cover Sedo and others later. Reads: list, get, many,
  stats, sales, settings, jobs list, plus checks that the API still behaves
  the way "Observed" says (a failure there means Afternic changed it).
- **Live write tests on one dedicated name** (domanio.com), with
  `AFTERNIC_LIVE_WRITES=1`: change a price and restore it, toggle `hidden`
  and restore it, upsert it unchanged, `RESYNC` it, save account settings
  unchanged, a bulk delete of a name that isn't listed, and a create that
  must conflict. Delete and re-create also needs `AFTERNIC_LIVE_DELIST=1`,
  since it takes the listing off the market for a minute or two. Later, a
  one-row `BULK_JOB` that sets its price. Every test restores the listing,
  and nothing touches other listings.
- **Scale:** synthetic portfolios of thousands of listings to test paging,
  chunking and the rate limiter without the live API.
- **Can't be tested on this account:** search data (no Domain Pro membership;
  use the spec's example response and ask a member for a real one), and
  `updateSale`/`sendSaleMessage` (need a live sale in the right state). Cover
  them with fixtures and verify when the data turns up.

## What it means for DomBot

These are the product features the API supports; each is a later phase, not
part of the client work.

### Settings: Markets

A new **Markets** section in Settings, between Registrars and Proxy, for
Afternic now and Sedo, Atom and others later. "Markets" over "Integrations":
it matches `src/core/markets/`, and says what's in it; "Integrations" would
invite unrelated things (MCP already has its own section).

It works like Registrars, so it reuses that page's pieces:

- **One card per market account.** Multiple Afternic accounts are allowed
  (separate businesses, a partner's account), keyed by account id like
  registrar accounts (docs/multi-account.md), with an editable account name.
- **Credentials:** API key and secret, with a link to Afternic's
  [Account Profile → API Keys](https://www.afternic.com/account/profile).
  Saving runs a connection test (one `listListings({ limit: 1 })`) and shows
  the listing count, or Afternic's error with its request id.
- **What the account gets**, shown after the test: listing count, sales
  count, and whether search data comes back (Discount Domain Club Domain
  Pro), so it's clear why search columns do or don't appear.
- **Sync:** on/off per account, on the same schedule as registrar sync
  (Settings → Sync), with last-synced time and the last error. The ⋯ menu
  holds Sync now, Edit name, Disable and Remove, like registrar cards.
- **Listing defaults:** Afternic's account settings (lander type, intake
  style, which lander options show, lease-to-own on/off and max payments),
  read from and saved to `/accountSettings`. These apply to listings created
  later, including from DomBot.
- **Later markets** don't appear until they're built: no "coming soon"
  cards.

Storage:

- Market credentials go in their own namespace, `market-credentials`, keyed
  by account id, and accounts in `market-accounts`, mirroring
  `registrar-credentials` and `registrar-accounts` (docs/storage-model.md).
- **The desktop host only encrypts namespaces it's told to**
  (`src/electron/storage/index.ts` lists `registrar-credentials` and
  `proxies`), so `market-credentials` must be added to that set. The web host
  encrypts everything already.
- Data bundles (export/import) carry registrar credentials; market
  credentials must get the same treatment in `src/core/storage/bundle.ts`.
- The MCP server gets the same accounts, so an MCP client can use them
  without its own keys (see MCP below).

### Listings

- **Listing columns and filters** on the Domains table: an Afternic column
  (one per connected market, see markets.md), listed on Afternic or not,
  listing status (`ACTIVE`, `PENDING`, `INACTIVE`, `FAILED_COMPLIANCE`, …),
  Fast Transfer status, lease-to-own on/off, and for Domain Pro members
  GoDaddy searches (total and unique, 30/90/365 days).
- **Bulk from the table:** list, reprice and delist a selection (listing
  also relists any that were stuck, see below),
  through `$each` calls in chunks of 500 with per-name results shown the way
  DomBot's own bulk operations show them. Whole-portfolio pushes and big
  imports go through Afternic jobs, with progress from `percentComplete`.
- **Asking price sync.** DomBot's asking price (`domain-list-prices`: BIN,
  min offer, floor) is the same three numbers as Afternic's `buynowPrice`,
  `minbidPrice` and `floorPrice`. Decide which side wins:
  - read-only first: show Afternic's prices and flag where they differ from
    DomBot's;
  - then push: edit in DomBot and save to Afternic.
    Afternic is USD-only, so a non-USD asking price can't be pushed as-is.
- **List on Afternic** from DomBot for a selection of names: create the
  listings, then offer to set the nameservers to Afternic through the
  registrar, which is what turned domanio.com `ACTIVE`. DomBot already
  recognizes Afternic nameservers (`src/renderer/lib/nameservers.ts`).
- **Things to flag:** names on Afternic nameservers but not listed (we found
  dnslayer.com and phoneformat.com), listings for names no longer in any
  account, `INACTIVE`/`FAILED_COMPLIANCE` listings. There's no separate
  Relist action: listing a name at your price relists it when it was
  inactive (`REACTIVATE`), rejected or stuck pending (`RESYNC`), since
  updating a listing alone doesn't re-run Afternic's checks.

### Sales

- **Import sales as `sold` events** with date (`soldAt`) and amount
  (`salePrice`), plus commission so net proceeds are known. This fills the
  `sold` side of history automatically, back to 2020 for this account.
- **Sales in progress** in the bell: a sale needing an auth code, transfer, or
  payee update. With the registrar connected, "Send auth code" fetches it and
  submits it in one step.
- **Leases** as their own kind: installments paid of total, next date, amount.
- Don't store `authCode` from the sales feed; it's sensitive and DomBot can
  always fetch a fresh one from the registrar.

### Reporting

- **Views and leads** over time for the account (one call), and per domain.
  Per domain is one call per name, which is hours of rate-limit budget for a
  10,000-name portfolio, so: fetch the full 365 days once per name in the
  background, then only the last few days on later syncs, and store daily
  rows. Prioritize names whose account-level views moved, and names the user
  opens.
- **Search demand** (Domain Pro members): search counts next to views, leads
  and price, to spot names searched a lot but priced high or not listed.
  Search data comes with the domain list, so it costs nothing extra; keep
  periodic snapshots so trends show over time, since the API only gives
  rolling 30/90/365-day counts.
- **Sales report:** gross, commission, net by year; average sale; sell-through
  rate (sales ÷ listings).
- **Price vs. outcome:** sold prices against what the name was listed at, once
  we keep listing price history from sync.

### MCP

The market tools are shared by every market and listed in
[markets.md](markets.md#mcp). For Afternic they cover everything in this
plan; Afternic is also the only market so far with the sale tools
(`market_sale_auth_code_set`, which can fetch the code from the registrar
holding the name, and `market_sale_message_send`, which reaches a person),
listing defaults (`market_settings_get`/`_set`) and relisting
(`market_listings_relist`, `RESYNC` or `REACTIVATE`). Bulk tools return a
DomBot bulk job; for a large push the Afternic adapter runs it as one CSV
job.

## Phases

1. **Client, read side** (`src/core/markets/afternic/`): auth, paging,
   money, errors, shared rate limit; domains list/get/many with every
   `includes`, stats, sales, settings. Fixtures, the scale fixture, live
   read tests. Done.
2. **Client, write side:** create, PATCH, delete, upsert/delete/relist many,
   settings update, sale update and message. Live round-trip tests on
   domanio.com. Done.
3. **Client, jobs:** jobs CSV both ways, create/upload/poll/results/close,
   `runJob`. Live one-row jobs on domanio.com. (`RECONCILE_JOB` is left
   untested; see Open questions.) Done.
4. **DomBot, read-only:** first the shared market types and the Afternic
   adapter ([markets.md](markets.md), "Order of work"), then on top of them:
   Settings → Markets with Afternic accounts; sync
   listings and sales, listing columns/filters (including searches and
   offers), sales as `sold` events; the read-only MCP tools. Done.
5. **DomBot, writes:** list at your DomBot prices (relisting stuck
   listings along the way) and delist from the table, auth-code automation from the bell, the MCP write tools.
   Done; Afternic writes run directly in 500-name batches (see
   [markets.md](markets.md#bulk-writes)).
6. **DomBot, reporting:** per-domain views and leads fetched a slice per
   sync (300 names on desktop, 40 on the web host), weekly search-count
   snapshots, a Markets page (traffic by month, top names with searches
   for Domain Pro accounts, sales by year, sell-through),
   Views/Leads/Searches columns, and the `market_traffic` and
   `market_report_get` tools. Done.

## Open questions

1. Asking price ownership: should DomBot or Afternic be the source of truth
   when they differ, or does the user choose per sync?
2. Confirm `RECONCILE_JOB` is "Replace", and whether blank cells in a
   replace file reset settings to defaults, before DomBot offers it. Safest
   on a separate Afternic account with two or three throwaway listings.
3. A real `searches` response from a Domain Pro member, to confirm the shape
   before building columns on it.
