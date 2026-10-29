# Sedo API

Plan for a Sedo client inside DomBot, and for what DomBot builds on it, with
the overlap with Afternic (docs/afternic-api.md) worked out so the two can
share one market model. Docs: <https://api.sedo.com/apidocs/v1/Basic/>. The
WSDL is at <https://api.sedo.com/api/v1/?wsdl>.

**Status: built and verified live, reads and writes.** The client
(`src/core/markets/sedo/`), the adapter (`src/core/services/markets/sedo.ts`)
and the registry entry are in place, so Sedo accounts can be added in
Settings → Markets, sync, show in the Domains columns and work through the
MCP tools. Reads, inserts, edits and deletes were checked against a live
account on 2026-10-28 (see "Observed"). What's left is under "Unverified",
below.

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
`SetRelatedLinks`. Everything DomBot uses (listings, stats, payments,
`CheckMember`, reference lists) works over plain HTTP, so DomBot needs no
SOAP at all.

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

- **Portfolios:** Sedo bundles sold together. Create, add, remove and delete
  exist, but there's no function to list portfolios or their domains, so
  DomBot couldn't show or sync them. Revisit if a user asks.
- **`DomainParkingSubIdReport`:** only for "selected customers" with sub-ID
  tracking.
- **`DomainSearch`:** searches other people's listings. Useful later for
  comparable asking prices, but it's buyer-side.

### Leave out

- **Parking configuration** (`SetKeyword`, `GetKeyword`,
  `SetKeywordForTopMarkets`, templates, related links, `GetDomainSetup`,
  `SetDomainSetup`): DomBot won't configure parked pages. It shows Sedo's
  parking views and earnings, and nothing more (decided 2026-10-28).
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
  wire.ts         form encoding, XML parsing, wire shapes → values
  errors.ts       SedoError (fault code + fault string)
  fixtures.ts     the docs' example responses, for tests
  index.ts
  *.test.ts
```

Where Sedo forces a different design from Afternic:

- **Requests are form-encoded, responses are XML.** Arrays are sent PHP style
  (`domainentry[0][domain]=…`, `domainentry[0][category][0]=1`), as the docs'
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
  pending until Sedo puts it up for sale. It shows in `DomainList` within
  seconds, but not for sale while Sedo verifies ownership (see "Observed").
  Sync keeps it pending meanwhile and notes on the account card that
  verification is waiting on sedo.com. A name that never shows up is
  dropped after a week with a note that Sedo may have refused it.
- **Fixed price vs. asking price.** Sedo's `price` with `fixedprice: 1` is a
  Buy Now price; with `fixedprice: 0` it's a "Seller's asking price" open to
  offers, and `minprice` is the lowest offer Sedo forwards. DomBot doesn't
  use the asking price, as aftermarket's Sedo driver didn't: such a listing
  reads as offers only, every price DomBot sends is Buy Now (`fixedprice:
1`), and an edit that leaves the price alone keeps what Sedo has.
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
empty data: `market_sales` for a Sedo account fails with "its API has no
sales", the sale actions fail the same way, and `domain_listing_set` refuses
`floor` and lease-to-own fields.
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

### The shared model

The shared types, capabilities, storage, bulk path and MCP list for all
markets are in [markets.md](markets.md), which replaces the first cut that
was here. It keeps this plan's choices of decimal strings with a currency
and capability-driven UI, turns `fixedPrice` into the shared `buyNow` flag,
and moves `forsale` out of the status into a `forSale` flag. Sales are now
shared (Afternic and Atom both have them); Sedo's capabilities say it has
none.

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

0. **Credentials:** Sedo partner access, and the four values in `.env`.
   **Done** (2026-10-28).
1. **Client, read side** (built, verified live): form-POST transport, XML
   parsing, faults, retries; `CheckMember`, `DomainList`,
   `DomainListExtended`, `DomainStatus`, parking statistics and payments,
   categories and languages.
2. **Client, write side** (built, verified live): insert, edit
   (read-merge-write), delete, in batches of 50.
3. **Sedo adapter** into the shared model ([markets.md](markets.md)) and
   its registry entry (built, verified live).
4. **DomBot** (built, verified live): Sedo accounts in Settings → Markets,
   listing sync with pending-insert tracking, the Domains columns, parking
   stats as account and per-name traffic, and the MCP cases, including
   `market_categories_get` and `market_payments_get`.
5. **Verify:** reads, writes and the verification hold done 2026-10-28;
   the small items under "Unverified" below are left, then replace the
   docs-based fixtures with recorded shapes.
6. **Not planned:** parking configuration, and with it any SOAP transport.

## What the build decided

Choices made without live answers, each easy to change once checked:

- **Every call is a form POST** to `/api/v1/<Function>` with
  `output_method=xml`. The docs only show GET for the plain-HTTP interface
  and say "GET / POST"; POST keeps the password out of URLs.
- **Retries:** faults `E11`, `E17` and `E2000` (statistics unavailable) are
  retried 3 times at 2, 4 and 8 seconds, for writes too, since a busy fault
  means nothing happened. Network and 5xx failures are retried for reads
  only. `E11` says "try again in five minutes", which these retries won't
  wait out; the next sync does.
- **Pace:** 60 requests a minute per account, shared like Afternic's
  limiter (`src/core/markets/rate-limit.ts`, now used by both).
- **A new listing** gets a Buy Now price when it has a price (as on Afternic
  and in DomBot's asking price), USD unless told, language `en` unless told,
  no categories, for sale. A Buy Now price under 199 USD or EUR is refused
  before sending (fault `E3123`), with a hint to leave the price empty for
  offers only, with a minimum offer.
- **Pending inserts:** a name `DomainInsert` accepted is stored `pending`.
  Sync keeps it while Sedo's list doesn't have it, for up to 7 days, then
  drops it and notes on the account card that Sedo may have refused it.
  This is gated by the `asyncInsert` capability, not by market name.
- **Edits are taken as live at once:** the saved listing is the merged one,
  with no read-back. The next sync corrects it if Sedo applies edits later.
- **Every listed name is `active`;** `forSale` carries for sale or parked.
- **Parking earnings have no currency** in the shared stats
  (`currency: null`) until it's known which one Sedo reports.
- **Per-name traffic** uses `DomainParkingFinalStatistics` period 1 with a
  `domain`, 31 days at most, through the same rotation as Afternic's.
- **An empty account** (fault `E15`, "There is no data for your request")
  reads as no listings, and "no statistics" faults (`E15`, `E2102`, `E2104`)
  as no rows.

## Observed

Checked live on 2026-10-28 against an account with 43 listings
(`npm run test:live`, read-only):

- **Form POST works** for every read DomBot uses, with `output_method=xml`.
  The docs only show GET.
- **Partner ID and sign key alone** are enough for `DomainStatus`;
  `DomainCategories` and `DomainLanguages` need no auth at all.
- **Faults come with HTTP 200** and a `SEDOFAULT` body. A wrong password is
  `E6` ("Wrong password for this username").
- **`DomainList` order isn't by name** (`orderby=0` notwithstanding), but
  `startfrom` is a plain 0-based offset into a stable order, so paging
  works.
- **A name filter fails as a whole** with `E2104` ("does not belong to you,
  or is not in our parking system database") if any one name isn't on the
  account, even when the others are. The client splits a failing lookup in
  halves until the unlisted names drop out. Without that, listing a new
  name (which looks it up first) would fail.
- **A month with no parking payments** is fault `E2102` ("Statistics for
  this date do not exist"), read as no payments.
- **Field formats:** `currency` is `1` (USD) in lists and `"USD"` in
  `DomainStatus`; `DomainListExtended`'s `inserted` is
  `YYYY-MM-DD HH:MM:SS`; `domainlanguage` was empty on every listing; every
  listing had category `990000` (not in the documented category list,
  presumably "uncategorized"); no listing had a price set, only a minimum
  price, and none was fixed price.
- **Editing an existing listing works, and category `990000` means none.**
  domainpost.com, priced at 12,000 USD from DomBot (2026-10-28), kept its
  minimum price and went from category `990000` to no category, so Sedo
  accepts `990000` back on an edit and treats it as uncategorized. It
  stayed for sale: the ownership hold is only for newly listed names.
- **A name another Sedo account lists** can't be inserted: `DomainInsert`
  answers `E3131` ("The domain has already been found in another account.
  Ownership of this domain will be verified further."), and the name stays
  out of yours. Seen with domanio.com, which a stale listing elsewhere
  offers at €1,500. Whether Sedo then contacts the owner, and whether the
  name later moves to your account, is unknown. `DomainStatus` shows such a
  name as on Sedo, so the write test checks it first.
- **Writes** (2026-10-28, on domainio.com, a name on no Sedo account):
  `DomainInsert` with `domainentry[0][…]` arrays answered `ok`, and the
  name appeared in `DomainList` within about 15 seconds, but **not for
  sale** (`forsale: 0`) although it was sent for sale, presumably until
  Sedo's checks pass. `DomainEdit` changes showed at once and the
  read-merge-write kept every other field; switching to a fixed price
  worked. `DomainDelete` took effect at once: the name left the list, and
  `DomainStatus` showed it on no account. A delete sent before an insert
  shows up misses it, so the write test waits for the name first.
- **New names start not for sale, and can't be put up for sale yet.**
  Every name inserted (a re-added one, domainio.com, and one never on any
  Sedo account, based.domains) appeared in `DomainList` with `forsale: 0`
  within 15–50 seconds, and an edit to `forsale: 1` failed with `E3124`
  ("you cannot change your domain's status from Not for Sale to For Sale,
  because there are either open bids on your domain or your domain is
  currently in transfer"), with no bids or transfer. Sedo is evidently still
  checking the name; the API says nothing more. DomBot adds a hint to that
  fault.
- **That check is ownership verification.** Sedo's dashboard lists such
  names under "Ownership Verification Pending" (domainio.com, and
  domanio.com from the `E3131` attempt). It's done on sedo.com: for some
  names through the registry, for others by adding a TXT record Sedo gives.
  The API neither reports it nor offers a way to complete it, so DomBot
  keeps a name it listed pending while Sedo shows it not for sale, and says
  on the account card to finish verification on sedo.com.
  Sedo accepts verification by its nameservers, a TXT record holding the
  account's verification ID, or a CNAME from that ID to `verify.sedo.com.`;
  DomBot's plan for doing this itself is in markets.md, "Ownership
  verification".
- **Once verified, Sedo puts the name up for sale itself.** domainio.com was
  listed at 5,000 USD and Sedo's TXT ID added to its DNS at 05:00 UTC on
  2026-10-28; by 06:35 UTC it was for sale at that price, with nothing sent
  from DomBot. So DomBot only has to wait: it keeps the name pending until
  Sedo shows it for sale.
- **`DomainStatus` answers in its own order,** not the order asked; the
  client matches by name.
- **Parking stats:** period 1 gives 31 daily rows for the account, and for
  one name when `domain` is set; period 3 gives 12 monthly rows.
  `payout_status` didn't say "Estimated" on any row.

## Unverified

Still to check:

1. **Edit details:** what `minprice` does on a fixed-price listing, and
   whether the 199 Buy Now minimum applies in GBP.
2. **Parking earnings:** which currency they're in, and the
   `payout_status` values. Every row on the account checked was zero.
3. **Rate limits:** what happens past 60 a minute, and whether `E11`/`E17`
   are what Sedo sends when throttling.
4. **An empty account:** an empty list or `E15`.
5. **E3131 follow-up:** whether Sedo's TXT check moves a name another
   account lists into yours. domanio.com, now on 101domain's nameservers
   with Sedo's TXT ID, is still in the other account at €1,500 (06:35 UTC,
   2026-10-28).

Then replace `src/core/markets/sedo/fixtures.ts`, which is the docs'
examples, with recorded shapes (made-up names, as Afternic's), and remove
`UNVERIFIED` comments as each item is confirmed.

## Open questions

Answered live and moved to "Observed": faults come with HTTP 200, and a
name awaiting checks is listed, not for sale. Rate limits, earnings
currency and `minprice` on a fixed price are under "Unverified".

1. **Partner access:** can every seller get a partner ID and sign key, or
   does Sedo only grant them to some? If DomBot (or its hosted instance)
   became the partner, how would self-hosted users authenticate?
2. **GET/POST limits:** is `DomainList` over POST capped at 100 like SOAP,
   or at 10,000 like the stats functions?
3. **Time zone:** which zone are dates and insert times in (likely CET)?
4. **`DomainEdit` on a name with open offers or in transfer** fails with
   `E3124`/`E5101`/`E5102`; are those listings shown as locked anywhere
   before an edit is tried?
