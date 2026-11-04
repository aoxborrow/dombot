# Spaceship SellerHub API

Plan for a Spaceship SellerHub market inside DomBot, on the shared model in
[markets.md](markets.md), written to sit beside docs/afternic-api.md,
docs/atom-api.md and docs/sedo-api.md. Docs:
<https://docs.spaceship.dev/#tag/SellerHub> (a Redoc page; its OpenAPI 3
spec is embedded in the page as `__redoc_state`, which is the easiest way
to read the schemas). Spaceship's release notes for SellerHub are at
<https://www.spaceship.com/blog/sellerhub-updates/>.

**Status: planned, nothing built, no live calls yet.** Everything below is
from the spec and Spaceship's pages as read on 2026-11-03.

SellerHub is the first market that is also a registrar DomBot already
supports, and the first to work with a key DomBot already holds. The
Spaceship registrar account's API key and secret reach SellerHub as well,
given the `sellerhub:*` scopes, so this is where the registrar-backed market
account from atom-api.md ("One provider, registrar and market") and
markets.md ("Storage", `registrarAccountId`) gets built.

## The API at a glance

Same host, auth and conventions as the registrar API that registrar-client's
`spaceship` already uses: `https://spaceship.dev/api`, `X-API-Key` and
`X-API-Secret` headers, JSON bodies, proper verbs and statuses. Eleven
operations under `/v1/sellerhub`:

| Operation                   | Call                                                                    | Scope   | Limit (per user) |
| --------------------------- | ----------------------------------------------------------------------- | ------- | ---------------- |
| `getSellerHubDomainList`    | `GET /domains?take&skip&status`                                         | `read`  | 300 / 300 s      |
| `getSellerHubDomain`        | `GET /domains/{domain}`                                                 | `read`  | 300 / 300 s      |
| `createSellerHubDomain`     | `POST /domains`                                                         | `write` | 300 / 300 s      |
| `updateSellerHubDomain`     | `PATCH /domains/{domain}`                                               | `write` | 300 / 300 s      |
| `deleteSellerHubDomain`     | `DELETE /domains/{domain}`                                              | `write` | 300 / 300 s      |
| `getSoldDomains`            | `GET /domains/reports/sold?take&cursor&saleDateTimeFrom&saleDateTimeTo` | `read`  | 300 / 300 s      |
| `getVerificationRecords`    | `GET /verification-records`                                             | `read`  | 10 / 60 s        |
| `createCheckoutLink`        | `POST /checkout-links`                                                  | `write` | 300 / 300 s      |
| `getSafePayTransactionList` | `GET /safepay-transactions?take&skip`                                   | `read`  | 300 / 300 s      |
| `createSafePayTransaction`  | `POST /safepay-transactions`                                            | `write` | 300 / 300 s      |
| `getSafePayTransaction`     | `GET /safepay-transactions/{id}`                                        | `read`  | 60 / 300 s       |

- **A listing** ("SellerHub domain") is `name` (A-label), `unicodeName`,
  `displayName` (the seller's capitalization), `description` (up to 5,000
  characters), `status`, `binPrice` + `binPriceEnabled` (Buy It Now), and
  `minPrice` + `minPriceEnabled` (Make an Offer with a minimum). Nothing
  else: no id, no dates, no lease-to-own terms, no For Sale page settings.
- **Money** is `{ amount: "10.99", currency: "USD" }`: a decimal string with
  at most two places, and the schema only allows `USD`. That is DomBot's
  `Amount` as is.
- **Names** in a path can be Unicode or ASCII; create takes `name` in
  Unicode.
- **Writes** answer with the listing as saved (create 201, update 200), so no
  read-back is needed. Delete is 204. No bulk endpoint: one name per call.
- **Paging:** listings and SafePay use `take` (1–100, required) and `skip`
  (required) with a `total`; the sold report uses an opaque `cursor`.
- **Errors** are `application/problem+json` with `detail` and, for 422, a
  `data` list of `{ field, details }`, plus a `spaceship-error-code` header
  (`business.…`, `application.…`, `infrastructure.…`) and a
  `spaceship-operation-id` header. 429 sends `Retry-After` and the
  `X-RateLimit-*` headers.

Listing statuses, from the spec:

| SellerHub        | Meaning (spec)                                   | DomBot     |
| ---------------- | ------------------------------------------------ | ---------- |
| `verifying`      | ownership verification in progress               | `pending`  |
| `onSale`         | listed for sale                                  | `active`   |
| `onSaleStopped`  | sale stopped, no longer listed                   | `inactive` |
| `failed`         | could not be processed (unexpected error)        | `rejected` |
| `saleProcessing` | a purchase is in progress                        | `on_hold`  |
| `privateSale`    | an open SafePay transaction, not publicly listed | `on_hold`  |
| `leaseActive`    | a lease-to-own sale not yet finalized            | `on_hold`  |
| `sold`           | sold and transferred to the buyer                | `sold`     |

`forSale` is true only for `onSale`.

### From Spaceship's pages

- **Commission:** 10% on sales since February 2026 (was 5%); checkout links
  and lease-to-own agreements stay at 5%; SafePay paid by Bitcoin or wire is
  3% (May 2026). Buyer and seller can split it. The sold report's `payout`
  makes DomBot's commission exact, so none of these rates need to be coded.
- **External names** (held at other registrars or other Spaceship accounts)
  need ownership verification, once per listing (a Spaceship rep on
  NamePros). Names in the same Spaceship account don't.
- **Payout** happens when the name reaches Spaceship, not the buyer. Names
  already at Spaceship move internally.
- **The dashboard has more than the API:** statistics (views, visitor
  locations, Spaceship search results), leads and offers in chat,
  lease-to-own terms, For Sale page settings (on or off, Buy It Now, Make an
  Offer, Contact Owner, Seller Portfolio link), Quality Offer deposits,
  payouts, and CSV exports of most tabs.
- **Roadmap** (upcoming, no dates): "External API: For Sale Page
  Management" and "External API: Lease-to-Own Management".

## What to implement

### Implement

| Operation                | Why DomBot wants it                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `getSellerHubDomainList` | Sync: every listing with status, prices and description, 100 a page with a `total` to check `complete` against.                              |
| `getSellerHubDomain`     | `getListings` for a few names (404 means not listed).                                                                                        |
| `createSellerHubDomain`  | List on SellerHub from the List and Delist dialog, at DomBot's asking price and minimum offer.                                               |
| `updateSellerHubDomain`  | Reprice, minimum offer, Buy It Now and Make an Offer on or off, display name, description. Only the fields sent change.                      |
| `deleteSellerHubDomain`  | Delist. The only way the API takes a name off sale.                                                                                          |
| `getSoldDomains`         | Sales: name, sale time, price, payout and channel, from a given time onwards, so sync reads only what's new.                                 |
| `getVerificationRecords` | The account's ownership verification records. The first market whose API returns them, so DomBot fills the Ownership Verification ID itself. |

### Defer

- **Checkout links and SafePay** (`createCheckoutLink`, SafePay list and
  get): tools for a deal with a buyer, not built for any market yet. A
  checkout link might later become a shared "get a checkout link" in the
  market model (Dynadot's Express Pay Links are the same idea). SafePay
  deals could also show as sales under way for `privateSale` names, but
  `saleStatus` (the post-payment state) only comes back to brokers, and the
  sold report covers the finished sale.
- **A sale record for `saleProcessing` and `leaseActive` listings** before
  the sold report has them: the listing has no price, date or id for one.
  See open question 1.
- **Spaceship's CSV exports** (Statistics, Leads, Leasing) through DomBot's
  import, for the data the API doesn't have. Only if users ask.

### Leave out

- **`createSafePayTransaction`:** opens an escrow deal and invites the other
  party by email. That's brokering, not portfolio management, and it reaches
  a person.
- **Lease-to-own and For Sale page settings:** not in the API yet (on the
  roadmap). Revisit when Spaceship ships them.

### What SellerHub doesn't have

In the API, at least: no listing ids or dates, no floor (auto-accept)
price, no discounts or tiers, no traffic or stats, no leads, offers or
messages, no lease-to-own terms, no sale ids, buyers or kinds (only the
channel: `spaceshipSearch`, `forSalePage`, `checkoutLink`, …), no payout
dates, no way to stop or restart a sale short of deleting it, no "check
ownership now", no bulk, and no account settings. Checkout links can be
created but not listed or deactivated.

## Credentials: borrowing the Spaceship registrar key

This is the first build of "One provider, registrar and market"
(atom-api.md). `MarketAccount.registrarAccountId` is in the record already;
nothing sets or reads it yet.

- **Adding a SellerHub account** in Settings → Markets asks which Spaceship
  registrar account it belongs to and uses that account's key: no second
  copy of the key, no `market-credentials` entry. A **separate key** is the
  fallback, for a Spaceship account that isn't connected as a registrar (or
  a key with only SellerHub scopes); that one is stored in
  `market-credentials` like any other market's.
- **Credentials are read at call time** from `registrar-credentials` for a
  linked account, so rotating the key on the registrar card fixes both.
  The registry's `create(accountId, credentials)` doesn't change; the
  service that resolves an account's credentials learns to follow the link.
- **Scopes decide access.** A registrar key made before SellerHub, or
  without its scopes, gets 403 from `/v1/sellerhub`. The market card's test
  says so and points at Spaceship's API Manager ("Add sellerhub:read, and
  sellerhub:write to list from DomBot"). A key with only `sellerhub:read`
  syncs; writes fail with the same message.
- **Enabled separately.** Linking never turns on listing sync for the
  registrar account, and disabling the registrar account doesn't disable the
  market account (or the reverse).
- **The cards point at each other:** the market card shows "Uses the key of
  <registrar account name>" with a link; the registrar card shows which
  SellerHub account uses its key.
- **Removing** a registrar account that backs a market account asks whether
  to remove both, or keep the market account and enter a key for it.
- **The link also says which names are the same account's.** A listed name
  held by the linked registrar account needs no ownership verification, and
  its sale transfer is internal to Spaceship. DomBot knows that without
  matching names across accounts.
- **Data bundles** need nothing new: a linked account has no secret of its
  own.
- **MCP:** `market_list` shows `registrarAccountId`, so an agent can go from
  a listing to the registrar tools for the same name.
- **Code stays split:** the SellerHub client lives in
  `src/core/markets/spaceship/` beside Atom's and Sedo's, not in
  registrar-client. The two share only the key and the host.

Rate limits are per user and per operation. Whether SellerHub calls and
registrar calls on the same key share a budget is unknown (open question 7);
the market client paces itself at 60 a minute regardless.

## What it means for DomBot

The market id is `spaceship`, the same as the registrar, shown as
"Spaceship SellerHub".

### Listings

| `MarketListing`                           | From SellerHub                                                |
| ----------------------------------------- | ------------------------------------------------------------- |
| `name`                                    | `name` (A-label)                                              |
| `displayName`                             | `displayName`, else `unicodeName` when it differs from `name` |
| `status`                                  | the table above; `statusRaw` is SellerHub's word              |
| `forSale`                                 | `status === 'onSale'`                                         |
| `price`                                   | `binPrice` when `binPriceEnabled`, else null                  |
| `buyNow`                                  | `binPriceEnabled`                                             |
| `minOffer`                                | `minPrice` when `minPriceEnabled`, else null                  |
| `floor`, `discount`, `leaseToOwn`, `tier` | null: not in the API                                          |
| `currency`                                | `USD`                                                         |
| `listedAt`, `updatedAt`                   | null: not in the API                                          |
| `extra`                                   | `{ market: 'spaceship', description }`                        |

Writes, one name per call through the bulk runner (`writeBatch: 1`, market
jobs above 10 names, as for Atom):

- **New listing:** `POST /domains` with the Unicode name, `binPrice` and
  `binPriceEnabled: true` when a price is given, `minPrice` and
  `minPriceEnabled: true` when a minimum offer is given, and the display
  name and description when set.
- **Change:** `PATCH` with only what changed. `price: null` turns Buy It Now
  off and `minOffer: null` turns Make an Offer off; SellerHub keeps the old
  amounts. A saved listing that differs from the request goes in `adjusted`.
- **`forSale: false`** is refused with "SellerHub's API can't pause a sale;
  delist instead". Nothing in the API stops or restarts one.
- **Floor, discount, lease-to-own, a currency other than USD:** refused
  with a message, never dropped (markets.md, "Capabilities").
- **Delist:** `DELETE`.

At 60 calls a minute, pushing prices to 1,000 names takes about 17 minutes.
Reading 10,000 listings is 100 calls.

### Sales

`getSoldDomains` from the last sale DomBot has (`saleDateTimeFrom`),
everything on the first sync:

| `MarketSale`                          | From the sold report                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| `id`                                  | `${name}:${saleDateTime}`: the report has no transaction id |
| `soldOn`                              | the UTC date of `saleDateTime`                              |
| `status`                              | `completed` (open question 1)                               |
| `kind`                                | `buy_now` for `checkoutLink`, else `unknown`                |
| `price`                               | `salePrice` (gross)                                         |
| `net`                                 | `payout`                                                    |
| `commission`                          | `salePrice − payout`, `commissionEstimated: false`          |
| `paidOutOn`, `installments`, `action` | null                                                        |

Completed sales become `sold` events as for every market. A record with a
null `saleDateTime` (the spec allows one) is keyed by name alone and only
read on full syncs, since date filters drop it.

The sale steps on the Sales tab don't apply: SellerHub has no auth-code or
message endpoint, and for a name in the same Spaceship account the move is
internal. For an external name the seller has to get it to Spaceship
(open question 5); DomBot's Unlock and auth-code steps work on the
registrar side, but handing the code to Spaceship stays in SellerHub.

### Ownership verification

- **The value comes from the API.** On save and on each test, DomBot reads
  `getVerificationRecords` and fills the account's Ownership Verification ID
  from the TXT option (`TXT @ <token>`), so there's nothing to paste. The
  field shows it read-only. If Spaceship only offers the A/AAAA option
  (records at `_spaceship_verify`), DomBot shows the records and doesn't
  apply them (TXT only, as for every market).
- **Ownership verification TXT…** works unchanged with that value, and is
  skipped for names the linked registrar account holds.
- **No Recheck ownership.** There's no "check now" endpoint (`verifyDns:
false`); SellerHub checks on its own and the listing goes from
  `verifying` to `onSale`.
- **No market nameservers.** Nothing in the API asks for them. The For Sale
  page looks like a connection on Spaceship's own DNS (the release notes
  talk of "removing connections (e.g. URL redirects)" when sale pages are
  turned on), so the market declares no nameserver set (open question 6).

### Reporting and the demo

No traffic, so no SellerHub stats in Reporting. The demo gets a SellerHub
account linked to its fake Spaceship registrar account
(`src/core/demo/markets.ts`), with listings in each status and a few sales.

### Capabilities

```ts
const SPACESHIP_CAPABILITIES: MarketCapabilities = {
  currencies: ['USD'],
  minOffer: true,
  floor: false,
  discount: false,
  leaseToOwn: false, // in the dashboard; the API is on the roadmap
  tiers: null,
  sales: true,
  saleAuthCode: false,
  saleMessages: false,
  accountStats: false,
  domainStats: null,
  leads: false,
  parkingEarnings: false,
  searchCounts: false,
  accountSettings: false,
  relist: false,
  verifyDns: false,
  asyncInsert: false,
  writeBatch: 1,
  jobs: false,
  spends: false,
  rateLimit: 60, // 300 per 300 seconds per user, per operation
};
```

### MCP

The shared listing, sales and account tools work for SellerHub through its
capabilities. No SellerHub-only tools for now.

## Testing

Unit tests map fixtures built from the spec's examples. Live tests follow
Atom's: reads with the key in `.env` (`SPACESHIP_API_KEY`,
`SPACESHIP_API_SECRET`), and a write round trip behind
`SPACESHIP_LIVE_WRITES=1` on `SPACESHIP_TEST_DOMAIN`. Only domanio.com or
domainio.com; both are held at 101domain, so they cover verification. A
name held at Spaceship, for the internal path, needs the user's pick.

## Phases

1. **Registrar-backed market accounts:** the Settings flow, credentials
   resolved through `registrarAccountId`, the cards pointing at each other,
   remove-both, `market_list`. Built for SellerHub, written so Atom (#180),
   Dynadot and Namecheap can use it.
2. **Read side:** client (auth, problem+json errors, paging, cursor,
   limiter), adapter, registry entry, listings and sales sync, `sold`
   events, verification records into the ID, Settings card with the scope
   check, demo account. Live reads.
3. **Writes:** list, reprice, minimum offer, display name, description,
   delist, through the List and Delist dialog, the bulk runner and the MCP
   listing tools. Live round trip on one test name.
4. **Later:** lease-to-own and For Sale page settings, when Spaceship's API
   has them.

## Open questions

1. Does the sold report include sales still under way (`saleProcessing`,
   `leaseActive`), or only finished ones? For a lease-to-own sale, is
   `salePrice` the lease total, and when does it appear?
2. Can an existing API key be given the SellerHub scopes, or does the user
   need a new key (and so update the registrar card too)?
3. With Buy It Now off, does the For Sale page still show `binPrice`? Can
   Make an Offer be on without a minimum (`minPriceEnabled: false`), or does
   that turn offers off?
4. Does deleting a listing with an open lead or checkout link cancel them?
   Is there any API path to `onSaleStopped` and back?
5. After a sale of an external name, what does Spaceship need: a transfer
   in with an auth code entered in SellerHub, or a push from another
   Spaceship account? Could DomBot's sale steps cover more of it?
6. Does an external name's For Sale page need its DNS at Spaceship, or does
   the listing only show in Spaceship search and the Seller Portfolio until
   it does?
7. Are the rate limits per key or per user, and do SellerHub and registrar
   calls share them?
8. How is a description cleared: an empty string, or `null`?
9. Does create answer `verifying` for an external name and `onSale` for one
   in the same account, and how long does verifying take?
