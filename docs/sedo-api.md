# Sedo API

Plan for a Sedo client inside DomBot, and for what DomBot builds on it, with
the overlap with Afternic (docs/afternic-api.md) worked out so the two can
share one market model. Docs: <https://api.sedo.com/apidocs/v1/Basic/>. The
WSDL is at <https://api.sedo.com/api/v1/?wsdl>.

Nothing here has been checked against the live API: there are no Sedo
credentials in `.env`, and getting them takes a Sedo partner account (see
"Credentials"). Everything below is from the docs, read 2026-10-27; claims to
verify first are collected under "Open questions".

## The API at a glance

Sedo has two API editions. The **Basic API** covers a customer account:
listings, portfolio bundles, parking statistics and parking settings, plus a
marketplace search. The **Service Provider API** adds account management
(create accounts, edit personal and bank data, change passwords) for
registrars that resell Sedo; DomBot doesn't need it.

32 functions in the Basic API:

| Group                   | Functions                                                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listings                | `DomainInsert`, `DomainEdit`, `DomainDelete`, `DomainList`, `DomainListExtended`, `DomainStatus`                                                                                                         |
| Portfolios (bundles)    | `CreatePortfolio`, `AddPortfolioDomain`, `DeletePortfolioDomain`, `DeletePortfolio`                                                                                                                      |
| Parking stats and money | `DomainParkingFinalStatistics`, `DomainParkingPayments`, `DomainParkingSubIdReport`                                                                                                                      |
| Parking settings        | `GetDomainSetup`, `SetDomainSetup`, `GetKeyword`, `SetKeyword`, `SetKeywordForTopMarkets`, `GetParkingTemplateList`, `GetTemplate`, `SetTemplate`, `ResetTemplate`, `GetRelatedLinks`, `SetRelatedLinks` |
| Marketplace             | `DomainSearch`, `CheckBlacklist`                                                                                                                                                                         |
| Account                 | `CheckMember`                                                                                                                                                                                            |
| Reference lists         | `DomainCategories`, `DomainLanguages`, `Countries`, `States`, `KeywordMarkets`                                                                                                                           |

Conventions:

- **Transport:** SOAP 1.1, RPC/encoded (`urn:SedoInterface`), at
  `https://api.sedo.com/api/v1/`. Most functions can also be called as plain
  HTTP: `GET` or `POST` to `https://api.sedo.com/api/v1/<Function>` with
  form parameters and `output_method=xml`. The docs warn against loading the
  WSDL in PHP because "this API version doesn't always implement it
  correctly".
- **Auth:** on every call, in the parameters: `partnerid` and `signkey`
  (identify the integrating partner), and `username` and `password` (the
  Sedo account's own login; password max 16 characters). Public functions
  (`DomainStatus`, `DomainSearch`, `CheckBlacklist`) need only the partner
  pair.
- **Responses:** XML. Success is a `<SEDOLIST>` of `<item>`s whose fields
  carry `xsd:` type attributes; failure is a `<SEDOFAULT>` with `faultcode`
  (`E1`…`E11101`) and `faultstring`. Batch calls answer per name with
  `domain`, `status` (`ok` or a fault code) and `message`.
- **Money:** decimal amounts (`double`, "500.00") with a per-listing
  `currency`: `0` EUR, `1` USD, `2` GBP. `0` means "no price". A fixed price
  must be at least 199 in USD or EUR, and the minimum price can't exceed the
  price.
- **Names:** ACE (punycode) in requests and responses, except
  `DomainParkingSubIdReport`, which returns IDN form.
- **Dates:** `YYYY-MM-DD` for stats; `YYYY-MM-DD HH:MM:SS` with no time zone
  for insert dates, which "in some cases" are a UNIX timestamp instead.
- **Flags:** `0`/`1` for listing fields, `Y`/`N` for domain setup, booleans
  elsewhere, and `CheckBlacklist` returns its boolean as an integer over GET.
- **Batches:** 50 names per write; 100 per `DomainList` page "per SOAP
  request" (the GET limit isn't stated); 100 for domain setup and templates;
  stats pages up to 500 over SOAP or 10,000 over GET.
- **Rate limits:** none documented. Faults `E11` ("try again in five
  minutes") and `E17` ("We are busy") are the only throttling signals.
- **Inserts are asynchronous:** a new listing has to pass checks first and
  isn't in `DomainList` until it does; failures are reported **by email**,
  not through the API.

### What only works over SOAP

These functions have no GET/POST form: the portfolio functions,
`GetDomainSetup`, `SetDomainSetup`, `GetKeyword`, `SetKeywordForTopMarkets`,
`GetTemplate`, `SetTemplate`, `ResetTemplate`, `GetRelatedLinks`,
`SetRelatedLinks`. Everything DomBot needs first (listings, stats, payments,
`SetKeyword`, `CheckMember`, reference lists) works over plain HTTP.

## What to implement

### Implement

| Function                              | Why DomBot wants it                                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CheckMember`                         | The connection test for Settings → Markets: proves all four credentials in one call.                                                                                                                                                                               |
| `DomainList`, `DomainListExtended`    | The listing snapshot: for sale or not, price, minimum price, fixed price, currency, categories, language. Extended adds the insert date, lifetime parking earnings and per-keyword parking stats. Basis of sync.                                                   |
| `DomainInsert`                        | List on Sedo from DomBot.                                                                                                                                                                                                                                          |
| `DomainEdit`                          | Reprice, toggle for sale, change fixed price.                                                                                                                                                                                                                      |
| `DomainDelete`                        | Delist.                                                                                                                                                                                                                                                            |
| `DomainStatus`                        | Public check of any name: on Sedo or not, for sale, price, **visitors per month**. Confirms a listing went live after the asynchronous insert, and gives traffic for names DomBot hasn't synced. Partner-only auth, so it works before the user's login is set up. |
| `DomainParkingFinalStatistics`        | Daily visitors, clicks and earnings per name or account (last 31 days), monthly for 12 months. Sedo's only traffic data, and the one market with parking revenue.                                                                                                  |
| `DomainParkingPayments`               | Parking payouts per month, for income reporting.                                                                                                                                                                                                                   |
| `DomainCategories`, `DomainLanguages` | Inserts need a language and accept up to 3 categories; DomBot needs the lists to offer them. Cache them; they rarely change.                                                                                                                                       |

### Defer

- **Parking optimization** (`SetKeyword`, `GetKeyword`,
  `SetKeywordForTopMarkets`, templates, related links, domain setup):
  parking-page tuning, a feature area of its own. `SetDomainSetup` is the one
  to pick up first, because its `buyBox` flag controls whether the parked
  page shows the "buy this domain" box, which matters to selling. Most of the
  rest is SOAP-only.
- **Portfolios:** Sedo bundles sold together. Create, add, remove and delete
  exist, but there's no function to list portfolios or their domains, so
  DomBot couldn't show or sync them. Revisit if a user asks.
- **`DomainParkingSubIdReport`:** only for "selected customers" with sub-ID
  tracking.
- **`DomainSearch`:** searches other people's listings. Useful later for
  comparable asking prices, but it's buyer-side.

### Leave out

- The Service Provider API's account functions (`CreateAccount`,
  `EditAccount`, `ChangePassword`, bank data), and `Countries`/`States`,
  which only those use.
- `CheckBlacklist`: a pre-check `DomainInsert` already does, reporting
  `E3111` for a blacklisted name.

### What Sedo doesn't have

No sales, no offers, no leads or inquiries, no payouts for sales, no
lease-to-own, no floor price, no listing status beyond for sale / not for
sale, and no bulk job API. Sales on Sedo keep coming into DomBot the way they
do now: recorded by hand or imported from Sedo's CSV export (already a known
format in `src/shared/import-columns.ts`).

## Credentials

Sedo needs four values, and two of them don't come from the seller's account:

- **Partner ID and sign key** belong to a Sedo partner, the party
  integrating the API. Getting them means applying to Sedo. DomBot is open
  source and self-hosted, so it can't ship a shared sign key; each user
  applies for their own pair. Settings explains this and links to Sedo.
- **Username and password** are the Sedo account's login, sent on every
  call. Changing the password on sedo.com breaks the connection; the card
  says so when `CheckMember` fails with `E6`.

Because the password travels with each request, the client always uses
`POST` with a form body, never `GET`: a query string ends up in proxy and
server logs. All four values go in the encrypted `market-credentials`
namespace, as the Afternic plan describes.

## Where the client lives

`src/core/markets/sedo/`, beside Afternic, with the same layout:

```
src/core/markets/sedo/
  client.ts       SedoClient: one method per function
  types.ts        listing, stats, payment types (decimal strings, currency codes)
  wire.ts         XML request encoding and response parsing
  convert.ts      wire shapes → types
  errors.ts       SedoError (fault code + fault string)
  fixtures.ts     the docs' example responses, for tests
  *.test.ts
```

Where Sedo forces a different design from Afternic:

- **Requests are form-encoded, responses are XML.** Arrays are sent PHP style
  (`domainentry[0][domain]=…`, `domainentry[0][category][]=1`), as the docs'
  `http_build_query` examples produce. Responses go through `fast-xml-parser`
  (already a DomBot dependency, and Worker-safe) with values kept as strings
  and coerced explicitly, as registrar-client does for Namecheap.
- **Errors arrive as a `SEDOFAULT` document,** probably with HTTP 200, so the
  client checks the body, not the status. `E11` and `E17` are retried with
  backoff; everything else isn't.
- **`DomainEdit` replaces, it doesn't patch.** `forsale`, `price`,
  `minprice`, `fixedprice` and `currency` are all required, so a one-field
  change is read, merge, write. The client hides that: `updateListing(name,
{ price })` reads the current listing first.
- **No paging totals.** `DomainList` takes `startfrom` and `results` and
  returns no total, so `allListings()` stops at a short page.
- **Rate limiting** is a guess until tested: start at one request a second
  per account, shared per account like Afternic's limiter.
- **SOAP, later:** the deferred functions need a hand-built SOAP 1.1
  envelope. RPC/encoded arrays are verbose but small to write; no SOAP
  library, which wouldn't run in the Worker anyway.

## What it means for DomBot

### Listings

- **Sedo accounts in Settings → Markets,** one card per account like
  Afternic's, with the four credential fields, the partner-program note, and
  `CheckMember` as the test.
- **Currency fits DomBot better than Afternic does.** DomBot's asking price
  already has a currency; Sedo takes EUR, USD or GBP per listing, so a
  DomBot price in one of those pushes as-is. Others need converting or are
  refused.
- **Pending inserts are DomBot's to track.** After `DomainInsert`, a name is
  "pending on Sedo" until `DomainList` or `DomainStatus` shows it; a name
  still missing after a few days is flagged ("Sedo may have rejected it;
  check your email").
- **Fixed price vs. asking price.** Sedo's `price` with `fixedprice: 1` is a
  Buy Now price; with `fixedprice: 0` it's an asking price open to offers,
  and `minprice` is the lowest offer Sedo forwards. DomBot shows which.
- **Categories and language** are Sedo-only fields; DomBot asks for them when
  listing on Sedo, defaulting language from the name.

### Reporting

- **Parking revenue:** daily visitors, clicks and earnings per name and for
  the account, and monthly payouts. Afternic has no parking data in its API,
  so this is new.
- **Traffic:** Sedo's visitors per month (from `DomainStatus`) and daily
  parking visitors sit next to Afternic's lander views.
- Fetch daily stats once a day; the last 31 days are available per day, older
  ones only as monthly totals, so DomBot keeps the daily rows itself.

### MCP

The market tools in the Afternic plan take `market: 'sedo'` with no new
tools. Where Sedo lacks something, the tool says so instead of returning
empty data: `market_sales` and `market_sale_*` fail with "Sedo's API has no
sales", `domain_listing_set` refuses `floor` and lease-to-own fields.
`market_stats_get` and `domain_stats_get` return Sedo's visitors, clicks and
earnings. Sedo-only extras: `market_categories_get` and
`market_payments_get` (parking payouts).

## Shared with Afternic

### Concepts side by side

| Concept                      | Afternic                                                | Sedo                                                              |
| ---------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| Auth                         | API key + secret in a header                            | partner ID + sign key + username + password in every request body |
| Transport                    | REST, JSON                                              | SOAP, or form POST with XML back                                  |
| Listing key                  | ACE name                                                | ACE name                                                          |
| Buy Now price                | `buynowPrice` (USD microunits)                          | `price` with `fixedprice: 1`                                      |
| Asking price, offers welcome | Request Price lander (`PRICE_FORM`), no shown price     | `price` with `fixedprice: 0`                                      |
| Minimum offer                | `minbidPrice`, at least $20                             | `minprice`                                                        |
| Floor (auto-accept)          | `floorPrice`                                            | none                                                              |
| Currency                     | USD only                                                | EUR, USD or GBP per listing                                       |
| Listing status               | 7 states (`ACTIVE`, `PENDING`, `FAILED_COMPLIANCE`, …)  | for sale or not; pending is "not in the list yet"                 |
| Hidden / not for sale        | `hidden`                                                | `forsale: 0` (stays parked)                                       |
| Lease-to-own                 | yes                                                     | no                                                                |
| Lander / parked page         | lander type and options per listing, account defaults   | parking template, buy box, keywords per name                      |
| Extra listing data           | Fast Transfer, registrar, offer count, GoDaddy searches | categories (up to 3), language, parking keywords                  |
| Traffic stats                | daily views and leads, 365 days, per name or account    | daily visitors, clicks, earnings for 31 days, then monthly        |
| Money stats                  | none                                                    | parking earnings and payouts                                      |
| Sales                        | full history with commission, payouts, leases           | none                                                              |
| Offers / leads               | lead counts only                                        | none                                                              |
| Bulk writes                  | 500 per call, plus CSV jobs                             | 50 per call                                                       |
| Bulk reads                   | 500 per page, with totals                               | 100 per page, no totals                                           |
| Per-name batch results       | `{ code, error }` keyed by name                         | `{ domain, status, message }` list                                |
| Account defaults             | lander and lease settings                               | none (`SetDomainSetup` can apply to all)                          |
| Rate limit                   | 150/min, 429 with Retry-After                           | undocumented; `E11`/`E17`                                         |

### What overlaps

The common core is small and clear: **a name listed on a market, at a price,
with a minimum offer, for sale or not; per-name results for bulk writes; and
daily traffic.** That's also exactly what DomBot's asking price
(`ListPrice`: amount, min offer, floor, currency) already models, so the
shared shape should be built around it.

### A first cut of the shared shapes

For `src/core/markets/types.ts`, extracted once the Sedo client exists. Each
market's client keeps its own types; a small adapter per market
(`src/core/services/markets/<market>.ts`) maps them into these:

```ts
type MarketId = 'afternic' | 'sedo';

interface MarketListing {
  market: MarketId;
  accountId: string;
  /** ASCII (punycode), lowercase. */
  name: string;
  /** DomBot's own words; `statusRaw` keeps the market's. */
  status:
    'active' | 'pending' | 'not_for_sale' | 'rejected' | 'on_hold' | 'sold';
  statusRaw: string;
  /** Canonical decimal strings, like ListPrice. Null when unset. */
  buyNow: string | null;
  minOffer: string | null;
  floor: string | null;
  currency: CurrencyCode;
  /** True: buyers can buy outright at buyNow. False: asking price, offers. */
  fixedPrice: boolean;
  leaseToOwn: { enabled: boolean; maxPayments: number | null } | null;
  listedAt: string | null;
  updatedAt: string | null;
  /** Market-specific fields, typed per market. */
  extra: AfternicExtra | SedoExtra;
}

interface MarketListingInput {
  name: string;
  buyNow?: string | null;
  minOffer?: string | null;
  floor?: string | null;
  currency?: CurrencyCode;
  fixedPrice?: boolean;
  forSale?: boolean;
}

interface MarketListingResult {
  name: string;
  ok: boolean;
  /** Pending: accepted, not live yet (Sedo inserts, Afternic verification). */
  pending: boolean;
  error: { code: string; message: string } | null;
}

interface MarketDailyStats {
  date: string; // YYYY-MM-DD
  views: number | null; // Afternic views, Sedo visitors
  leads: number | null; // Afternic only
  clicks: number | null; // Sedo only
  earnings: string | null; // Sedo only, with currency
  currency: CurrencyCode | null;
}

interface MarketCapabilities {
  currencies: CurrencyCode[];
  floor: boolean;
  leaseToOwn: boolean;
  sales: boolean;
  leads: boolean;
  parkingEarnings: boolean;
  asyncInsert: boolean;
  writeBatch: number; // 500 / 50
  readPage: number; // 500 / 100
}

interface MarketAdapter {
  readonly market: MarketId;
  readonly capabilities: MarketCapabilities;
  test(): Promise<void>;
  allListings(): Promise<{ listings: MarketListing[]; complete: boolean }>;
  getListings(names: readonly string[]): Promise<MarketListing[]>;
  upsertListings(
    inputs: readonly MarketListingInput[],
  ): Promise<MarketListingResult[]>;
  deleteListings(names: readonly string[]): Promise<MarketListingResult[]>;
  accountStats(days: number): Promise<MarketDailyStats[]>;
  domainStats(name: string, days: number): Promise<MarketDailyStats[]>;
}
```

Notes on that cut:

- **Money is decimal strings with a currency,** like DomBot's `ListPrice`,
  not Afternic's whole-dollar numbers. The Afternic adapter converts; the
  Afternic client stays as it is.
- **Capabilities drive the UI and MCP:** no floor field for Sedo, no sales
  tab for Sedo, earnings columns only where `parkingEarnings` is true. No
  market-name checks scattered through the app.
- **Sales stay Afternic-shaped** until a second market has a sales API; the
  `sold` event is the shared part, not the sale record.
- **Batching belongs in each adapter,** since the sizes differ tenfold and
  Afternic adds jobs; callers pass any number of names.
- Afternic's `fixedPrice` maps from its lander: `BUYNOW` (and a Buy Now
  price) is true; `PRICE_FORM` is false. Check this reading against how
  Afternic actually sells a `PRICE_FORM` listing with a Buy Now price set.

## Testing

- **Unit tests** against the docs' example XML (success, `SEDOFAULT`, batch
  results with mixed `ok` and fault codes), plus the request encoding of
  nested arrays, the read-merge-write in `updateListing`, the insert-date
  timestamp quirk, and retry on `E11`/`E17`.
- **Live tests** (`*.live.test.ts`, `npm run test:live`) once there are
  credentials, skipping without `SEDO_PARTNER_ID`, `SEDO_SIGN_KEY`,
  `SEDO_USERNAME`, `SEDO_PASSWORD`: `CheckMember`, list, extended list,
  `DomainStatus`, stats, payments, reference lists.
- **Live writes on one dedicated test name,** like domanio.com for Afternic:
  insert, wait for it to appear, edit and restore, delete.

## Phases

0. **Credentials:** apply for Sedo partner access; add the four values to
   `.env`. Nothing live can be verified before this.
1. **Client, read side:** form-POST transport, XML parsing, faults, retries;
   `CheckMember`, `DomainList`, `DomainListExtended`, `DomainStatus`,
   parking statistics and payments, categories and languages.
2. **Client, write side:** insert, edit (read-merge-write), delete, in
   batches of 50.
3. **Shared market model:** `src/core/markets/types.ts` and the two
   adapters, then switch the Afternic sync, Settings → Markets and the MCP
   tools onto it. Best done after Afternic's DomBot phase 4, so it's
   extracted from working code.
4. **DomBot:** Sedo accounts, listing sync, pending-insert tracking, parking
   reporting, MCP cases.
5. **Later:** SOAP transport and the deferred parking functions, starting
   with `SetDomainSetup`'s buy box.

## Open questions

1. **Partner access:** can an individual seller get a partner ID and sign
   key, or does Sedo only grant them to businesses? If DomBot (or its hosted
   instance) became the partner, how would self-hosted users authenticate?
2. **Rate limits:** what are they, and what does exceeding them return?
3. **HTTP status of faults:** 200 with a `SEDOFAULT` body, or 4xx/5xx?
4. **GET/POST limits:** is `DomainList` over POST capped at 100 like SOAP,
   or at 10,000 like the stats functions?
5. **Earnings currency and time zone:** which currency are parking earnings
   in, and which zone are dates and insert times in (likely CET)?
6. **Pending inserts:** does a name awaiting checks appear anywhere in the
   API, or only by its absence?
7. **What `minprice` does on a fixed-price listing:** ignored, or a floor for
   offers alongside Buy Now?
8. **`DomainEdit` on a name with open offers or in transfer** fails with
   `E3124`/`E5101`/`E5102`; are those listings shown as locked anywhere
   before an edit is tried?
