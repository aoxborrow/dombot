# Dynadot Marketplace API

Plan for Dynadot's marketplace (its aftermarket) as a DomBot market, on the
shared model in [markets.md](markets.md), written to sit beside
docs/afternic-api.md, docs/atom-api.md, docs/sedo-api.md and the Spaceship
SellerHub plan (docs/sellerhub-api.md, PR #251). Docs: the RESTful v2
reference at <https://www.dynadot.com/domain/api-document#set_for_sale>
("Aftermarket" section). Dynadot's seller help:
<https://www.dynadot.com/help/question/domain-sale-process> and, for names
held elsewhere, <https://www.dynadot.com/help/question/open-marketplace>.

**Status: planned, nothing built, no live calls yet.** Everything below is
from the API reference and Dynadot's help pages as read on 2026-11-03. Only
the other-registrar commands run in Dynadot's sandbox, so the build needs
live calls on test names early (see "Testing").

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
documented (open question 1).

### Reading listings of names in the account

No seller "my listings" call is documented for these. What there is:

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
  `ns1.dyna-ns.net`, `ns2.dyna-ns.net` and `ns3-<key>.dyna-ns.org`: a
  shared pair plus a third that carries the key, the same pattern as
  Afternic's NS3.
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
  60 days don't qualify.

## What to implement

### Implement

| Command                                       | Why DomBot wants it                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `other_registrar_domain_list`                 | Sync for names held elsewhere: sale type, price, verification and transfer status, 100 a page.                                                                                 |
| `add_other_registrar_domain`                  | The first step of listing a name held elsewhere, done for the user as part of List.                                                                                            |
| `other_registrar_domain_verification`         | The account's Open Marketplace Key, saved as its Ownership Verification ID, so there's nothing to paste once a name is added.                                                  |
| `verify_other_registrar_domain`               | Recheck ownership, for a list of names; also run after DomBot adds the TXT records.                                                                                            |
| `listing_other_registrar_domain`              | List, reprice, Buy Now and Make Offer, minimum offer, delist (`not_for_sale`) for names held elsewhere.                                                                        |
| `delete_other_registrar_domain`               | Take a name off Dynadot's list entirely, when asked.                                                                                                                           |
| `domain_list` (`is_for_sale`)                 | Which names in the account are listed. From the registrar sync once registrar-client passes the flag through (a small registrar-client change); otherwise the market reads it. |
| `get_listing_item`                            | Price, Buy Now or offers, and a sale under way, per listed name in the account.                                                                                                |
| `get_listings`                                | Sync in one paged read, if it's the account's own listings (open question 2).                                                                                                  |
| `set_for_sale`                                | List, reprice, Buy Now and Make Offer, minimum offer, delist (`not_for_sale`) for names in the account.                                                                        |
| `accounts/info`                               | The account test, and `price_level` for the rate limit.                                                                                                                        |
| Express Pay Links (phase 5)                   | A checkout link at a set price for a buyer the user is talking to; Dynadot can also list and delete them.                                                                      |
| `set_other_platform_confirm_action` (phase 5) | Fast Transfer for the Afternic and Sedo listings of names held at Dynadot.                                                                                                     |

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
  beside Buy Now and the minimum offer isn't documented (open question 9).

### Leave out

- **Buying:** buy now, bids, backorders, closeouts, and buying Afternic or
  Sedo names through Dynadot. It spends money, and DomBot manages names you
  hold.
- **`listing_on_afternic`, `listing_on_sedo`:** Dynadot listing your name on
  Afternic or Sedo for you. DomBot lists on both directly, with their own
  accounts; a second path would give one listing two owners.
- **The `auction`, `portfolio_auction` and `broker_service` sale types.**
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

SellerHub's plan builds registrar-backed market accounts first
(docs/sellerhub-api.md, "Credentials: borrowing the Spaceship registrar
key"), and Dynadot uses the same flow: pick a Dynadot registrar account,
read its key at call time, cards that point at each other, remove-both.
Whichever market lands first builds it. What's different for Dynadot:

- **No scopes.** Nothing in the reference scopes a key, so any key that
  works for the registrar should work for the marketplace (open question 7).
  The test reads `accounts/info` and one page of each listing read.
- **One budget for both sides.** On Regular, Dynadot answers a second
  request in flight with a 429. Registrar calls on a key already run in one
  bulk lane, a second apart (docs/domain-editing.md, "Concurrency policy"),
  while a market job gets a lane per market account. A Dynadot market
  account's calls have to wait their turn behind the same key's registrar
  calls: its market-job lane and the registrar lane share one limiter,
  keyed by the registrar account (`src/core/markets/rate-limit.ts` is
  already shared by account key), sized from `price_level`. Auto-sync
  already runs markets after registrars, so the two syncs don't overlap.
- **A Dynadot registrar account is needed** for the key, even to sell only
  names held elsewhere. A user with no Dynadot names opens a Dynadot
  account, makes a key and connects it as a registrar with nothing in it;
  the market card says so. A separate key on the market card isn't
  offered: it's the same key either way.

## What it means for DomBot

The market id is `dynadot`, the same as the registrar, shown as "Dynadot
Marketplace".

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
"elsewhere" (open question 10); a second Dynadot market account, linked to
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
  `get_listing_item` for each, or `get_listings` in pages if it turns out to
  be the account's own. On Regular, 1,000 listed names take about 17
  minutes, sharing the minute with registrar sync; Bulk is ten times faster.

A failed read leaves `complete` false and keeps the last snapshot.

| `MarketListing`             | In the account (`get_listing_item`)                      | Held elsewhere (`other_registrar_domain_list`)                                               |
| --------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `name`                      | `domain`                                                 | `domain_name`                                                                                |
| `displayName`               | null                                                     | null                                                                                         |
| `status`                    | `active`; `on_hold` when `is_pending_sale_locked`        | `pending` while Unverified; `on_hold` once a buyer has paid (open question 5); else `active` |
| `statusRaw`                 | `type`, with "pending sale" when locked                  | `status` and `verify_status`                                                                 |
| `forSale`                   | true for every listing read                              | Verified and listed                                                                          |
| `price`                     | `price` (open question 3: what a `make_offer` has there) | `price` (open question 8: its currency and format)                                           |
| `buyNow`                    | `type` is `bin` or `bin_make_offer`                      | `for_sale_type` is Buy Now or Buy Now + Make Offer                                           |
| `minOffer`                  | not readable; see below                                  | not readable; see below                                                                      |
| `floor`, `discount`, `tier` | null                                                     | null                                                                                         |
| `leaseToOwn`                | null: installments aren't readable                       | null: installments aren't readable                                                           |
| `currency`                  | the account's listing currency (below)                   | the account's listing currency                                                               |
| `listedAt`                  | null                                                     | null                                                                                         |
| `updatedAt`                 | null                                                     | `updated_date`                                                                               |

`extra` is `{ market: 'dynadot', held, listingId, offers, pendingSale,
verified, registrar, transferStatus, minOfferSent }`, each where the read
has it. `offers` is true for the Make Offer types: Dynadot says whether
offers are welcome even where it doesn't give the minimum.

**Currency:** the market card has a **Listing Currency** (USD to start).
Writes send it and reads ask for it. A listing priced in another currency
on Dynadot's site then reads converted, if Dynadot converts (open
question 8), and shows as above or below the DomBot price.

### Writes

One name a call (`writeBatch: 1`, market jobs past 10 names, in the
registrar account's lane). Common to both kinds:

- **`listing_type`** follows the result: a price alone is Buy Now, a price
  and a minimum offer Buy Now + Make Offer, a minimum offer alone Make
  Offer. A change keeps whatever it doesn't touch, so the adapter reads the
  listing first, as Atom's does, and reads it back after to fill `saved`
  and `adjusted`.
- **Minimum offer:** sent, but no read returns it. DomBot keeps the last
  value it sent in `extra.minOfferSent`, and the listing editor shows it as
  last set from DomBot. If a live read has it after all, it becomes a
  plain field.
- **If the write replaces the listing** (open question 1), a price change
  would clear the minimum offer, category, description and installments,
  and DomBot couldn't see it. Then DomBot re-sends its `minOfferSent`, and
  the editor says that saving clears Dynadot's category, description and
  installment settings.
- **`forSale: false`** is refused with "Dynadot has no hidden listings;
  delist instead". `not_for_sale` is the delist.
- **Floor, discount, lease-to-own, tiers:** refused with a message, never
  dropped (markets.md, "Capabilities").
- **A listing with a sale under way** (`on_hold`) isn't written; the result
  says why.

In the account: `set_for_sale` with `marketplace`, or `not_for_sale` to
delist.

Held elsewhere:

- **List:** add the name if Dynadot doesn't have it yet, then
  `listing_other_registrar_domain` with `marketplace`. Amounts go in the
  currency's minor units (cents for USD; open question 8 for currencies
  without them). The listing reads `pending` until Dynadot has verified the
  name; whether Dynadot takes the listing before then is open question 6,
  and if it doesn't, the market job lists the name once a later sync sees
  it Verified.
- **Delist:** `listing_other_registrar_domain` with `not_for_sale`. The name
  stays added and verified, so listing it again is one call. Delist has
  **Also remove from Dynadot** (off), which runs
  `delete_other_registrar_domain` after.
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

  The NS3 carries the account's key, as Afternic's
  `verification-<ID>.ns101.verify.hn` does, so nameservers prove ownership
  on their own, even for a name another account has added. The three are
  declared in `src/core/markets/dynadot/nameservers.ts` (the pair, and
  `*.dyna-ns.org` for the NS3) and make the Dynadot preset in the
  nameserver editor's Markets group, the NS3 lowercased like every
  nameserver DomBot sends. Nameservers hand the name's DNS to Dynadot, and
  they're the only method that gets Dynadot's For Sale landing page; TXT
  stays the default.

- **Ownership verification TXT…** offers the Dynadot account for names held
  elsewhere, through the registrar account that holds each name, as for
  every market. When the job has finished, DomBot asks Dynadot to verify
  those names (one `verify_other_registrar_domain` call for the batch);
  names that fail are asked again on the next sync, since resolvers may
  still have the old answer cached.
- **List at your prices** turns **Add ownership verification TXT records**
  on to start for a Dynadot listing of names held elsewhere: without it
  the listing can't go live. The user can still turn it off.
- **Recheck ownership…** works (`verifyDns: true`), many names a call.
- **Keeping it in place.** Removing the TXT record, or moving the name to
  other nameservers, gets the Dynadot listing removed. DomBot's nameserver
  change warning names the Dynadot listings that would lapse, and the DNS
  editor keeps the record like any other.
- **Tracking** (markets.md, "Tracking which names are set up") gets its
  answer for free here: `verify_status` from sync says, per name, whether
  Dynadot sees it. Phase 1's nameserver rule recognizes the Dynadot pair
  and this account's NS3 as it does Afternic's.

### Sales

`sales: true`, for names held elsewhere only; names in the account have no
sale record to read.

**Held elsewhere:** the list read shows a sale under way (which `status` or
`transfer_status` says the buyer has paid is open question 5). Sync opens a
sale record for it: `in_progress`, keyed by `${name}:${the day sync first
saw it}`, the listed Buy Now price, commission estimated at 10%, `action:
'auth_code'`. An offer-only listing has no price DomBot can read, so its
sale shows only as on hold, and Record sale… fills in after the name leaves.

The Sales tab's steps then mostly work as they do for Afternic:

1. **Unlock** at the registrar account that holds the name.
2. **The auth code.** DomBot fetches it from the holding registrar, but
   there's no documented way to give it to Dynadot (open question 5). So
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

### Afternic and Sedo Fast Transfer (phase 5)

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

### Express Pay Links (phase 5)

The same tool as SellerHub's checkout link,
`domain_listing_checkout_link_create` (name, price, currency, installments,
an expiry of never, 1, 3, 7, 14 or 30 days), returning the link. Dynadot
can also list and delete them, so `market_checkout_links` and
`domain_listing_checkout_link_delete` too. The description says the link is
meant for a buyer. Whether they work for names held elsewhere isn't said.

### Capabilities

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
  asyncInsert: false,
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
`domain_listing_verify` work for names held elsewhere;
`domain_listing_delete` takes `removeFromMarket` for Dynadot's list.
Phase 5 adds the pay link tools and `domain_listing_fast_transfer_set`
(name, `afternic` or `sedo`, on or off).

### The demo

A Dynadot Marketplace account linked to the demo's Dynadot registrar
account (`src/core/demo/markets.ts`), with a made-up Open Marketplace Key
as its verification ID: Buy Now, offers-only and
pending-sale listings in the account, and names from the demo's other
registrars on Dynadot, one waiting on verification and one sold and
waiting on its auth code.

## Testing

Unit tests map fixtures built from the reference, swapped for live captures
as they come in. Live tests follow Atom's: reads with the Dynadot key in
`.env`, writes behind `DYNADOT_LIVE_WRITES=1`, each listed at a price
nobody would pay, read back, then delisted.

- **Held elsewhere:** domanio.com and domainio.com, both at 101domain, are
  the test names (`DYNADOT_TEST_EXTERNAL_DOMAIN`): add, TXT through
  101domain, verify, list, delist, remove. Add and verify run in the
  sandbox first.
- **In the account:** no sandbox, so production on a name held at Dynadot
  (`DYNADOT_TEST_DOMAIN`), picked with the user first.

## Phases

1. **Registrar-backed market accounts:** SellerHub's phase 1
   (docs/sellerhub-api.md), built here if Dynadot goes first. For Dynadot
   also: one limiter for a key both sides use, sized from `price_level`.
2. **Read side, both kinds:** client (signature, envelope, errors, limiter),
   adapter with the two paths, registry entry, sync from
   `other_registrar_domain_list` and from `is_for_sale` plus
   `get_listing_item` (or `get_listings`), the Listing Currency setting,
   the demo account. Live reads, open questions 1–6 first.
3. **Writes and verification:** list, reprice, Buy Now and offers, minimum
   offer, delist for both kinds; add and remove for names held elsewhere;
   the Open Marketplace Key read into the verification ID, Ownership
   verification TXT… with a verify after it, Recheck, the nameserver preset
   with its NS3, and the nameserver warning. Through the List and Delist
   dialog, the bulk runner and the MCP tools. Live round trips on both
   test names.
4. **Sales:** sale records for names held elsewhere and their steps on the
   Sales tab; the Record sale… prefill for names in the account.
5. **Extras:** Express Pay Link tools; Fast Transfer for Afternic and Sedo.

## Open questions

1. Does `set_for_sale` (and `listing_other_registrar_domain`) change only
   the fields sent, or replace the listing? If a price-only call clears the
   minimum offer, category, description or installments, the reads won't
   show it.
2. Is `get_listings` the account's own listings or the whole marketplace?
   With `show_other_registrar`, does it include names held elsewhere?
3. Does `get_listing_item` return more than documented (minimum offer,
   currency, installments)? What's in `price` for a Make Offer listing?
4. The key is one per account (seen in the dashboard). Still open: does
   Regenerate (`new_key`) unlist names verified with the old key until
   their records change? Does `ns3-<key>.dyna-ns.org` answer DNS
   (Afternic's NS3 host doesn't), and does Dynadot accept the shared pair
   without it?
5. For a sold name held elsewhere: which `status` or `transfer_status`
   says the buyer has paid, does the list read give a price or an order id,
   and can the auth code be submitted through the API (a command behind
   Submit Transfer, or `set_transfer_auth_code` on the order it creates)?
6. Can a name held elsewhere be listed before it's verified, and does the
   listing go live on its own once it is?
7. Does the marketplace need anything on the key or the account (an API
   setting, a price level), or does any registrar key work? Is the live
   path `aftermarkets/…/for_sales` or `aftermarket/…`?
8. Currency: is a listing kept in the currency it was set in, and does a
   read in another currency convert it? What are "cents" for JPY or KRW?
   What currency and format is `price` in the other-registrar list?
9. What do `asking_price` and `reserve_price` do on a listing held
   elsewhere, beside Buy Now and the minimum offer?
10. Does add refuse names at Dynadot (in another Dynadot account), or names
    another Dynadot user has already added?
11. How often can Verify now be called, and how often does Dynadot check
    on its own?
12. Is `description` really required on `set_for_sale`, and what does an
    empty one do to an existing description?
13. Can a name in the account be listed or changed while it has a sale
    under way, a Buy Lock, or a recent transfer, and what does Dynadot
    answer?
14. After a sale of a name in the account, can DomBot tell from the
    registrar side that it was sold rather than pushed or transferred (a
    `domain_list` status, an order)? On the web host, how are webhooks set
    up and signed?
