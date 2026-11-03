# Dynadot Marketplace API

Plan for Dynadot's marketplace (its aftermarket) as a DomBot market, on the
shared model in [markets.md](markets.md), written to sit beside
docs/afternic-api.md, docs/atom-api.md, docs/sedo-api.md and the Spaceship
SellerHub plan (docs/sellerhub-api.md, PR #251). Docs: the RESTful v2
reference at <https://www.dynadot.com/domain/api-document#set_for_sale>
("Aftermarket" section). Dynadot's seller help:
<https://www.dynadot.com/help/question/domain-sale-process>.

**Status: planned, nothing built, no live calls yet.** Everything below is
from the API reference and Dynadot's help pages as read on 2026-11-03. Only
the other-registrar commands run in Dynadot's sandbox, so the build needs
live calls on a test name early (see "Testing").

Dynadot is already a DomBot registrar: registrar-client's `dynadot` speaks
the same RESTful v2 API. The marketplace commands use the same host, the
same API key and secret and the same `X-Signature`, so a Dynadot market
account borrows the registrar account's key, as SellerHub does
(`registrarAccountId`, "One provider, registrar and market" in
atom-api.md).

## The API at a glance

Same conventions as registrar-client's Dynadot provider:
`https://api.dynadot.com/restful/v2/…`, `Authorization: Bearer <key>`, an
`X-Signature` HMAC made with the secret on commands marked "Require
X-Signature" (every write, and some reads), JSON bodies, and the
`{ code, message, data }` envelope.

**Rate limit, per account, by price level** (`price_level` in
`GET /accounts/info`):

| Price level | Threads | Requests       |
| ----------- | ------: | -------------- |
| Regular     |       1 | 60 a minute    |
| Bulk        |       5 | 600 a minute   |
| Super Bulk  |      35 | 6,000 a minute |

"Only 1 request can be processed at a time" on Regular, and a second one
gets a 429. The limit belongs to the account, so marketplace calls and
registrar calls on the same key share it.

About 40 commands sit under the aftermarket heading. Most are for buyers.

**Selling names in the account:**

| Command                                      | Call                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `set_for_sale`                               | `PUT /aftermarkets/domains/{domain}/for_sales`                                                |
| `get_listing_item`                           | `GET /aftermarket/listings/{domain}?currency`                                                 |
| `get_listings`                               | `GET /aftermarket/listings?page&page_size&currency&exclude_pending_sale&show_other_registrar` |
| `domain_list`, `domain_info`                 | `GET /domains`, `GET /domains/{domain}`: `is_for_sale` on each name                           |
| `get_whois_stats`                            | `GET /aftermarket/whois_stats?domain_name&date_type`                                          |
| Express Pay Links: create, get, list, delete | `POST`, `GET`, `DELETE /aftermarket/pay_links[/{domain}]`                                     |
| `add_user_auction`, `close_auction`          | `POST /aftermarket/auctions/{domain}`, `POST /aftermarket/auctions/{id}/close`                |
| `set_`/`get_auction_installment_plan`        | `/aftermarket/auctions/{domain}/installment_plan`                                             |
| `set_other_platform_confirm_action`          | `POST /aftermarket/domains/{domain}/opt_in_fast_transfer`                                     |
| `listing_on_afternic`, `listing_on_sedo`     | `POST /aftermarket/listing_on_afternic`, `…/listing_on_sedo`                                  |

**Selling names held at other registrars** (Dynadot's "open
marketplace"): `add_other_registrar_domain`, `delete_other_registrar_domain`,
`other_registrar_domain_list`, `other_registrar_domain_verification`,
`verify_other_registrar_domain`, `listing_other_registrar_domain`. These run
in the sandbox.

**Buying:** `buy_it_now`, `get_open_auctions`, `get_auction_details`,
`place_auction_bid`, `get_auction_bids`, `get_closed_auctions`, backorders,
expired closeouts, and searching and buying Afternic and Sedo names through
Dynadot (`get_afternic_domain`, `get_sedo_domain`, `buy_afternic_domain`,
`buy_sedo_domain`).

**Webhooks** (Dynadot calls a URL you give it): `domain_status_changed`
(with statuses such as `moved_sold` and change types such as
`bin marketplace`), `order_completed`, `domain_transfer_away`.

Things to know about the reference:

- `set_for_sale`'s path says `aftermarkets` where every other command says
  `aftermarket`. Which one is live is open question 6.
- Error lists are copied between commands (`set_for_sale`'s 409s are grace
  delete's), so the wording of real errors has to come from live calls.
- Nothing about seller sales, offers, leads, views (only WHOIS lookups),
  payouts or the Sale Balance. `accounts/info` has `account_balance`, not
  the Sale Balance.

### `set_for_sale`

The one write for a name in the account. Its answer is `{ code, message }`,
with no listing in it.

| Field                                 | Values                                                                          | Documented as |
| ------------------------------------- | ------------------------------------------------------------------------------- | ------------- |
| `for_sale_type`                       | `not_for_sale`, `marketplace`, `auction`, `portfolio_auction`, `broker_service` | required      |
| `listing_type`                        | `buy_now`, `make_offer`, `buy_now_and_make_offer`                               | required      |
| `price`, `minimum_offer_price`        | decimal strings                                                                 | optional      |
| `currency`                            | 32 codes, including `btc` and the withdrawn `ltl`                               | optional      |
| `installment`, `maximum_installments` | a payment plan for the buyer                                                    | optional      |
| `category`, `sub_category`            | fixed lists (about 60 and 37 values)                                            | optional      |
| `description`                         | text                                                                            | required      |
| `allow_seo_index`                     | boolean                                                                         | optional      |

Whether it changes only the fields sent or replaces the listing isn't
documented (open question 1).

### Reading listings

No seller "my listings" call is documented. What there is:

- **`domain_list`** marks each name `is_for_sale`, with no price.
  DomBot's registrar sync already reads this list (registrar-client's
  `listDomains`), but the flag doesn't reach DomBot today.
- **`get_listing_item`** reads one listing by name: `listing_id`, `price`
  (in the currency asked for, else the account's default), `type` (`bin`,
  `make_offer`, `bin_make_offer`), `is_pending_sale_locked`, the name's
  registration and expiration dates, inbound links, age, and
  `is_huge_domains`. No minimum offer, installments, category,
  description, currency of its own, or listing date. It needs no
  signature, so it looks like the buyer's view of a listing.
- **`get_listings`** pages through listings with the same fields. Its
  parameters (`exclude_pending_sale`, `show_other_registrar`) and the
  `is_huge_domains` flag read like the public marketplace feed. If it
  returns only the account's own listings, it's the sync call (open
  question 2).

### From Dynadot's pages

- **Commission:** 10% of the sale price, no listing fee. Express Pay Links
  are 5%.
- **A marketplace sale needs nothing from the seller.** Dynadot moves the
  name into the buyer's Dynadot account at checkout; the buyer gets a
  15-day Buy Lock. No auth code, no transfer. A name held at another
  registrar adds a transfer fee to the buyer's price.
- **Payout:** proceeds, less the 10%, go to the seller's Sale Balance after
  a processing period (2–3 days on the help page updated 2026-09-18; older
  pages say 5–7). From there they can move to the Account Balance with a
  2% bonus, or be paid out.
- **Afternic and Sedo Fast Transfer:** a name at Dynadot can be confirmed
  so a sale on Afternic or Sedo moves at once (Confirm Afternic, Confirm
  SedoMLS in the dashboard). Names registered or transferred in the last
  60 days don't qualify.

## What to implement

### Implement

| Command                                       | Why DomBot wants it                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain_list` (`is_for_sale`)                 | Which names are listed. From the registrar sync once registrar-client passes the flag through (a small registrar-client change); otherwise the market reads it. |
| `get_listing_item`                            | Price, Buy Now or offers, and a sale under way, per listed name. `getListings`, and sync for each name marked for sale.                                         |
| `get_listings`                                | Sync in one paged read, if it's the account's own listings (open question 2).                                                                                   |
| `set_for_sale` with `marketplace`             | List, reprice, Buy Now and Make Offer, minimum offer.                                                                                                           |
| `set_for_sale` with `not_for_sale`            | Delist.                                                                                                                                                         |
| `accounts/info`                               | The account test, and `price_level` for the rate limit.                                                                                                         |
| Express Pay Links (phase 4)                   | A checkout link at a set price for a buyer the user is talking to; Dynadot can also list and delete them.                                                       |
| `set_other_platform_confirm_action` (phase 4) | Fast Transfer for the Afternic and Sedo listings of names held at Dynadot.                                                                                      |
| Other-registrar commands (phase 5)            | List names held anywhere on Dynadot's marketplace.                                                                                                              |

### Defer

- **Names at other registrars** (phase 5): DomBot users hold names at many
  registrars, and this would put any of them on Dynadot's marketplace. Each
  name is added, verified (TXT, nameservers or CNAME, with the values from
  `other_registrar_domain_verification`), then listed with
  `listing_other_registrar_domain` (prices in cents; Buy Now, asking,
  reserve and minimum offer prices; landing page options). It has a real
  read: `other_registrar_domain_list` gives the sale type, price, verify
  status and transfer status. Big enough for its own design pass once the
  in-account path is live.
- **WHOIS stats:** daily WHOIS lookup counts per name (last 7 or 30 days,
  this year, last year), one call per name. A rough interest signal, not
  views. Maybe a column later.
- **User auctions:** a time-boxed sale from a starting price, with
  auto-relist and installments. DomBot's model is standing listings and has
  no auction state. Revisit if asked.
- **Webhooks:** `domain_status_changed` with `moved_sold` would confirm a
  sale. It needs a public URL, so only the web host's Worker could take it,
  not the desktop app.
- **Category, sub-category, description, search indexing, installments:**
  settable, not readable (see "Listings"). Writing what DomBot can't show
  back waits until the reads are known.

### Leave out

- **Buying:** buy now, bids, backorders, closeouts, and buying Afternic or
  Sedo names through Dynadot. It spends money, and DomBot manages names you
  hold.
- **`listing_on_afternic`, `listing_on_sedo`:** Dynadot listing your name on
  Afternic or Sedo for you. DomBot lists on both directly, with their own
  accounts; a second path would give one listing two owners.
- **The `auction`, `portfolio_auction` and `broker_service` sale types.**

### What Dynadot's API doesn't have

No seller sales, offers, leads, messages or payouts, no Sale Balance, no
views (only WHOIS lookups), no listing dates, no minimum offer,
installments, category or description in the reads, no floor, discount or
tiers, and no bulk write (one name a call). Names in the account need no
ownership check, so there's nothing to recheck.

## Credentials: the Dynadot registrar key

SellerHub's plan builds registrar-backed market accounts first
(docs/sellerhub-api.md, "Credentials: borrowing the Spaceship registrar
key"), and Dynadot uses the same flow: pick a Dynadot registrar account,
read its key at call time, cards that point at each other, remove-both.
Whichever market lands first builds it. What's different for Dynadot:

- **No scopes.** Nothing in the reference scopes a key, so any key that
  works for the registrar should work for the marketplace (open question 6).
  The test reads `accounts/info` and one listing read.
- **One budget for both sides.** On Regular, Dynadot answers a second
  request in flight with a 429. Registrar calls on a key already run in one
  bulk lane, a second apart (docs/domain-editing.md, "Concurrency policy"),
  while a market job gets a lane per market account. A Dynadot market
  account's calls have to wait their turn behind the same key's registrar
  calls: its market-job lane and the registrar lane share one limiter,
  keyed by the registrar account (`src/core/markets/rate-limit.ts` is
  already shared by account key), sized from `price_level`. Auto-sync
  already runs markets after registrars, so the two syncs don't overlap.
- **Only that account's names.** Until phase 5, the market lists only names
  the linked registrar account holds; the List and Delist dialog leaves
  the rest out and says why.

## What it means for DomBot

The market id is `dynadot`, the same as the registrar, shown as "Dynadot
Marketplace".

### Listings

Sync reads the names the linked account marks `is_for_sale`, then
`get_listing_item` for each, or `get_listings` in pages if it turns out to
be the account's own. On Regular, 1,000 listed names take about 17 minutes,
sharing the minute with registrar sync; Bulk is ten times faster. A failed
read leaves `complete` false and keeps the last snapshot.

| `MarketListing`             | From Dynadot                                                          |
| --------------------------- | --------------------------------------------------------------------- |
| `name`                      | `domain`                                                              |
| `displayName`               | null                                                                  |
| `status`                    | `active`; `on_hold` when `is_pending_sale_locked`                     |
| `statusRaw`                 | `type`, with "pending sale" when locked                               |
| `forSale`                   | true for every listing read                                           |
| `price`                     | `price` (open question 3: what a `make_offer` listing has there)      |
| `buyNow`                    | `type` is `bin` or `bin_make_offer`                                   |
| `minOffer`                  | not readable; see below                                               |
| `floor`, `discount`, `tier` | null                                                                  |
| `leaseToOwn`                | null: installments aren't readable                                    |
| `currency`                  | the account's listing currency (below)                                |
| `listedAt`, `updatedAt`     | null                                                                  |
| `extra`                     | `{ market: 'dynadot', listingId, offers, pendingSale, minOfferSent }` |

`offers` is true for `make_offer` and `bin_make_offer`: Dynadot says whether
offers are welcome even where it doesn't give the minimum.

**Currency:** the market card has a **Listing Currency** (USD to start).
Writes send it and reads ask for it. A listing priced in another currency
on Dynadot's site then reads converted, if Dynadot converts (open
question 5), and shows as above or below the DomBot price.

**Writes,** one name a call (`writeBatch: 1`, market jobs past 10 names, in
the registrar account's lane):

- **List or change:** `set_for_sale` with `for_sale_type: marketplace`.
  `listing_type` follows the result: a price alone is `buy_now`, a price
  and a minimum offer `buy_now_and_make_offer`, a minimum offer alone
  `make_offer`. A change keeps whatever the change doesn't touch, so the
  adapter reads the listing first (`get_listing_item`), as Atom's does,
  and reads it back after to fill `saved` and `adjusted`.
- **Minimum offer:** sent, but the reads don't return it. DomBot keeps the
  last value it sent in `extra.minOfferSent`, and the listing editor shows
  it as last set from DomBot. If the live read has it after all, it becomes
  a plain field.
- **If `set_for_sale` replaces the listing** (open question 1), a price
  change would clear the minimum offer, category, description and
  installments, and DomBot couldn't see it. Then DomBot re-sends its
  `minOfferSent`, and the editor says that saving clears Dynadot's
  category, description and installment settings.
- **`forSale: false`** is refused with "Dynadot has no hidden listings;
  delist instead". `not_for_sale` is the delist.
- **Floor, discount, lease-to-own, tiers:** refused with a message, never
  dropped (markets.md, "Capabilities").
- **A listing with a sale under way** (`on_hold`) isn't written; the result
  says why.
- **Delist:** `set_for_sale` with `not_for_sale`.

### Sales

`sales: false`: the API has none. What DomBot does instead:

- **A sale under way** shows as on hold (the grey clock) in Listings, from
  `is_pending_sale_locked`.
- **The departure.** Dynadot moves the name to the buyer, the registrar
  sync sees it leave, and Activity's Needs review asks about it as for any
  name (Mark dropped · Record sale… · Dismiss, docs/unrecorded-activity.md).
  When the name's last Dynadot listing was live, Record sale… opens filled
  in: Dynadot Marketplace, the last Buy Now price, 10% fees, and the day it
  left. A `make_offer` sale's price isn't known, so it's left blank.
- **No sale steps on the Sales tab:** Dynadot moves the name itself.
- **No payout tracking:** the Sale Balance isn't in the API.
- **Later, on the web host:** the `domain_status_changed` webhook with
  `moved_sold` confirms that a departure was a sale (still without the
  price).

### Ownership verification

Names in the account need none, since Dynadot is their registrar. No
Ownership Verification ID, no TXT record, no market nameservers, no
Recheck (`verifyDns: false`). Every market card has the ID field today, so
the catalog needs a way to say a market has no account-wide value
(`MarketInfo`), and the card leaves the field out.

Phase 5 brings verification back for names at other registrars, with a
twist: Dynadot gives a value per name (`open_market_key` for TXT, plus its
nameservers and a CNAME), not one per account, and
`verify_other_registrar_domain` is a real "check now" for a list of names.
DomBot's TXT job takes one value per account today, so it would need a
per-name source.

### Afternic and Sedo Fast Transfer (phase 4)

DomBot already lists on Afternic and Sedo. For a name held at Dynadot,
confirming Fast Transfer there (`set_other_platform_confirm_action`:
`confirm` or `delete`, for `afternic` or `sedo`) lets a sale on that market
move at once. The API can't read the confirmation back, though the buyer
searches (`get_afternic_domain`, `get_sedo_domain`, up to 10 results) say
`is_fast_transfer`. Where it could go: a "Confirm Fast Transfer at Dynadot"
choice in List at your prices, for Afternic and Sedo, when a selected name
is at a Dynadot account, and an MCP tool. It's a registrar-side setting
that serves the other markets; it lives with the Dynadot market client
because it's under the aftermarket commands.

### Express Pay Links (phase 4)

The same tool as SellerHub's checkout link, `domain_listing_checkout_link_create`
(name, price, currency, installments, an expiry of never, 1, 3, 7, 14 or 30
days), returning the link. Dynadot can also list and delete them, so
`market_checkout_links` and `domain_listing_checkout_link_delete` too. The
description says the link is meant for a buyer.

### Capabilities

```ts
const DYNADOT_CAPABILITIES: MarketCapabilities = {
  // Dynadot's 32, less BTC and the withdrawn LTL, which DomBot doesn't have
  currencies: ['USD', 'EUR', 'GBP' /* … */],
  minOffer: true, // sent, not read back; see Listings
  floor: false,
  discount: false,
  leaseToOwn: false, // installments: settable, not readable
  tiers: null,
  sales: false,
  saleAuthCode: false,
  saleMessages: false,
  accountStats: false,
  domainStats: null,
  leads: false,
  parkingEarnings: false,
  searchCounts: false,
  accountSettings: false,
  relist: false,
  verifyDns: false, // phase 5 makes it true for other-registrar names
  asyncInsert: false,
  writeBatch: 1,
  jobs: false,
  spends: false,
  rateLimit: 60, // Regular; Bulk 600, Super Bulk 6,000, from price_level
};
```

### MCP

The shared listing and account tools work for Dynadot through its
capabilities, and `market_list` shows `registrarAccountId`. Phase 4 adds
the pay link tools above and `domain_listing_fast_transfer_set` (name,
`afternic` or `sedo`, on or off).

### The demo

A Dynadot Marketplace account linked to the demo's Dynadot registrar
account (`src/core/demo/markets.ts`), with Buy Now, offers-only and
pending-sale listings, and a departed name whose Record sale… shows the
prefill.

## Testing

Unit tests map fixtures built from the reference, swapped for live captures
as they come in. The in-account commands have no sandbox, so live tests run
on production, as Atom's do: reads with the Dynadot key in `.env`, and a
write round trip behind `DYNADOT_LIVE_WRITES=1` on `DYNADOT_TEST_DOMAIN`,
listed at a price nobody would pay, read back, then delisted. That name has
to be one held at Dynadot and picked with the user first: domanio.com and
domainio.com are at 101domain. They do suit phase 5, as names held at
another registrar, and the other-registrar commands run in the sandbox.

## Phases

1. **Registrar-backed market accounts:** SellerHub's phase 1
   (docs/sellerhub-api.md), built here if Dynadot goes first. For Dynadot
   also: one limiter for a key both sides use, sized from `price_level`,
   and a market with no Ownership Verification ID.
2. **Read side:** client (signature, envelope, errors, limiter), adapter,
   registry entry, listing sync (`is_for_sale`, then `get_listing_item`, or
   `get_listings`), the Listing Currency setting, the demo account. Live
   reads, open questions 1–5 first.
3. **Writes:** list, reprice, Buy Now and offers, minimum offer, delist,
   through the List and Delist dialog, the bulk runner and the MCP listing
   tools; the Record sale… prefill. Live round trip on the test name.
4. **Extras:** Express Pay Link tools; Fast Transfer for Afternic and Sedo.
5. **Names at other registrars:** add, verify, list, sync from
   `other_registrar_domain_list`, delist, remove. Its own design pass
   first.

## Open questions

1. Does `set_for_sale` change only the fields sent, or replace the listing?
   If a price-only call clears the minimum offer, category, description or
   installments, the reads won't show it.
2. Is `get_listings` the account's own listings or the whole marketplace?
   With `show_other_registrar`, does it include names from other
   registrars?
3. Does `get_listing_item` return more than documented (minimum offer,
   currency, installments)? What's in `price` for a `make_offer` listing?
4. Is `description` really required on `set_for_sale`, and what does an
   empty one do to an existing description?
5. Is a listing kept in the currency it was set in, and does a read in
   another currency convert it?
6. Does the marketplace need anything on the key or the account (an API
   setting, a price level), or does any registrar key work? Is the live
   path `aftermarkets/…/for_sales` or `aftermarket/…`?
7. Can a name be listed or changed while it has a sale under way, a Buy
   Lock, or a recent transfer, and what does Dynadot answer?
8. Does a marketplace listing need anything in the name's DNS? Dynadot's
   For Sale landing page is a DNS setting (`glue_type:
for_sale_landing_page`), and only `listing_other_registrar_domain` has a
   landing page flag (which "will change and save your DNS settings").
9. After a sale, can DomBot tell from the registrar side that the name was
   sold rather than pushed or transferred (a `domain_list` status, an
   order)? On the web host, how are webhooks set up and signed?
10. Phase 5: how does the sale of a name at another registrar complete?
    Does Dynadot need an auth code, and who gives it?
