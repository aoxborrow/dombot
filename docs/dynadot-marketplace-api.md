# Dynadot Marketplace API

Plan for Dynadot's marketplace (its aftermarket) as a DomBot market, on the
shared model in [markets.md](markets.md), written to sit beside
docs/afternic-api.md, docs/atom-api.md, docs/sedo-api.md and the Spaceship
SellerHub plan (docs/sellerhub-api.md, PR #251). Docs: the RESTful v2
reference at <https://www.dynadot.com/domain/api-document#set_for_sale>
("Aftermarket" section). Dynadot's seller help:
<https://www.dynadot.com/help/question/domain-sale-process> and, for names
held elsewhere, <https://www.dynadot.com/help/question/open-marketplace>.

## Status

**Reads and writes built (2026-11-04). Reads checked live; writes checked
live on both kinds: domanio.com held elsewhere, and testbot.io in the
account, which DomBot unlocks and locks again around each write ("Locks";
the account lock was off).** The plan
below is from the API reference and Dynadot's help pages as read on
2026-11-03; "Observed" has what live calls showed.

- **Client** `src/core/markets/dynadot/`: signed reads of the account, its
  domain list, one listing, the other-registrar list and a name's
  verification values; writes for `set_for_sale`, adding names held
  elsewhere, listing them, and asking Dynadot to verify them. Writes go
  once, never retried.
- **Adapter** `src/core/services/markets/dynadot.ts`, registered as
  `dynadot` ("Dynadot"): listings of both kinds of name (below), the Open
  Marketplace Key read into the account's Ownership Verification ID on
  each sync. Writes list, reprice and delist either kind ("Writes"). A
  name held elsewhere that Dynadot hasn't verified is pending, not an
  error; DomBot asks Dynadot to verify it when listing, and lists it once
  Dynadot has: on the next sync, a Recheck, or the end of an Ownership
  verification TXT job. Listings go out in any of the 30 currencies
  Dynadot documents that DomBot has ("Currencies"). Capabilities are what's built: a minimum offer sent
  (DomBot's own) but never read back, pending inserts, no sales yet.
- **Registrar-backed accounts:** Settings → Markets adds a Dynadot account by
  picking a Dynadot registrar account (each one once); it calls with that
  account's key and proxy route, keeps no credentials of its own, and
  `market_list` shows its `registrarAccountId`. The card links to that
  registrar account in a box (its logo and name), opening its card in
  Settings → Registrars (`?tab=registrars&account=<id>`). Removing the
  registrar account removes the market account too, and its confirmation
  says so. Both sides' calls on the key share one rate limiter. Markets and
  accounts are listed alphabetically everywhere (by market, then account
  name).
- **Verification:** the key parses from the key, its NS3 or its CNAME; the
  nameserver preset is Dynadot's DNS pair plus `ns3-<key>.dyna-ns.org`;
  only the NS3 counts as the market's nameservers.
- **Demo:** a Dynadot account on the demo's Dynadot registrar account, with
  names from both sides.
- **Live tests:** `client.live.test.ts` (reads), and
  `client.writes.live.test.ts` (round trips behind `DYNADOT_LIVE_WRITES=1`):
  passed on domanio.com held elsewhere, and on testbot.io in the account
  (locked; the account lock off); with the account lock on it stops at the
  refusal ("Testing").
- **Not planned** (decided 2026-11-07): an "Also remove from Dynadot"
  option on delist (Dynadot's dashboard removes names in bulk), the
  registrar card pointing back to its market account, and a warning before
  changing nameservers of names listed there. Sales come later.

Dynadot is already a DomBot registrar: registrar-client's `dynadot` speaks
the same RESTful v2 API. The marketplace commands use the same host, the
same API key and secret and the same `X-Signature`, so a Dynadot market
account borrows the registrar account's key, as SellerHub does
(`registrarAccountId`, "One provider, registrar and market" in
atom-api.md).

**It sells names held anywhere, not only at Dynadot.** Dynadot's "open
marketplace" lists names registered at other registrars once their
ownership is verified, and the buyer's price includes the transfer to
Dynadot. So one Dynadot market account covers the whole portfolio: names
the linked Dynadot account holds go through one set of commands, every
other name through another (see "Two kinds of names").

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

**Selling names held at other registrars** (the "open marketplace"; all but
the listing call run in the sandbox):

| Command                               | Call                                                             |
| ------------------------------------- | ---------------------------------------------------------------- |
| `add_other_registrar_domain`          | `POST /aftermarket/other_registrar/domains` (`domain_name_list`) |
| `other_registrar_domain_list`         | `GET /aftermarket/other_registrar/domains?page&page_size`        |
| `other_registrar_domain_verification` | `GET /aftermarket/other_registrar/{domain}/verification?new_key` |
| `verify_other_registrar_domain`       | `POST /aftermarket/other_registrar/verify` (`domain_name_list`)  |
| `listing_other_registrar_domain`      | `POST /aftermarket/{domain}/listing_other_registrar_domain`      |
| `delete_other_registrar_domain`       | `DELETE /aftermarket/other_registrar/domains/{domain}`           |

**Selling names in the account:**

| Command                                  | Call                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `set_for_sale`                           | `PUT /aftermarkets/domains/{domain}/for_sales`                                                |
| `get_listing_item`                       | `GET /aftermarket/listings/{domain}?currency`                                                 |
| `get_listings`                           | `GET /aftermarket/listings?page&page_size&currency&exclude_pending_sale&show_other_registrar` |
| `domain_list`, `domain_info`             | `GET /domains`, `GET /domains/{domain}`: `is_for_sale` on each name                           |
| `set_other_platform_confirm_action`      | `POST /aftermarket/domains/{domain}/opt_in_fast_transfer`                                     |
| `listing_on_afternic`, `listing_on_sedo` | `POST /aftermarket/listing_on_afternic`, `…/listing_on_sedo`                                  |

**Either kind, or not said:**

| Command                                      | Call                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `get_whois_stats`                            | `GET /aftermarket/whois_stats?domain_name&date_type`                           |
| Express Pay Links: create, get, list, delete | `POST`, `GET`, `DELETE /aftermarket/pay_links[/{domain}]`                      |
| `add_user_auction`, `close_auction`          | `POST /aftermarket/auctions/{domain}`, `POST /aftermarket/auctions/{id}/close` |
| `set_`/`get_auction_installment_plan`        | `/aftermarket/auctions/{domain}/installment_plan`                              |

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
  `aftermarket`. Which one is live is an open question.
- Error lists are copied between commands (`set_for_sale`'s 409s are grace
  delete's), so the wording of real errors has to come from live calls.
- Nothing about seller sales, offers, leads, views (only WHOIS lookups),
  payouts or the Sale Balance. `accounts/info` has `account_balance`, not
  the Sale Balance.
- No command is documented for the step that completes a sale of a name
  held elsewhere (the seller's "Submit Transfer" with the auth code; see
  "Sales").

### Names at other registrars

- **Add** takes a list of names. A name has to be added before it can be
  verified or listed.
- **The list read** is a proper seller read, 100 a page by default: per
  name `registrar`, folder, registration and expiration dates, `status`
  (examples: In account, Unregistered, Registered, Backorder, Marketplace,
  Auction, Expired, In Transfer), `verify_status` (Unverified, Verified),
  `for_sale_type` (Not Set, Buy Now, Make Offer, Buy Now + Make Offer),
  `price`, `transfer_status` and `updated_date`. No minimum offer,
  installments, category or description.
- **Verification values** are asked for per name: `verify_status`, the
  `open_market_key`, the TXT value, the nameservers to use, and a CNAME
  host. `new_key: true` regenerates the key. The reference doesn't say the
  key is the account's, but the dashboard shows it is (below).
- **Verify now** takes a list and answers `success_list` and `failed_list`
  (failed, or not in the other-registrar list).
- **Listing** sets `for_sale_type` (`marketplace` or `not_for_sale`; the
  auction types aren't allowed for these names), `listing_type`, and
  amounts **in cents** ("1000 = $10.00"): `buy_now_price`,
  `asking_price`, `reserve_price`, `minimum_offer_price`. Also `currency`,
  `installment` and `maximum_installments` (under 12, or the months left
  before expiry), `category`, `sub_category`, `description`, a Google
  Analytics id, and For Sale landing page options
  (`use_for_sale_landing_page`, which "will change and save your DNS
  settings", traffic, more listings, Trustpilot, theme).
- **Delete** removes a name from the other-registrar list.

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
documented (open question 1). Observed: the live path is the plural
`aftermarkets/…/for_sales` (the singular one answers "The specified API
command is not recognized"), and `description` and `listing_type` are
required even to delist. For a name in the account, an empty description
counts as missing (testbot.io, 2026-11-04).

### Reading listings of names in the account

No seller "my listings" call exists for these. What there is:

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
- **`get_listings`** pages through listings with the same fields, for the
  whole marketplace (observed: a total of 493,548), not the account's own.
  DomBot doesn't use it.

### Observed (live reads, 2026-11-04)

- `accounts/info` has `price_level` as a phrase ("Bulk Account").
- `domain_list` marks names `is_for_sale: "Yes" | "No"`, takes
  `page_size=200` and pages with `pagination_result` (`has_next_page:
"No"`). Every listed name on the account checked used its own
  nameservers (`glue_type: NAME_SERVERS`): a listing needs nothing in
  Dynadot's DNS.
- `get_listing_item` refuses a read without `currency` (400, "The value for
  parameter currency is invalid"), wants the name lowercase (400 "must be
  all lowercase"), and answers 404 "Can not find the …" for a name with no
  listing. `type` comes in capitals (`BIN`, `BIN_MAKE_OFFER`),
  `is_pending_sale_locked` as "No", no `is_huge_domains`, and prices like
  "7999.00". Every listing had a price; none was Make Offer alone.
- Reads convert: a listing read with `currency=eur` came back at the EUR
  equivalent of its USD price.
- The other-registrar list has no paging fields. A name not for sale reads
  `for_sale_type: "Not Set"`, `price: ""`, `transfer_status: ""`; a .io
  name read `status: "Unregistered"` with no registrar (Dynadot's WHOIS
  lookup missed it), dates 0.
- A name's verification read gives `txt`, `open_market_key` (the same),
  `nameserver_list` (the pair and the NS3) and `cname`
  (`ns1-<key>.dyna-ns.net`).
- `domain_info` answers 404 "Can not find the domain in the account." for a
  name the account doesn't hold: one read tells the two kinds of name apart.
- Writes, checked as far as validation on domanio.com (not in the account,
  so nothing changed): `set_for_sale` needs `description` ("The required
  parameter description is missing", 400) and `listing_type`; with an empty
  description it got as far as 404 "Can not find the domain in the
  account." Listing domanio.com held elsewhere while unverified: 409 "This
  domain is not verified."
- With the account's key added as a TXT record at 101domain (beside Sedo's
  and the A records), verify answered `success_list: ["domanio.com"]` at
  once, and the list read "Verified".
- Make Offer, alone or with Buy Now, needs a minimum offer: "The
  minimum_offer_price must be $1.00 or higher." (400) without one. For a
  name in the account too: a test name taking offers, with a minimum set on
  Dynadot's site, rewritten at its price without one answered 400 "The
  required parameter minimum_offer_price is missing." and kept its
  minimum, though Dynadot's own form allows a blank one. No API read shows
  the minimum (2026-11-04).
- The listing read covers names held elsewhere too (`in_bound_links: -1`),
  but its price is the buyer's: listed at $999,997, it read 1000008.62,
  Dynadot's .com transfer fee added. The other-registrar list has the
  seller's price as "$999997.00", with `for_sale_type` "Buy Now + Make
  Offer". Delisting sets it back to "Not Set" and keeps "Verified".
- The round trip (list, reprice with offers, delist) passed through the
  adapter, prices read back unchanged.

### From Dynadot's pages

- **Commission:** 10% of the sale price, no listing fee, for both kinds of
  name. Express Pay Links are 5%.
- **A name in the account sells without the seller.** Dynadot moves it into
  the buyer's Dynadot account at checkout; the buyer gets a 15-day Buy
  Lock. No auth code, no transfer.
- **A name held elsewhere** is added under My Domains → Other Registrar,
  verified by nameservers, CNAME or TXT (Dynadot checks on its own, or on
  Verify Now), then listed as Marketplace. Only nameserver verification
  allows Dynadot's For Sale landing page. No user auctions; installments
  are allowed.
- **One key for the account** (seen in the dashboard, 2026-11-03). The
  Verification dialog shows "Your Open Marketplace Key", 32 hex
  characters, with a Regenerate button, and it was the same for every name
  added. The TXT record is the key itself. The nameservers are
  `ns1.dyna-ns.net` and `ns2.dyna-ns.net`, Dynadot's own DNS pair (what a
  name at Dynadot uses with Dynadot DNS), plus `ns3-<key>.dyna-ns.org`,
  which carries the key: the same pattern as Afternic's NS3. Dynadot also
  takes the pair alone.
- **The verification has to stay.** If Dynadot can't find the record later,
  the name goes back to Unverified and its listings are removed (with a
  "Domain Delisting" email).
- **Selling a name held elsewhere:** the buyer's price adds Dynadot's
  transfer fee. Once the buyer has paid, a Transfer icon appears on the
  name; the seller enters the auth code and submits, which creates a
  transfer order at no cost to the seller. Proceeds follow 2–3 days after
  Dynadot receives the name.
- **Payout:** proceeds, less the 10%, go to the seller's Sale Balance after
  the processing period (2–3 days on the pages updated in 2026; older
  pages say 5–7). From there they can move to the Account Balance with a
  2% bonus, or be paid out.
- **Afternic and Sedo Fast Transfer:** a name at Dynadot can be confirmed
  so a sale on Afternic or Sedo moves at once (Confirm Afternic, Confirm
  SedoMLS in the dashboard). Names registered or transferred in the last
  60 days don't qualify. A registrar setting, not the marketplace's (see
  "Not here").

## What to implement

### Implement

| Command                               | Why DomBot wants it                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `other_registrar_domain_list`         | Sync for names held elsewhere: sale type, price, verification and transfer status, 100 a page.                                                                                 |
| `add_other_registrar_domain`          | The first step of listing a name held elsewhere, done for the user as part of List.                                                                                            |
| `other_registrar_domain_verification` | The account's Open Marketplace Key, saved as its Ownership Verification ID, so there's nothing to paste once a name is added.                                                  |
| `verify_other_registrar_domain`       | Recheck ownership, for a list of names; also run after DomBot adds the TXT records.                                                                                            |
| `listing_other_registrar_domain`      | List, reprice, Buy Now and Make Offer, minimum offer, delist (`not_for_sale`) for names held elsewhere.                                                                        |
| `domain_list` (`is_for_sale`)         | Which names in the account are listed. From the registrar sync once registrar-client passes the flag through (a small registrar-client change); otherwise the market reads it. |
| `get_listing_item`                    | Price, Buy Now or offers, and a sale under way, per listed name in the account.                                                                                                |
| `set_for_sale`                        | List, reprice, Buy Now and Make Offer, minimum offer, delist (`not_for_sale`) for names in the account.                                                                        |
| `accounts/info`                       | The account test, and `price_level` for the rate limit.                                                                                                                        |

### Defer

- **WHOIS stats:** daily WHOIS lookup counts per name (last 7 or 30 days,
  this year, last year), one call per name. A rough interest signal, not
  views. Maybe a column later.
- **User auctions:** a time-boxed sale from a starting price, with
  auto-relist and installments, for names in the account only. DomBot's
  model is standing listings and has no auction state. Revisit if asked.
- **Webhooks:** `domain_status_changed` with `moved_sold` would confirm a
  sale. It needs a public URL, so only the web host's Worker could take it,
  not the desktop app.
- **Category, sub-category, description, search indexing, installments:**
  settable, not readable. Writing what DomBot can't show back waits until
  the reads are known.
- **Asking and reserve prices** for names held elsewhere: what they do
  beside Buy Now and the minimum offer isn't documented (open question 8).
- **Express Pay Links:** checkout links at a set price for a buyer. Not for
  any market yet (SellerHub has checkout links too); later, perhaps a
  shared "get a checkout link" in the market model.

### Leave out

- **Buying:** buy now, bids, backorders, closeouts, and buying Afternic or
  Sedo names through Dynadot. It spends money, and DomBot manages names you
  hold.
- **`listing_on_afternic`, `listing_on_sedo`:** Dynadot listing your name on
  Afternic or Sedo for you. DomBot lists on both directly, with their own
  accounts; a second path would give one listing two owners.
- **The `auction`, `portfolio_auction` and `broker_service` sale types.**
- **`get_listings`:** the whole marketplace, not the account's listings.
- **CNAME verification:** anywhere DomBot can add a CNAME it can add the TXT
  record, as for Sedo.
- **`use_for_sale_landing_page`:** it changes the name's DNS, which
  shouldn't happen as a side effect of listing (markets.md, "TXT records
  while listing").
- **`transfer_in` to finish a sale:** registrar-client's transfer-in would
  bill the seller and isn't tied to the sale; Dynadot's own Submit Transfer
  is free.

### What Dynadot's API doesn't have

No sales report, offers, leads, messages or payouts, no Sale Balance, no
views (only WHOIS lookups), no listing dates for names in the account, no
minimum offer, installments, category or description in any read, no
floor, discount or tiers, and no bulk write (one name a call, except add
and verify). No documented way to hand Dynadot the auth code for a sold
name held elsewhere.

## Credentials: the Dynadot registrar key

Dynadot built registrar-backed market accounts, and Spaceship SellerHub
uses them as they are (docs/sellerhub-api.md, "Credentials"): pick a
registrar account, read its key at call time, and removing the registrar
account removes the market account with it (built here, 2026-11-07; the
registrar card doesn't point back). What's different for
Dynadot:

- **No scopes.** Nothing in the reference scopes a key, so any key that
  works for the registrar should work for the marketplace (open question 6).
  The test reads `accounts/info` and one page of each listing read.
- **One budget for both sides** (built 2026-11-07). On Regular, Dynadot
  answers a second request in flight with a 429. Registrar calls on a key
  run in one bulk lane, a second apart (docs/domain-editing.md,
  "Concurrency policy"), while a market job gets a lane per market account.
  Both now take from one limiter, keyed by the registrar account
  (`dynadotLimiter`, 50 a minute): the market client uses it directly, and
  registrar-client's Dynadot provider gets a fetch that waits its turn on
  it (`dynadotPacedFetch`), through the proxy too. A 429 on either side,
  as the status or Dynadot's envelope code, pauses both. Registrar sync for Dynadot is one list read, so it costs the
  market little. Not done: sizing it from `price_level` (Bulk allows 600).
  Auto-sync already runs markets after registrars, so the two syncs don't
  overlap.
- **A Dynadot registrar account is needed** for the key, even to sell only
  names held elsewhere. A user with no Dynadot names opens a Dynadot
  account, makes a key and connects it as a registrar with nothing in it;
  the market card says so. A separate key on the market card isn't
  offered: it's the same key either way.

## What it means for DomBot

The market id is `dynadot`, the same as the registrar, shown as "Dynadot"
(Settings → Markets makes the context plain, and the listing column stays
short).

### Two kinds of names

The linked registrar account decides the path, name by name:

- **In the account:** a name the linked Dynadot account holds. Listed with
  `set_for_sale`, read with `get_listing_item`, no verification, sold
  without the seller.
- **Held elsewhere:** any other name in the portfolio (another registrar
  account, or an imported name). Added, verified, listed with
  `listing_other_registrar_domain`, read from `other_registrar_domain_list`,
  and sold with a transfer. The TXT record and the sale's unlock and auth
  code come from the registrar account that holds it; for an imported name
  the user does those by hand.

Names in a different Dynadot account than the linked one aren't held
"elsewhere" (open question 9); a second Dynadot market account, linked to
that registrar account, sells them. The List and Delist dialog leaves them
out and says why.

Both kinds come back as the same `MarketListing`, with `extra.held`
(`'dynadot'` or `'elsewhere'`), so the Domains table, filters and MCP don't
care which.

### Listings

Sync reads both:

- **Held elsewhere:** `other_registrar_domain_list`, every page. 10,000
  entries is 100 calls. An entry with `for_sale_type` Not Set is added but
  not listed: DomBot keeps its verification status and shows no listing.
- **In the account:** the names the linked account marks `is_for_sale`, then
  `get_listing_item` for each. On Regular, 1,000 listed names take about 20
  minutes (the client paces at 50 a minute, under Regular's 60, sharing the
  key with registrar sync); 36 took under a minute on a Bulk account.

A failed read leaves `complete` false and keeps the last snapshot.

| `MarketListing`             | In the account (`get_listing_item`)                      | Held elsewhere (`other_registrar_domain_list`)                                               |
| --------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `name`                      | `domain`                                                 | `domain_name`                                                                                |
| `displayName`               | null                                                     | null                                                                                         |
| `status`                    | `active`; `on_hold` when `is_pending_sale_locked`        | `pending` while Unverified; `on_hold` once a buyer has paid (open question 4); else `active` |
| `statusRaw`                 | `type`, with "pending sale" when locked                  | `status` and `verify_status`                                                                 |
| `forSale`                   | true for every listing read                              | Verified and listed                                                                          |
| `price`                     | `price` (open question 3: what a `make_offer` has there) | `price`, in USD whatever the listing's currency ("Currencies")                               |
| `buyNow`                    | `type` is `bin` or `bin_make_offer`                      | `for_sale_type` is Buy Now or Buy Now + Make Offer                                           |
| `minOffer`                  | not readable; see below                                  | not readable; see below                                                                      |
| `floor`, `discount`, `tier` | null                                                     | null                                                                                         |
| `leaseToOwn`                | null: installments aren't readable                       | null: installments aren't readable                                                           |
| `currency`                  | the name's DomBot currency, read in it ("Currencies")    | USD                                                                                          |
| `listedAt`                  | null                                                     | null                                                                                         |
| `updatedAt`                 | null                                                     | `updated_date`                                                                               |

`extra` is `{ market: 'dynadot', held, listingId, offers, pendingSale,
verified, registrar, transferStatus }`, each where the read has it. `offers` is true for the Make Offer types: Dynadot says whether
offers are welcome even where it doesn't give the minimum.

### Currencies

Built 2026-11-07, from live tests on domanio.com:

- **Which:** Dynadot's reference names 32 currencies for listings; DomBot
  offers the 30 it has (not BTC or the withdrawn LTL):
  `DYNADOT_CURRENCIES`, the capabilities' `currencies`. On the test
  account Dynadot took 14 of them (USD, EUR, GBP, CAD, AUD, CNY, HKD, BRL,
  INR, MXN, IDR, THB, PHP, KRW) and answered "The value for parameter
  currency is invalid." for the rest, JPY, CHF and NZD among them. Whether
  that depends on the account isn't known, so DomBot doesn't narrow the
  list (decided 2026-11-07): a refused currency fails that name as
  `CURRENCY`, "Dynadot didn't accept JPY for this listing." Reads convert
  to all 32. Buy Now has a ceiling per currency ($100,000,000,
  £75,000,000, €100,000,000, C$125,000,000, AU$150,000,000, …), which
  Dynadot's message states.
- **Kept, not shown:** a listing keeps the currency it was set in: listed
  at €999,999, the listing read in EUR was €1,000,009.69 (the transfer
  fee added) and in USD $1,115,081.50. No read says which currency a
  listing is in, and the other-registrar list shows every price in USD
  ("$1115069.88"). "Cents" are the amount times 100 in every currency
  (₩999,999,999 sent as 99999999900 read back as ₩999,999,999 plus the
  fee).
- **No setting:** a listing goes out in the currency of the change, which
  "List at my price" takes from the name's DomBot asking price. A change
  without one uses the asking price's currency when it's one of the 30,
  else USD.
- **Names in the account** are read in that same currency, so a listing
  DomBot made reads back exactly; one priced in another currency on
  Dynadot's site reads converted.
- **Names held elsewhere** read in USD, as the list shows them: the
  listing read's price has the transfer fee in it, and the fee isn't
  converted at the same rate, so the seller's price in another currency
  can't be worked out. The saved listing has the currency sent until the
  next sync. DomBot doesn't flag a price above or below its own when the
  currencies differ. A change that keeps the price sends the list's USD
  price in USD, and a change of currency without a price is refused.
- **Minimum offer:** DomBot's is sent only when it's in the listing's
  currency. Dynadot's $1 floor is checked locally for USD; for other
  currencies Dynadot answers.

### Writes

One name a call (`writeBatch: 1`, market jobs past 10 names, in the
registrar account's lane). Common to both kinds:

Built: `domain_info` first says which kind the name is (one read), then
that kind's command. About four calls a name, so a bulk push runs about
twelve names a minute at the client's pace.

- **`listing_type`:** from the change: a price alone is Buy Now, a price
  and a minimum offer Buy Now + Make Offer, a minimum offer alone Make
  Offer. A change that leaves the price keeps the one listed.
- **Minimum offer:** DomBot's only (decided 2026-11-04). Dynadot needs
  one ($1 or more) with every change while offers are on, and never shows
  it back. A change that gives one sends it; a change to a listing that
  takes offers without one sends DomBot's minimum offer for the name (its
  asking price, when that's in USD); with none in DomBot it's refused,
  saying to set one or clear it (which turns offers off). A Buy Now listing
  stays Buy Now. DomBot doesn't keep what it sent: a listed name's minimum
  is blank in DomBot, as Dynadot shows it.
- **Read back:** a name in the account is read again after the write; a
  name held elsewhere is saved as sent, since the listing read shows the
  buyer's price (with the transfer fee) and the seller's is only on the
  other-registrar list.
- **Description:** `set_for_sale` needs one for a name in the account,
  even to reprice or delist: left out or empty, it's refused ("The required
  parameter description is missing", 400); a single space passes
  (testbot.io, 2026-11-04). No API read shows it (Dynadot's public listing
  page does, but DomBot doesn't read web pages). DomBot doesn't manage
  descriptions (decided 2026-11-04): it sends a space, which replaces the
  one on Dynadot.
- **Locks:** Dynadot changes a listing in the account only while the name
  is unlocked and the account lock is off (other commands, the registrar
  side's included, never needed either off). On testbot.io: locked with
  the account lock on, 409 "Domain is locked. Please unlock domain first."
  (`DOMAIN_LOCKED`); unlocked, 400 "Please unlock your account firstly."
  (`ACCOUNT_LOCKED`); with the account lock off and the name unlocked, the
  writes went through. Names held elsewhere aren't affected.
  - **The name's lock** DomBot handles itself (decided 2026-11-04): on
    `DOMAIN_LOCKED` it unlocks the name, writes again, and locks it again
    whatever the write did. A name it can't lock again fails as
    `RELOCK_FAILED`, saying so. Checked live on testbot.io: the round trip
    ran with the name locked before and after.
  - **The account lock** DomBot never touches (a security setting). On
    `ACCOUNT_LOCKED` the result is a plain error: "Dynadot account must be
    unlocked to change listings."
  - **Maybe a way past it, unproven:** Dynadot's API settings have an
    allowed-IP list and "Allow api to process commands without checking
    account locks or domain locks on above IPs". If it works for listing
    changes, the advice (add the IP DomBot calls from, the fixed IP proxy's
    when the registrar account uses one, and tick that box) goes in DomBot's
    help, not the error. It doesn't: from an allowed IP with the box
    ticked, Dynadot still answered 409 for the name's lock, and 400 for the
    account lock once that was on (2026-11-04), and again 400 three days
    later (2026-11-07), so it isn't a delay in applying.
- **What a write keeps:** on testbot.io, a reprice kept the category
  ("Business") and sub-category ("None") set on Dynadot, and replaced the
  description with the space DomBot sends (seen on the public listing
  page, for the test only). A change without the minimum offer is refused
  and leaves it as it was (Observed). Not checked yet: installments.
- **`forSale: false`** is refused with "Dynadot has no hidden listings;
  delist instead". `not_for_sale` is the delist.
- **Floor, discount, lease-to-own, tiers:** refused with a message, never
  dropped (markets.md, "Capabilities").
- **A listing with a sale under way** (`on_hold`) isn't written; the result
  says why.

In the account: `set_for_sale` with `marketplace`, or `not_for_sale` to
delist (a name with no listing counts as delisted).

Held elsewhere:

- **List:** a verified name is listed with
  `listing_other_registrar_domain`, amounts in cents ("Currencies").
  Dynadot refuses an unverified one (409, observed), and keeps no listing
  request for it. So a name not on the other-registrar list is added, and
  an unverified one is put to Dynadot's verify first, since its TXT record
  may be in place already; verified, it's listed at once. Otherwise DomBot
  holds it (decided 2026-11-04): the result is pending, not an error, as
  on markets that check ownership themselves (`asyncInsert`), and the
  pending row keeps the price, minimum offer and currency asked for. Since
  Dynadot has nothing of it, a later change to a pending listing keeps
  what it doesn't give from that row (`withPendingListing`).
  Checked live (2026-11-07): domainio.com, with no TXT record yet, was
  added and held pending; cloudflareregistereddomaintest.uk, with its TXT
  record in place, was added, verified and listed in one write.
- **Listed once verified** (`listVerified`): each sync asks Dynadot to
  verify the account's pending names (one call for all of them) and lists
  those it verifies, at the pending row's price. One still unverified stays
  pending, under the "Waiting on ownership checks" note, however long it
  takes; one taken off Dynadot's list is dropped after a week, like any
  listing a market never took. Checked live: a pending row of
  cloudflareregistereddomaintest.uk was verified and listed at its price. Recheck ownership… and the end of an
  Ownership verification TXT job do the same for their names. Verify
  answered six calls in a row without a limit (2026-11-07). This makes
  `market_sync` write, only for these names; its MCP description says so,
  and it isn't marked read-only, so a host that auto-approves read-only
  tools still asks.
- **Delist:** `listing_other_registrar_domain` with `not_for_sale`. The name
  stays added and verified, so listing it again is one call. An unverified
  name can't be listed, and Dynadot refuses to delist one (409 "This
  domain is not verified", domainio.com), so DomBot counts it as delisted
  without a call. Taking it off
  Dynadot's list is done on Dynadot's dashboard, in bulk there (decided
  2026-11-07).
- **No landing page:** DomBot never sends `use_for_sale_landing_page`.

### Ownership verification

**In the account:** none, since Dynadot is the registrar. Those names never
get a verification mark.

**Held elsewhere:** every name needs it, and the verification has to stay in
place.

- **One key per account,** so it's the account's Ownership Verification ID
  (`verificationId`), and what markets.md built for the other markets works
  unchanged.
- **Filled in from the API.** The first `other_registrar_domain_verification`
  answer (for any added name) gives `open_market_key`, and DomBot saves it;
  each sync checks it again, so a key regenerated on Dynadot's site is
  picked up. Before any name is added, the card's field takes a paste, with
  the help "My Domains → Other Registrar → Unverified: Your Open
  Marketplace Key". The key, the TXT value or the NS3 hostname all work;
  DomBot reads the key out of any of them, as it does Afternic's. DomBot
  never sends `new_key`.
- **Two methods, both shaped like Afternic's:**

  | Method      | What DomBot sets                                                 |
  | ----------- | ---------------------------------------------------------------- |
  | TXT record  | the key, at the root, TTL 3600                                   |
  | Nameservers | `ns1.dyna-ns.net`, `ns2.dyna-ns.net` and `ns3-<key>.dyna-ns.org` |

  The pair is Dynadot's ordinary DNS, and Dynadot accepts it alone. The
  NS3 carries the account's key, as Afternic's
  `verification-<ID>.ns101.verify.hn` does, so it settles a name another
  account has added too, and it costs nothing: unlike Afternic's, it
  resolves and answers DNS (checked 2026-11-04). So the Dynadot preset in
  the nameserver editor's Markets group is all three, the NS3 lowercased
  like every nameserver DomBot sends. Nameservers hand the name's DNS to
  Dynadot, and they're the only method that gets Dynadot's For Sale
  landing page; TXT stays the default.

  Because the pair is Dynadot's everyday DNS, `src/core/markets/dynadot/nameservers.ts`
  declares only the NS3 (`*.dyna-ns.org`) as the market's: a name on the
  pair alone stays "Dynadot DNS" in the Nameservers filter, not a market
  set, and every name at Dynadot that uses Dynadot DNS would otherwise
  look listed. The preset is built from the account's key, as Afternic's
  is.

- **Ownership verification TXT…** offers the Dynadot account for names held
  elsewhere, through the registrar account that holds each name, as for
  every market. When the job has finished, DomBot asks Dynadot to verify
  the names it holds pending among them (one `verify_other_registrar_domain`
  call) and lists those it verifies (built); names that fail are asked
  again on the next sync, since resolvers may still have the old answer
  cached.
- **List at your prices** turns **Add ownership verification TXT records**
  on to start when listing on Dynadot names its registrar account doesn't
  hold (built): without it the listing can't go live. The user can still
  turn it off.
- **Recheck ownership…** works (`verifyDns: true`), many names a call, and
  lists a pending name once Dynadot has verified it ("Writes").
- **Keeping it in place.** Removing the TXT record, or moving the name to
  other nameservers, gets the Dynadot listing removed. DomBot doesn't warn
  about it (decided 2026-11-07); the DNS editor keeps the record like any
  other.
- **Tracking** (markets.md, "Tracking which names are set up") gets its
  answer for free here: `verify_status` from sync says, per name, whether
  Dynadot sees it. Phase 1's nameserver rule recognizes this account's NS3
  as it does Afternic's, and the pair alone for a name held elsewhere.

### Sales

`sales: true`, for names held elsewhere only; names in the account have no
sale record to read.

**Held elsewhere:** the list read shows a sale under way (which `status` or
`transfer_status` says the buyer has paid is open question 4). Sync opens a
sale record for it: `in_progress`, keyed by `${name}:${the day sync first
saw it}`, the listed Buy Now price, commission estimated at 10%, `action:
'auth_code'`. An offer-only listing has no price DomBot can read, so its
sale shows only as on hold, and Record sale… fills in after the name leaves.

The Sales tab's steps then mostly work as they do for Afternic:

1. **Unlock** at the registrar account that holds the name.
2. **The auth code.** DomBot fetches it from the holding registrar, but
   there's no documented way to give it to Dynadot (open question 4). So
   this step is **Copy auth code** with a link to Dynadot's Other Registrar
   page, where the user pastes it and submits. If the API turns out to
   take it, the step becomes Send auth code.
3. **Approve transfer** at the holding registrar, where its API reports
   transfers out (Gandi today; markets.md, "Sales tab"), once Dynadot's
   transfer asks for the name.
4. **Awaiting payout** once the name has moved. Sync sees it leave the
   holding account and writes the `sold` event, as for any market sale
   whose name has moved.

**In the account:**

- **A sale under way** shows as on hold (the grey clock) in Listings, from
  `is_pending_sale_locked`.
- **The departure.** Dynadot moves the name to the buyer, the registrar
  sync sees it leave, and Activity's Needs review asks about it as for any
  name (Mark dropped · Record sale… · Dismiss, docs/unrecorded-activity.md).
  When the name's last Dynadot listing was live, Record sale… opens filled
  in: Dynadot Marketplace, the last Buy Now price, 10% fees, and the day it
  left. A Make Offer sale's price isn't known, so it's left blank.
- **No sale steps:** Dynadot moves the name itself.

For both: no payout tracking (the Sale Balance isn't in the API). Later, on
the web host, the `domain_status_changed` webhook with `moved_sold`
confirms that a departure from the account was a sale.

### Not here: Afternic and Sedo Fast Transfer

`set_other_platform_confirm_action` (`confirm` or `delete`, for `afternic`
or `sedo`) approves Fast Transfer for one name held at Dynadot. That's a
registrar setting, not part of Dynadot's marketplace: every registrar has
its own Afternic and Sedo integration, and users approve Fast Transfer
name by name at the name's registrar. So it belongs in registrar-client,
per registrar, Dynadot's included. Later, DomBot's Afternic and Sedo
markets could use it to approve Fast Transfer for a listed name at its
registrar, where the registrar supports it.

### Capabilities

Planned, once currencies and sales are in. What's built declares only
what works: USD, a minimum offer (sent, not read back), `sales` off,
`verifyDns` and `asyncInsert` on.

```ts
const DYNADOT_CAPABILITIES: MarketCapabilities = {
  // Dynadot's 32, less BTC and the withdrawn LTL, which DomBot doesn't have
  currencies: ['USD', 'EUR', 'GBP' /* … */],
  minOffer: true, // sent, not read back; see Writes
  floor: false,
  discount: false,
  leaseToOwn: false, // installments: settable, not readable
  tiers: null,
  sales: true, // names held elsewhere, from the list read
  saleAuthCode: false, // no documented call; Copy auth code instead
  saleMessages: false,
  accountStats: false,
  domainStats: null,
  leads: false,
  parkingEarnings: false,
  searchCounts: false,
  accountSettings: false,
  relist: false,
  verifyDns: true, // names held elsewhere
  asyncInsert: true, // names held elsewhere: pending until verified
  writeBatch: 1,
  jobs: false,
  spends: false,
  rateLimit: 60, // Regular; Bulk 600, Super Bulk 6,000, from price_level
};
```

### MCP

The shared listing, sales and account tools work for Dynadot through its
capabilities, and `market_list` shows `registrarAccountId`. Listings carry
`held` and `verified`. `domain_verification_apply` and
`domain_listing_verify` work for names held elsewhere (built).

### The demo

Built: a Dynadot account on the demo's Dynadot registrar account
(`src/core/demo/markets.ts`), with a made-up Open Marketplace Key as its
verification ID, listing about three in ten priced names: those the demo's
Dynadot account holds, and names from its other registrars, a few still
waiting on verification. Writes behave as the real adapter does: a new name
the demo's Dynadot account doesn't hold, or one still unverified, is
pending until Recheck verifies and lists it, and a listed name's minimum
offer shows blank. Planned: a pending-sale listing, and a sale of a
name held elsewhere waiting on its auth code.

## Testing

Unit tests map fixtures built from the reference, swapped for live captures
as they come in. Live tests follow Atom's: reads with the Dynadot key in
`.env` (`DYNADOT_API_KEY`, `DYNADOT_API_SECRET`, already there for the
registrar), writes behind `DYNADOT_LIVE_WRITES=1`, each listed at a price
nobody would pay, read back, then delisted.

- **Reads first, on what's there (done, 2026-11-04).** The account's
  existing listings were read without writing anything:
  `client.live.test.ts` (`npm run test:live`) reads the price level, every
  listing through the adapter, and the key. It prints counts only; nothing
  about the listings goes in the repo.
- **Held elsewhere (done, 2026-11-04):** domanio.com, at 101domain, is the
  test name (`DYNADOT_TEST_EXTERNAL_DOMAIN`): on the account's
  other-registrar list, verified by the key's TXT record (kept in its DNS
  for later runs), and delisted after each run. domainio.com is the spare:
  added 2026-11-07 with the key's TXT record, which one of 101domain's
  three nameservers still didn't serve ten minutes later. 101domain's DNS
  is slow to update, so the verify-and-list tests used
  cloudflareregistereddomaintest.uk (Cloudflare DNS, the record on every
  nameserver at once; picked with the user), left on the list, verified,
  delisted. Other names from the user's registrars only once they're
  picked. A verify before the record is up can leave Dynadot holding the
  "no record" answer for the zone's negative TTL (an hour at 101domain).
- **Writes in the account:** testbot.io (`DYNADOT_TEST_DOMAIN`), listed at
  $499 Buy Now on Dynadot and Afternic, picked with the user. The test
  rewrites it at its price, moves it up $1 and puts it back, never
  delisting. Passed 2026-11-04 with the account lock off and the name
  unlocked for the run (locked again after); with a lock on, Dynadot
  refuses the first write and the test stops there, nothing changed. Its
  description on Dynadot is now a space.

## Phases

1. **Registrar-backed market accounts:** built here first (SellerHub's
   phase 1 can use it): the Settings picker, credentials and proxy through
   `registrarAccountId`, one market account per registrar account,
   `market_list`, removal with the registrar account, one limiter shared
   with the registrar side.
2. **Read side, both kinds:** built and checked live (reads only): client,
   adapter with the two paths, registry entry, sync from
   `other_registrar_domain_list` and from `is_for_sale` plus
   `get_listing_item`, the key into the verification ID, the demo account.
   Currencies: built ("Currencies").
3. **Writes and verification:** built: list, reprice and delist for both
   kinds with a minimum offer, adding names held elsewhere, Recheck
   (`verifyDns`), through the List and Delist dialog, the bulk runner and
   the MCP tools; checked live on both kinds; unverified names pending, and
   verified on listing, and listed once verified, by sync, Recheck or a
   TXT job; the TXT box on to start; all checked live. Not yet checked
   live: a name in the account in another currency (the account lock was
   on).
4. **Sales:** sale records for names held elsewhere and their steps on the
   Sales tab; the Record sale… prefill for names in the account.

## Open questions

1. Answered in part (2026-11-04): `set_for_sale` kept the category and
   sub-category it wasn't sent, and replaced the description (required).
   Still open: installments, and `listing_other_registrar_domain`.
2. Answered (2026-11-04): `get_listings` is the whole marketplace.
3. Answered in part: `get_listing_item` has no minimum offer, currency or
   installments. Still open: what's in `price` for a Make Offer listing
   (the account has none).
4. For a sold name held elsewhere: which `status` or `transfer_status`
   says the buyer has paid, does the list read give a price or an order id,
   and can the auth code be submitted through the API (a command behind
   Submit Transfer, or `set_transfer_auth_code` on the order it creates)?
5. Answered (2026-11-04): no, Dynadot refuses to list an unverified name
   (409).
6. Answered in part: the live path is `aftermarkets/…/for_sales`, and the
   registrar's key reads the marketplace. Still open: whether writes need
   anything more on the key or the account.
7. Answered in part (2026-11-07): a listing keeps the currency it was set
   in, but no read says which; the other-registrar list shows USD,
   converted. "Cents" are the amount times 100 in each currency. Still
   open: why the test account took only 14 of the 32 ("Currencies").
8. What do `asking_price` and `reserve_price` do on a listing held
   elsewhere, beside Buy Now and the minimum offer?
9. Does add refuse names at Dynadot (in another Dynadot account), or names
   another Dynadot user has already added?
10. Answered in part: Verify now found a fresh TXT record at once, and
    answered six calls in a row without a limit (2026-11-07). Still open:
    how often Dynadot checks on its own.
11. Answered (2026-11-04): `description` is required, a missing or empty
    one is refused and a single space passes; DomBot sends a space and
    doesn't manage descriptions.
12. Can a name in the account be listed or changed while it has a sale
    under way, a Buy Lock, or a recent transfer, and what does Dynadot
    answer?
13. After a sale of a name in the account, can DomBot tell from the
    registrar side that it was sold rather than pushed or transferred (a
    `domain_list` status, an order)? On the web host, how are webhooks set
    up and signed?
14. Answered (2026-11-04): both. The name's lock (409) and the account
    lock (400 "Please unlock your account firstly.") each block
    `set_for_sale`; DomBot unlocks and relocks the name itself. Dynadot's
    "without checking account locks or domain locks" setting for allowed
    IPs gets past neither (checked again 2026-11-07).
