# Atom APIs

Plan for an Atom marketplace client inside DomBot, and for what DomBot builds
on it. Written to sit beside `docs/afternic-api.md`: same sections, so the two
can be compared, and a comparison at the end that feeds a shared
`src/core/markets/` interface.

Atom (formerly Squadhelp) publishes several APIs, all in one family of OpenAPI
3.0 specs. The Swagger UI at <https://www.atom.com/api-docs> loads them from
`/api-docs-1/export_openapi.php?spec=<name>&download=1`, where `<name>` is
`seller`, `partnership`, `appraisal`, `trademark`, `smart-search`,
`marketplace` (all five marketplace APIs), `registrar`, or `all`. An older
Swagger 2.0 copy of the marketplace APIs is at `/api-docs-1/json.php`. Use
`spec=all` as the source; it's the only one with response schemas.

The seller spec is thin: no response schemas for most operations (the
`components.schemas` it ships is an empty list), every response typed as the
same five-field `DomainApiResponse`, and no word on rate limits, paging
metadata, dates, or errors. The help center fills some gaps
(<https://www.atom.com/help/category/listing-a-domain>), especially
[Atom Seller API Access](https://www.atom.com/help/article/atom-seller-api-access)
and the listing-type and commission articles. Much of the client's wire shape
will have to come from live responses.

**No Atom key is in `.env`**, so nothing authenticated has been checked.
"Observed" below covers only unauthenticated calls (2026-10-27); everything
else about responses is from the specs and help center and is marked
unverified where it matters. Access is a limited beta: sellers apply from the
dashboard and need at least 500 listings to be considered (100 names at
AtomRegistrar for the registrar API).

## The API at a glance

Six APIs, 65 operations. Only the first matters for selling; the rest are
listed so nothing is missed.

| API          | Base                                    | Auth                                      | Ops | For                                                                  |
| ------------ | --------------------------------------- | ----------------------------------------- | --- | -------------------------------------------------------------------- |
| Seller       | `https://www.atom.com/api/marketplace`  | `api_token` + `user_id` query params      | 18  | Managing your own listings, sales, analytics                         |
| Appraisal    | same                                    | appraisal token, or seller token          | 1   | AI price estimate for any name; 10 a day                             |
| Partnership  | same                                    | partner token                             | 12  | Distribution partners reselling Atom inventory (the buy side)        |
| Smart search | same                                    | token                                     | 1   | Name ideas from a business description                               |
| Trademark    | same                                    | trademark token                           | 1   | USPTO search; 10 a day                                               |
| Registrar    | `https://www.atom.com/api/registrar/v1` | `Authorization: Bearer` (registrar token) | 32  | Domains registered at AtomRegistrar: DNS, NS, locks, contacts, renew |

Seller operations, grouped (all `GET` unless noted, including the writes):

| Group         | Operations                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| Listings      | list (`/domains`, by `type`), get (`/domain-details`), search own (`/domains/search`), add, remove              |
| Pricing       | update selling price, add discount                                                                              |
| Merchandising | categories, primary categories, assign primary category, update description (`POST`), boost (spends AI credits) |
| Verification  | verify DNS                                                                                                      |
| Sales         | all sales                                                                                                       |
| Analytics     | domain analytics (one name: views, shortlists)                                                                  |
| Syndication   | domains authorized for listing on other marketplaces                                                            |
| Grading       | upload names for AI grading (`POST`), grading results                                                           |

Conventions:

- **Auth:** the seller token and the numeric `user_id` it belongs to, both as
  query parameters on every call, from Dashboard → API Access
  (<https://www.atom.com/dashboard/seller/api-access>). There is no header
  option. A token in the URL ends up in proxy, CDN and server logs, so the
  client must never log a request URL and must strip the query from anything
  it puts in an error. The registrar API, by contrast, takes a proper
  `Authorization: Bearer` header with its own token.
- **Writes are `GET`s.** Add, remove, reprice, discount, assign category,
  boost and verify are all `GET` with the change in the query string;
  `update-description` and `upload-grade-domains` are `POST`s that still send
  their data as query parameters (a description, or a comma-separated list of
  names, in the URL). Consequences: never retry a write automatically (a
  retried premium `add-domain` or `boost-domain` spends another AI credit), and
  keep descriptions and grading batches short enough for URL length limits.
- **Money:** USD, whole dollars as integers (`price`, `selling_price`,
  `discount`). No cents, no microunits. `selling_price: 0` means Make an Offer
  in the Google Sheets integration; whether the API reads it the same way is
  unverified. Atom's retail minimum is $100.
- **One price.** A listing has a selling (BIN) price and an optional
  discount; there is no minimum offer or floor field in the API. The Make an
  Offer threshold is an account-wide percentage set in the dashboard, and the
  floor exists only in the Google Sheets integration.
- **Discounts are temporary.** "The discount will automatically reset every
  Monday." The `discount` is a dollar amount off the selling price (per the
  Sheets docs, e.g. `200`); the API doc says only "Discount" (integer).
- **Paging:** `page` and `limit` on listings, sales and syndication; `page`
  and `size` (strings) on grading results. The seller spec doesn't say what
  comes back with a page. The registrar API's `Pagination` object
  (`current_page`, `total_pages`, `per_page`, `total_records`, max 100 a page)
  is the likely shape, unverified for seller calls.
- **Dates:** undocumented for seller calls. The registrar API uses
  `YYYY-MM-DD HH:MM:SS` with no zone; `new-listings` takes `YYYY-MM-DD`.
  Treat seller dates as zone-less strings until a live response shows more.
- **Rate limits:** none published for the seller API. The registrar API
  documents a 429 with no numbers. Appraisal and trademark have hard daily
  caps (10 a day by default, `daily_limit`/`used_today` in the 429), semantic
  search 50 a day.
- **No batches.** Every seller write is one name per call. Bulk in the Atom
  dashboard goes through a Google Sheets sync, which has no API.
- **Listing types:** Standard (no review, 7.5% commission, non-exclusive),
  Plus (no review, 15%), Premium (curated, about 10% accepted, needs Atom's
  nameservers, exclusive except for syndication-authorized names, 15–35% by
  price), and Geo. The API's `add-domain` enum has only `premium` and
  `standard`; the help center says the API adds Plus too.

### Observed: where the API and the docs disagree

Unauthenticated only; no key to test more.

| Topic                    | Docs                                                              | Actual                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bad seller token         | 403 with `{ message }`                                            | **HTTP 200**, `Content-Type: text/html`, body `{"message":"Invalid API token or insufficient permissions"}`. Errors must be detected from the body, never the status. |
| Missing token or user id | —                                                                 | HTTP 200, `{"message":"API Token and UserId are required"}`. `user_id=0` counts as missing.                                                                           |
| Registrar API errors     | 401 `ErrorResponse`                                               | Matches: 401, `application/json`, `{"success":false,"error":"Unauthorized","message":"…"}`.                                                                           |
| Premium cost             | `add-domain`: "a coin will be deducted"                           | Coins became AI credits on 2026-07-07 (1 coin = 10 credits). Premium submission costs 1 credit ($0.10); refunded if rejected.                                         |
| Boost payment            | `source_of_deduction`: `points`, `coins`, `loyalty_benefit`       | Points can't be earned or bought since 2026-07-07, and coins are now AI credits; which value spends credits is unknown.                                               |
| Category values          | `category_name` enum `["categories"]`                             | A placeholder; real values come from `/primary-categories`.                                                                                                           |
| Listing types            | `add-domain` enum `premium`, `standard`; description mentions Geo | Help center says the API adds Plus too. The `type` filter on `/domains` has `premium`, `standard`, `geo`.                                                             |
| Boost type               | enum `standard`, `Super`                                          | Mixed case in the spec; send exactly what it says until tested.                                                                                                       |
| Response schemas         | every seller op returns `DomainApiResponse`                       | Can't all be true (sales, analytics and categories aren't domain records). Unverified.                                                                                |

Things to confirm first once there's a key: the list response and its paging,
the sale record, the analytics record, statuses, and what a write returns on
success and failure.

## What to implement

All 18 seller operations, plus appraisal. Leave out partnership, smart
search and trademark (buyer and partner tools). The registrar API is real and
useful, but it belongs in registrar-client, not here (see "Atom as a
registrar").

### Implement

| Operation                                      | Why DomBot wants it                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List domains (`type` filter, paged)            | The listing snapshot: which names are listed, at what price and discount, type, status, category. Basis of sync.                                                                                  |
| Get domain details                             | Refresh one name after an edit.                                                                                                                                                                   |
| Search own domains (category, keyword, type)   | Cheap server-side filter; mostly useful to the MCP server. Sync already gives DomBot the same data locally, so low priority.                                                                      |
| Add domain (`standard`, `premium`, Plus?)      | "List on Atom." Premium spends an AI credit and goes to review, so it needs a confirm step and shows the cost.                                                                                    |
| Remove domain                                  | Delist Standard and Plus. Premium removal is a 7-day notice through support; DomBot shows that instead of a button.                                                                               |
| Update selling price                           | Push DomBot's BIN price. Premium prices must stay inside the seller's membership-tier range; surface Atom's message per name.                                                                     |
| Add discount                                   | A weekly promotion, distinct from the price. Shown as "discount until Monday", never stored as the asking price.                                                                                  |
| Categories, primary categories, assign primary | Atom ranks and merchandises by category; a bulk "assign category" from the table is a real time saver. The category lists are small and can be cached for a day.                                  |
| Update description                             | Atom shows a description on every lander; DomBot can bulk-set or (later) generate them.                                                                                                           |
| All sales                                      | Sales history; feeds `sold` events and reporting.                                                                                                                                                 |
| Domain analytics                               | The only traffic data: views and shortlists, and per the help center direct lander visits, discovery views, repeat views and price trackers. Per name only.                                       |
| Verify DNS                                     | After DomBot points a name at `ns1/ns2.atom.com` (or adds the TXT record) through the registrar, this asks Atom to check now instead of at "random intervals". Closes the loop on "List on Atom". |
| Syndication-authorized domains                 | Which Premium names may also be listed elsewhere. Needed to warn before a Premium name is listed on Afternic (see "Exclusivity").                                                                 |
| Boost domain                                   | Spends AI credits or a membership Super Boost slot; once a month per name. Implement behind a confirm, single names only, never in bulk without a total.                                          |
| Upload for grading, grading results            | Atom's AI says which names are brand-fit and premium-fit. For a 10,000-name portfolio that's the shortlist of what's worth a Premium submission.                                                  |
| Appraisal (seller token)                       | Atom's estimate, domain score, signals, root words and trademark-conflict count. 10 a day, so on demand for one name (a button on the domain page, an MCP tool), never across a portfolio.        |

### Leave out

- **Partnership APIs** (`partnership-search`, `new-listings`, `orders`,
  `order-details`, `domain-data`, `hold-domain`, `confirm-order`,
  `unhold-domain`, `submit-transfer-code`, `get-transfer-auth-code`,
  `started-transfer`, `semantic-search`). These are for registrars and
  marketplaces that resell Atom's inventory to buyers. A seller token likely
  can't call them, and nothing in DomBot buys from Atom. Note that
  `submit-transfer-code` is the _partner_ handing over a code, not the seller,
  so it is not Atom's equivalent of Afternic's auth-code update.
- **Smart domain search** and **semantic search**: name generation for
  buyers.
- **Trademark search:** a separate token and 10 a day. A trademark check on
  one's own names is interesting, but appraisal already returns a
  `tm_conflicts` count. Defer.

### Defer

- **Search own domains:** implement in the client, but DomBot's UI doesn't
  need it (local filters on synced data do the same).

### Bulk: there isn't any

The biggest difference from Afternic. Afternic has 500-name `$each` calls and
async CSV jobs; Atom has one name per call for every write, and the dashboard's
bulk path (Google Sheets sync) has no API. So:

- A 10,000-name reprice is 10,000 `GET`s. At an unknown rate limit (assume 60 a
  minute until Atom says otherwise) that's close to three hours.
- Run bulk Atom writes through DomBot's own `bulk-jobs` service
  (`src/core/services/bulk-jobs.ts`): queued, resumable after a restart,
  with per-name results and progress, so a long push survives the app closing
  and shows the same way DomBot's other bulk operations do.
- Skip no-ops: compare against the last synced listing and only send names
  whose price, discount, category or description actually changed. For a
  routine "push my prices" most names won't have.
- Writes are not retried automatically (they're `GET`s with side effects and
  some cost money); a failed name is reported and can be re-queued.
- Grading is the one bulk-shaped call: a comma-separated list in the query
  string. Chunk it (say 100 names per call) to stay under URL limits; confirm
  the real cap live.
- Ask Atom whether a bulk endpoint or a higher limit is available for API
  sellers; large-portfolio sellers are who the API is for.

## Where the client lives

`src/core/markets/atom/`, mirroring `src/core/markets/afternic/`, with the
service at `src/core/services/markets/atom.ts`. Same rule: the client talks
only through its own types; the service maps to DomBot's records.

```
src/core/markets/atom/
  client.ts       AtomClient: one method per seller operation, plus appraisal
  types.ts        listing, sale, analytics, grading, appraisal types
  wire.ts         the API's JSON shapes (snake_case, integer dollars)
  convert.ts      wire shapes → types
  errors.ts       AtomError; reads errors out of HTTP 200 bodies
  rate-limit.ts   per-account limiter (rate unknown; configurable)
  fixtures.ts     live response shapes with made-up names, once we have them
  *.test.ts       unit tests; *.live.test.ts run against the real API
src/core/services/markets/
  atom.ts         sync and writes: Atom types ↔ DomBot records
```

### Client shape

- `AtomClient({ apiToken, userId, fetch?, baseUrl?, limiter?, clock? })`,
  with an injectable `fetch` for DomBot's proxy transport.
- Methods, saying "listing" like the Afternic client: `listListings({ type,
page, limit })`, `getListing(name)`, `searchListings({ category, keyword,
nameType })`, `createListing(name, { price, type })`,
  `deleteListing(name)`, `updatePrice(name, price)`,
  `setDiscount(name, amount)`, `listCategories()`, `listPrimaryCategories()`,
  `setPrimaryCategory(name, category)`, `setDescription(name, text)`,
  `listSales({ type, page, limit })`, `getAnalytics(name)`,
  `verifyDns(name)`, `listSyndicationAuthorized({ page, limit })`,
  `boost(name, { kind, paidWith })`, `submitForGrading(names)`,
  `getGradingResults({ page, size, brandFitOnly })`, `getAppraisal(name)`;
  plus `allListings()`, `allSales()` and `allSyndicationAuthorized()`, which
  walk every page.
- **Where Atom forces a different design than Afternic:**
  - **Errors from the body.** Every seller response is HTTP 200 (and
    `text/html`), so `errors.ts` parses the body whatever the status: a body
    with `message` and no data, or `success: false`, is an `AtomError`. Errors
    have only a message, no code, so the client maps known messages ("Invalid
    API token…", "…required", tier price-range rejections, daily limits) to a
    small `kind` enum and keeps the raw text.
  - **No request id**, so errors carry the operation and domain name instead.
  - **Secrets in the URL.** Build URLs in one place, and redact `api_token`
    from anything that reaches a log, an error, or a proxy trace.
  - **Writes go through a separate path** from reads: same limiter, no
    retries, and a `Spend` marker on the two that cost credits
    (`createListing` with `type: 'premium'`, `boost`) so the service can't
    call them without a confirmed cost.
  - **No batch helpers** in the client. Chunking and queueing live in the
    service, on top of `bulk-jobs`, since there's nothing to merge.
  - **Paging without a known total.** Until the paging response is known,
    `allListings()` stops at the first short page, and re-reads the first page
    at the end to see if the count moved, the same torn-snapshot check
    Afternic's walk does.
  - **Analytics is a snapshot, not a series.** One call per name returning
    counters (shape unverified). There's no account-level total and no date
    range, so DomBot keeps daily snapshots itself and diffs them for a
    per-day series.
  - **Money is already dollars.** No conversion layer; the client only checks
    for whole, non-negative numbers.
- **Rate limiting:** a per-account token bucket like Afternic's, but with the
  rate as a setting (default 60 a minute) until Atom publishes one or 429s
  show it; honor `Retry-After` if it ever appears. Reads retry on 429, 5xx and
  network errors with backoff; writes don't.
- **Daily-capped calls** (appraisal) have their own counter, reset at the
  daily boundary the 429 implies, so DomBot can say "3 of 10 appraisals left
  today" instead of failing.
- **Optional data stays optional:** analytics counters, category, description,
  discount and syndication flags are null when absent, never a made-up 0.

### Testing

- **Unit tests** against fixtures, as for Afternic: error-in-200 parsing,
  token redaction, paging stop conditions, the no-retry rule for writes, the
  limiter, the daily-cap counter.
- **Fixtures need a live account first.** The specs don't give real response
  shapes, so the first live session's job is to capture list, details, sales,
  analytics, syndication, categories, grading and appraisal responses, then
  replace names and amounts before committing them (the repo is public).
- **Live tests** (`*.live.test.ts`) skip when `ATOM_API_TOKEN` and
  `ATOM_USER_ID` are missing, under the same `npm run test:live`.
- **Live writes on one dedicated Standard listing**: reprice and restore,
  discount and remove it (does `discount=0` clear it?), set and restore
  category and description, verify DNS, remove and re-add. Never Premium
  writes or boosts from tests: they cost credits or need a support ticket to
  undo.

## What it means for DomBot

### Settings: Markets

An Atom card in the Markets section, built the same way as Afternic's:

- **One card per Atom account**, keyed by account id, editable name.
- **Credentials:** API token and user id, with a link to Dashboard → API
  Access and a note that API access is a beta that needs approval (and 500+
  listings). Saving runs `listListings({ limit: 1 })`; because errors arrive as
  HTTP 200, the test must check the body, not the status.
- **What the account gets**, after the test: listing counts by type
  (Standard, Plus, Premium, Geo), sales count, syndication-authorized count,
  appraisals left today.
- **Sync:** on/off, schedule, last synced, last error, and the ⋯ menu, as for
  registrar and Afternic cards.
- **Rate limit** as an advanced field (default 60 a minute), since Atom
  doesn't publish one.
- **No listing defaults.** Atom's seller preferences (installments, Make an
  Offer and its threshold, negotiation, auto-pilot discounts, automatic price
  increases) have no API. Link to the dashboard instead.
- Storage is the same as Afternic: `market-credentials` and `market-accounts`,
  encrypted on desktop, carried in bundles. An Atom market account can instead
  point at an AtomRegistrar registrar account (see "One provider, registrar
  and market").

### Listings

- **Columns and filters:** listed on Atom, listing type (Standard, Plus,
  Premium, Geo), status (from sync; expect `Approved`, `Seller Approved`,
  pending review, rejected, needs DNS), current discount, primary category,
  and analytics (views, shortlists, trackers).
- **Asking price sync.** Only DomBot's BIN price maps (to `selling_price`);
  DomBot's minimum offer and floor (`domain-list-prices`) have nowhere to go
  on Atom. Show that plainly in the editor ("Atom uses the BIN price only").
  A BIN under $100 can't be listed retail. Non-USD prices can't be pushed.
  Same read-first, push-later order as Afternic.
- **Discounts** are a separate, weekly action: "Discount on Atom until
  Monday" from the table or the domain page, kept out of the asking price.
- **List on Atom** for a selection: Standard or Plus straight away; Premium
  only after a confirm showing the credit cost, and better after grading says
  the name is premium-fit. Then offer to point nameservers at
  `ns1/ns2.atom.com` (required for Premium, recommended otherwise) through the
  registrar, and call `verifyDns`.
- **Nameservers:** `src/renderer/lib/nameservers.ts` should recognize
  `ns1/ns2.atom.com` as Atom's marketplace pair, `ns*.atomregistrar.com` as
  Atom parking, and `ns1/ns2.squadhelp.com` as the old name for the former.
- **Exclusivity.** Premium listings are exclusive to Atom except for names in
  `syndication-authorized-domains`, and Premium also needs Atom's nameservers,
  while an active Afternic listing wants Afternic's. DomBot is the one place
  that sees both, so it should flag: a Premium Atom name listed on Afternic but
  not syndication-authorized; a name listed on both whose nameservers point at
  only one; and block (with an explanation) listing a Premium name elsewhere.
- **Things to flag:** names on Atom nameservers but not listed, listings for
  names no longer in any registrar account, names awaiting DNS verification.

### Sales

- **Import sales as `sold` events** from `all-sales`: date, price,
  commission. If the sale record has no commission, derive it from listing
  type and price (7.5%, 15%, or the Premium bracket) and mark it estimated.
- **No sales workflow in the API.** No transaction status updates, no auth-code
  submission, no messages, so the Afternic "send auth code" automation has no
  Atom equivalent. Atom's transfer instructions (push to Atom's escrow account
  at the same registrar, or hand over a code) stay in Atom's dashboard.
- **Payment plans** (Atom's installments) may appear on sale records;
  handle them like Afternic leases once the shape is known.

### Leads, offers and messages

Neither API has them. Atom's closest signals are analytics counters:
shortlists and price trackers (buyers who asked to be told when the price
changes). Show those next to Afternic's lead counts as "interest", and flag
names with trackers as candidates for a discount, since Atom emails trackers
when a discount is added.

### Reporting

- **Interest over time:** Atom analytics is a per-name snapshot, so sync
  takes a snapshot per name on a slow rotation (10,000 names at 60 a minute is
  about three hours) and stores daily rows; changes between snapshots become
  the series. Prioritize names the user opens and names with trackers.
- **Sales report** across markets: gross, commission, net by year and by
  market; sell-through by Atom listing type.
- **Grading and appraisal** results stored per name, as columns ("Atom:
  premium fit", "Atom appraisal") that age visibly, since appraisals are
  capped and can't be refreshed in bulk.

### MCP

Atom adds cases to the market tools from the Afternic plan wherever the
concept exists, and says "not supported for atom" where it doesn't.

Accounts: **`market_list`**, **`market_test`**, **`market_sync`**,
**`market_set_enabled`** work unchanged.

Listings:

- **`market_listings`** gains Atom filters: `listingType` (`standard`,
  `plus`, `premium`, `geo`), `category`, `hasDiscount`, `minTrackers`,
  `syndicationAuthorized`. Afternic-only filters are ignored for Atom rows.
- **`domain_listing_get`**: includes Atom's type, status, discount, category,
  description and analytics.
- **`domain_listing_set`**: `buyNow` maps to the selling price; `minOffer`
  and `floor` are rejected for `market: "atom"` with a clear message. Adds
  `listingType` (create only), `description` and `category`, which Afternic
  ignores or rejects. A Premium create requires `confirmSpend: true`.
- **`domain_listing_delete`**: Standard and Plus; Premium returns the support
  route instead.
- **`market_listings_set`** / **`market_listings_delete`**: work, but for
  Atom they always return a DomBot bulk job id (not an Atom job), and
  `market_job_get` reads DomBot's job.
- **`market_listings_relist`**: not supported for Atom.

New tools, because the concept is Atom's alone (written with a `market`
parameter anyway, in case another market grows one):

- **`domain_listing_discount_set`**: a temporary discount (`amount`, 0 to
  clear). Atom only.
- **`domain_listing_verify`**: ask the market to re-check DNS. Atom only.
- **`domain_listing_boost`**: `kind` (`standard`, `super`), requires
  `confirmSpend: true`; the description says it spends credits.
- **`market_categories`**: the category lists for `category` values.
- **`market_grading_submit`**, **`market_grading_get`**: submit names for AI
  grading, read results.
- **`domain_appraisal_get`**: Atom's appraisal for one name, and appraisals
  left today. (If Afternic or GoDaddy appraisals are added later they become
  cases here.)

Stats and sales:

- **`market_stats_get`**: not supported for Atom (no account-level stats);
  the description points to `domain_stats_get`.
- **`domain_stats_get`**: Atom returns the latest snapshot plus DomBot's
  stored daily rows, not a native series.
- **`market_sales`**, **`market_sale_get`**: Atom sales from sync.
- **`market_sale_auth_code_set`**, **`market_sale_message_send`**: not
  supported for Atom.

Settings: **`market_settings_get`** / **`market_settings_set`**: not
supported for Atom (no API).

### Atom as a registrar

The registrar API (32 operations: list/get domains, availability single and
bulk of 50, TLD pricing, register, renew, transfer in single and bulk of 10,
nameservers with `atom`/`parking`/`custom` types, DNS records and DNSSEC, URL
forwards, privacy, auto-renew, lock, contacts) is a good fit for
registrar-client as a new `atom` registrar, which would let DomBot sync names
held at AtomRegistrar like any other account. It's a separate piece of work in
that repo, not part of this client. Things it would hit:

- Transfer-out is dashboard-only: unlocking (`locked: false`) and EPP codes
  aren't in the API, so `getAuthCode` and unlock are `NotImplementedError`.
  That also means the Afternic auth-code automation can't work for names held
  at Atom.
- Nameserver `type: "atom"` is the marketplace pair, so for a name registered
  at Atom, "List on Atom" can set nameservers and verify in two calls.
- The specs describe two tokens (seller `api_token` in the query, registrar
  token as `Bearer`), both issued from the same Dashboard → API Access page.
  Whether one token works for both is unverified (open question 9).

### One provider, registrar and market

Atom is the first of several providers that are both a registrar and a
market: Dynadot and Namecheap have marketplace APIs too, and DomBot will add
them. Often one API key covers both sides. DomBot shouldn't make the user enter
the same key twice or keep two cards in step, so:

- **A market account can be backed by a registrar account.** It stores
  `registrarAccountId` instead of its own credentials, and reads them from
  `registrar-credentials` at call time. Rotating the key on the registrar card
  fixes both. When the provider uses separate keys (as Atom's specs suggest),
  the market account keeps its own entry in `market-credentials`, still linked
  to the registrar account.
- **The link also says the names are the same account's.** For a linked pair,
  DomBot knows which registrar account holds a listed name without matching by
  name across accounts, which makes "List on Atom" (set `atom` nameservers,
  verify) and the exclusivity and nameserver checks exact.
- **Settings:** the registrar card for such a provider gets a "Marketplace"
  row ("Also sell on Atom": off, on with this key, or on with a separate key),
  and the market card shows "Uses the AtomRegistrar key" with a link back.
  Markets with no registrar side (Afternic, Sedo) are unaffected.
- **Enable separately.** Selling stays opt-in per account even when the key
  allows it: turning on a registrar account never starts listing sync.
- **Removing** a registrar account that backs a market account asks whether
  to remove both, or keep the market account and enter its own key.
- **MCP:** `market_list` shows `registrarAccountId` for linked accounts, so an
  agent can go from a listing to the registrar tools for the same name.
- **Code stays split:** the registrar side in registrar-client, the market
  side in `src/core/markets/<provider>/`. The shared piece is credentials and
  the account link, which live in DomBot's services and storage.

## Phases

1. **Spec check with a key:** capture every seller read's real response
   (list, details, sales, analytics, syndication, categories, grading,
   appraisal), record the "Observed" table properly, ask Atom about rate
   limits and bulk.
2. **Client, read side:** auth and redaction, error-in-200 parsing, paging,
   limiter, every read; fixtures and live read tests.
3. **Client, write side:** add, remove, reprice, discount, category,
   description, verify, grading submit, boost; live round-trip on one Standard
   name.
4. **DomBot, read-only:** Atom card in Settings → Markets, listing and sales
   sync, columns, `sold` events, nameserver recognition, exclusivity and
   nameserver conflict flags; read-only MCP cases.
5. **DomBot, writes:** list/delist/reprice/discount/categorize from the table
   through DomBot bulk jobs, List on Atom with nameserver change and verify,
   appraisal and grading on the domain page; MCP write cases and new tools.
6. **DomBot, reporting:** analytics snapshots into daily rows, interest
   signals, cross-market sales report.

Separately, in registrar-client: an `atom` registrar.

## Afternic and Atom compared

| Concept          | Afternic                                                                      | Atom                                                                                             |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Auth             | `sso-key KEY:SECRET` header, User-Agent required                              | `api_token` + `user_id` in the query string                                                      |
| API style        | REST, JSON bodies, proper verbs and statuses                                  | RPC-ish: writes are `GET`s, errors are HTTP 200 with `{ message }`                               |
| Spec             | OpenAPI 3.0, full schemas                                                     | OpenAPI 3.0, almost no response schemas                                                          |
| Listing          | "domain" under `/domains`                                                     | "domain" under `/domains`, `/domain-details`                                                     |
| Listing kinds    | one kind; lander type (`BUY_NOW`, `REQUEST_PRICE`, …)                         | Standard, Plus, Premium (curated, reviewed, paid submission, exclusive), Geo                     |
| Prices           | `buynowPrice`, `minbidPrice` (min $20), `floorPrice`                          | `selling_price` only, plus a weekly `discount`; min offer is an account-wide %, floor not in API |
| Money            | USD microunits, whole dollars                                                 | USD integer dollars                                                                              |
| Statuses         | `ACTIVE`, `PENDING`, `INACTIVE`, `FAILED_COMPLIANCE`, …                       | unverified (`Approved`, `Seller Approved`, pending review, …)                                    |
| Activation       | point NS at Afternic; `PENDING` → `ACTIVE`; relist `RESYNC`/`REACTIVATE`      | Premium needs Atom NS; Standard NS or TXT; `verify-dns` triggers the check                       |
| Exclusivity      | none                                                                          | Premium is exclusive except syndication-authorized names                                         |
| Merchandising    | lander options, `hidden`                                                      | categories, description, boost (paid)                                                            |
| Sales            | list/get with status, commission, payout dates, lease installments, auth code | one list call; shape unverified                                                                  |
| Sale workflow    | submit auth code, message the transaction agent                               | none                                                                                             |
| Stats            | daily views and leads, account and per name, up to 365 days                   | per-name snapshot counters (views, shortlists, trackers); no account level, no dates             |
| Search demand    | GoDaddy searches 30/90/365d (Domain Pro members)                              | none; Atom grading and appraisal instead                                                         |
| Leads, offers    | lead counts in stats; `offerCount` include                                    | shortlists and price trackers                                                                    |
| Bulk             | `$each` up to 500, async CSV jobs                                             | none; one name per call                                                                          |
| Account settings | get/update listing defaults                                                   | none in API                                                                                      |
| Rate limit       | 150/min, `Retry-After`                                                        | unpublished; 10/day appraisal                                                                    |
| Valuation        | none                                                                          | appraisal (estimate, score, signals, TM conflicts)                                               |
| Registrar        | separate (GoDaddy)                                                            | AtomRegistrar API, same company; may share a key                                                 |

Only Afternic: min offer and floor, daily stats series, search counts, sale
workflow (auth codes, messages), bulk and jobs, account settings, relist.

Only Atom: listing tiers with different commission and exclusivity,
discounts, categories and descriptions, boosts, DNS verification on demand,
syndication rights, AI grading, appraisal, a registrar API from the same
company.

### A first cut of the shared interface

For `src/core/markets/types.ts`, once both clients exist. Don't build it yet;
it's here to check that both APIs fit. The idea is a small common core that
every market fills, a capability set that says what else it can do, and each
market's own extras kept on the side rather than squeezed into the core.

```ts
type MarketId = 'afternic' | 'atom';

interface MarketCapabilities {
  minOffer: boolean; // afternic
  floor: boolean; // afternic
  discount: boolean; // atom
  batchWrites: number | null; // afternic: 500; atom: null
  jobs: boolean; // afternic
  dailyStats: boolean; // afternic
  accountStats: boolean; // afternic
  saleAuthCode: boolean; // afternic
  saleMessages: boolean; // afternic
  accountSettings: boolean; // afternic
  verifyDns: boolean; // atom
  appraisal: boolean; // atom
  exclusiveTiers: boolean; // atom
}

interface MarketListing {
  market: MarketId;
  name: string; // ASCII
  status: 'active' | 'pending' | 'inactive' | 'rejected' | 'unknown';
  rawStatus: string;
  tier: string | null; // atom: standard/plus/premium/geo; afternic: null
  buyNow: number | null; // whole USD; null = make offer
  minOffer: number | null;
  floor: number | null;
  discount: number | null;
  listedAt: string | null;
  extra: AfternicListingExtra | AtomListingExtra;
}

interface MarketSale {
  market: MarketId;
  id: string;
  name: string;
  soldAt: string; // YYYY-MM-DD
  price: number; // whole USD
  commission: number | null;
  commissionEstimated: boolean;
  net: number | null;
  installments: { paid: number; total: number } | null;
}

interface MarketInterest {
  // per name, per day; whatever the market reports
  views: number | null;
  leads: number | null; // afternic
  shortlists: number | null; // atom
  trackers: number | null; // atom
  searches30d: number | null; // afternic, Domain Pro
}

interface MarketClient {
  readonly market: MarketId;
  readonly capabilities: MarketCapabilities;
  allListings(): Promise<MarketListing[]>;
  getListing(name: string): Promise<MarketListing | null>;
  allSales(since?: string): Promise<MarketSale[]>;
  setListing(name: string, change: ListingChange): Promise<WriteResult>;
  deleteListing(name: string): Promise<WriteResult>;
}
```

Accounts sit outside the client: a `MarketAccount` record has `market`,
`label`, `enabled`, and either its own credentials or a `registrarAccountId`
to borrow them from (Atom now, Dynadot and Namecheap later). The client takes
resolved credentials and never knows which.

Bulk stays out of the interface: the service asks `capabilities.batchWrites`
and `jobs`, and uses market batches, market jobs, or DomBot bulk jobs
accordingly. Statuses map to the five common values with the raw one kept.

## Open questions

1. Rate limit for the seller API, and whether Atom offers bulk endpoints or a
   higher limit for large portfolios. (Ask service@atom.com.)
2. Real response shapes for list, details, sales, analytics and syndication,
   and what paging metadata comes back. Needs a key.
3. Is `discount` a dollar amount (as in Sheets) or a percent, and does `0`
   clear it?
4. Does `add-domain` accept `plus` and `geo`, and does `price=0` (or
   `selling_price=0`) mean Make an Offer through the API?
5. Which `source_of_deduction` spends AI credits now that coins and points are
   gone?
6. Does a sale record include commission and payout, and how do payment-plan
   sales look?
7. Can a seller token call the partnership or trademark endpoints, or only
   seller and appraisal? (Matters only if trademark checks move up.)
8. Is the appraisal daily cap per token, and does it reset at midnight UTC?
9. Does one Atom token work for both the seller and registrar APIs, or are
   they always separate? And is the seller `user_id` the same account as the
   registrar's? This decides whether the Atom market account usually borrows
   the registrar key or keeps its own.
