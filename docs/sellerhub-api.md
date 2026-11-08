# Spaceship SellerHub API

Plan for a Spaceship SellerHub market inside DomBot, on the shared model in
[markets.md](markets.md), written to sit beside docs/afternic-api.md,
docs/atom-api.md and docs/sedo-api.md. Docs:
<https://docs.spaceship.dev/#tag/SellerHub> (a Redoc page; its OpenAPI 3
spec is embedded in the page as `__redoc_state`, which is the easiest way
to read the schemas). Spaceship's release notes for SellerHub are at
<https://www.spaceship.com/blog/sellerhub-updates/>.

**Status: planned, nothing built.** Written from the spec and Spaceship's
pages (2026-11-03), with a few live reads on the key in `.env`
(2026-11-07, "Credentials" and "Ownership verification").

SellerHub runs on the Spaceship registrar's API with the same key and
secret, given the `sellerhub:*` scopes. So it's a registrar-backed market
account, the second after Dynadot's (PR #254,
docs/dynadot-marketplace-api.md), which built them: SellerHub uses that
build as it is.

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
- **External names** (held at other registrars, or since December 2025 in
  other Spaceship accounts) need ownership verification. Names in the same
  Spaceship account don't. The check is once per listing: changing a
  listing's settings later doesn't trigger another, but a name delisted and
  added again is checked again (Spaceship's rep and users on NamePros).
- **Checking now:** SellerHub checks in the background, and since August
  2025 its dashboard has a **Verify Domains** button that checks on the
  spot. The API has nothing like it.
- **Payout** happens when the name reaches Spaceship, not the buyer. Names
  already at Spaceship move internally.
- **The dashboard has more than the API:** statistics (views, visitor
  locations, Spaceship search results), leads and offers in chat,
  lease-to-own terms, For Sale page settings (on or off, Buy It Now, Make an
  Offer, Contact Owner, Seller Portfolio link), Quality Offer deposits,
  payouts, and CSV exports of most tabs.
- **Roadmap** (upcoming, no dates): "External API: For Sale Page
  Management", "External API: Lease-to-Own Management" and "Improvement to
  external domain verification".

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
ownership now" (the dashboard's Verify Domains), no bulk, and no account
settings. Checkout links can be
created but not listed or deactivated.

## Credentials: the Spaceship registrar key

Dynadot's market (PR #254) built registrar-backed market accounts, the plan
from atom-api.md ("One provider, registrar and market"). SellerHub takes
them as built; `registrar: 'spaceship'` on its `MarketInfo` turns them on.

- **Adding an account** in Settings → Markets picks one of your Spaceship
  registrar accounts (one market account per registrar account: two would
  read the same listings twice). The market account keeps no credentials of
  its own and calls with the registrar account's key, through its proxy
  route when it has one, so a rotated key reaches it at once. The market
  card refuses a key change and points at Settings → Registrars.
- **No separate key.** The build doesn't offer one, and SellerHub doesn't
  need it: the key is the same either way, and a Spaceship account that
  isn't connected yet is added as a registrar first, with nothing in it if
  need be. (The first draft of this plan had a separate-key fallback.)
- **The cards link one way.** The market card shows the registrar account
  in a box (its logo and name) that opens its card in Settings → Registrars
  (`?tab=registrars&account=<id>`). The registrar card doesn't point back
  yet, and removing a registrar account doesn't ask about the market
  account: the market card then says the registrar account is gone. Both
  are left open for every registrar-backed market (#254, "Phases"), not
  built here.
- **Scopes decide access,** which is where Spaceship differs from Dynadot,
  whose keys have none. A key without SellerHub's scopes gets 403 from
  `/v1/sellerhub`; the account test says so and points at Spaceship's API
  Manager ("Add sellerhub:read, and sellerhub:write to list from DomBot"). A
  key with only `sellerhub:read` syncs, and writes fail with the same
  message. The key in `.env` reads SellerHub (2026-11-07: listings, sold
  report and verification records answered 200, beside the registrar's
  domain list); whether it can write is unchecked.
- **The adapter gets the context:** the registry's `create` passes the
  registrar account's id and, with a proxy, a `fetch` through it. The client
  sends every call with that `fetch`, and its limiter is keyed by the
  registrar account, as Dynadot's is.
- **Names the linked account holds** come back with `held` set to
  `'spaceship'` in `extra`, every other name `'elsewhere'`, as Dynadot's
  do. SellerHub doesn't say which, so the adapter reads the account's own domain list
  (`GET /v1/domains`, the same key) beside the listings. A held name needs
  no ownership verification and moves internally after a sale.
- **Data bundles and MCP** need nothing new: a linked account has no secret
  of its own, and `market_list` already shows `registrarAccountId`.
- **Code stays split:** the SellerHub client lives in
  `src/core/markets/spaceship/` beside the other markets', not in
  registrar-client. The two share only the key and the host.

Rate limits are per user and per operation. Whether SellerHub calls and
registrar calls on the same key share a budget is unknown (open question 7);
the market client paces itself at 60 a minute regardless. Dynadot plans one
limiter for a key's registrar and market calls (not built yet); SellerHub
needs it less, since its limits are per operation and the registrar's bulk
lane already spaces Spaceship calls 2 seconds apart.

## What it means for DomBot

The market id is `spaceship`, the same as the registrar, and it's shown as
"Spaceship", as Dynadot's market is "Dynadot". The registrar picker's copy
is built from the market's name ("Spaceship Account", "No Spaceship
registrar account is free"), so the two names have to match. SellerHub
goes in the help text: "Sells your names on Spaceship SellerHub. Uses the
registrar account's API key, which needs SellerHub access."

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
| `extra`                                   | `{ market: 'spaceship', held, description }`                  |

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

- **The value comes from the API,** through the adapter's
  `verificationId()`, which Dynadot added: sync calls it and saves the
  value when it changes, so there's nothing to paste (the field still takes
  one, as Dynadot's does). Seen on the key in `.env` (2026-11-07): one
  option, a TXT record at `@` whose value is a UUID. The spec's A/AAAA
  option at `_spaceship_verify` isn't offered there; if an account only has
  that, DomBot saves nothing (TXT only, as for every market). The
  `spaceship` entry in `src/shared/market-verification.ts` parses a UUID,
  and the TXT value is the UUID itself. Its label and menu path come from
  the dashboard, not yet seen.
- **Ownership verification TXT…** works unchanged with that value. Names
  the linked account holds (`held: 'spaceship'`) never get a verification
  mark, as with Dynadot.
- **Nothing to hold back.** Dynadot refuses an unverified name, so DomBot
  keeps that listing pending and sends it once verified (`listVerified`).
  SellerHub takes the name and keeps it `verifying` itself (open
  question 9), so it doesn't need that.
- **No Recheck ownership.** The API has no "check now" (`verifyDns` is
  false), so the check is SellerHub's background one, or the user's own
  click on **Verify Domains** in the SellerHub dashboard. A name sitting in
  `verifying` says so in its listing cell and points at that button. The
  listing goes to `onSale` when the check passes.
- **No delist and list again to force a check.** It would start a new one,
  but may cost the listing its leads and checkout links (open question 4).
  DomBot doesn't do it on its own.
- **The record stays.** A name delisted and added again is checked again,
  and nobody official has said whether a verified listing survives the
  record being removed (open question 10). DomBot never removes it.
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
Dynadot's: reads with the key in `.env` (`SPACESHIP_API_KEY`,
`SPACESHIP_API_SECRET`), and a write round trip behind
`SPACESHIP_LIVE_WRITES=1` on `SPACESHIP_TEST_DOMAIN`. Only domanio.com or
domainio.com; both are held at 101domain, so they cover verification. A
name held at Spaceship, for the internal path, needs the user's pick.

## Phases

Registrar-backed accounts come with Dynadot (#254), so SellerHub starts
after it merges.

1. **Read side:** client (auth, problem+json errors, paging, cursor, the
   context's `fetch`, a limiter keyed by the registrar account), adapter
   with `held` and `verificationId()`, registry entry on the `spaceship`
   registrar, listings and sales sync, `sold` events, the scope message, the
   verification entry, demo account. Live reads.
2. **Writes:** list, reprice, minimum offer, display name, description,
   delist, through the List and Delist dialog, the bulk runner and the MCP
   listing tools. Live round trip on one test name.
3. **Later:** lease-to-own and For Sale page settings, when Spaceship's API
   has them.

Not here, open for every registrar-backed market: the registrar card
pointing back, the remove-both prompt, and one limiter for a key's
registrar and market calls.

## Open questions

1. Does the sold report include sales still under way (`saleProcessing`,
   `leaseActive`), or only finished ones? For a lease-to-own sale, is
   `salePrice` the lease total, and when does it appear?
2. Answered in part (2026-11-07): the key in `.env` reads SellerHub as it
   is. Still open: whether it can write, and whether a key without the
   scopes can be given them or has to be replaced (and the registrar card
   updated).
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
   in the same account? Does create check right away, the way Verify Domains
   does, and how often does the background check run after that?
10. Once a listing is verified, can the record be removed, or does
    SellerHub check again and take the listing down?
