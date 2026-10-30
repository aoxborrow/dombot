# MCP tools

DomBot's MCP server exposes the portfolio and every registrar operation it
supports as tools. They're registered by `registerTools` in
[`src/core/mcp/tools.ts`](../src/core/mcp/tools.ts) and call the same services
as the app, so a write from an agent patches the cache and updates an open
Domains table the same way a row control does. How to connect a client is in
the [README](../README.md#connecting-an-ai-agent) and in the app under
Settings → MCP.

Writes aren't gated behind a per-call approval: approving the client's
connection in DomBot is the gate. Money ops (register, transfer, renew) say so
in their descriptions.

## Scope and parameters

The name prefix says what a tool acts on:

- **`portfolio_*`** and **`registrar_list`**: the whole portfolio, no scope
  params.
- **`registrar_*`**: one registrar account. `registrar` is required (a
  registrar id such as `dynadot`).
- **`domain_*`**: one domain you own. `domain` is required; `registrar` is
  optional.
- **`folder_*`**: DomBot's own folders. A folder is named by its name or id
  (case-insensitive); `Hidden` is the built-in folder. No registrar calls.

**Resolving the registrar.** On `domain_*` tools, an omitted `registrar` is
looked up in the cached portfolio, since you own the domain. A name the cache
doesn't have fails with a message to pass `registrar` or run `portfolio_sync`;
a name the cache lists under two registrars (a stale transfer) fails asking
for `registrar`. An imported name fails saying no connected account reports
it. Pass it to skip the lookup or for a name not synced yet.

**Choosing an account.** Every `registrar_*` and `domain_*` tool takes an
optional `accountId` (from `registrar_list`); labels aren't accepted. With
`accountId` alone, the registrar comes from that account. Without it, a domain
tool uses the one enabled, configured account whose cache holds the name, and
a registrar tool uses the registrar's only configured account. When that's
ambiguous, or the chosen account is disabled, has no credentials, or doesn't
hold the domain in the cache, the call fails before reaching the registrar.
See [multi-account.md](multi-account.md#mcp).

**Cache.** Reads marked "cached" serve the local cache when it's fresh and
take `refresh` to fetch live and write the result through.

## Portfolio

- **`registrar_list`** — every registrar id, plus each account's `accountId`,
  `registrar`, `label`, `configured`, `enabled`, `proxy` (whether it routes
  through the fixed IP proxy) and `sync` state. Also the `configured` and
  `active` registrar ids. No secrets. Start here.
- **`portfolio_query`** — list, search and filter the cached portfolio across
  every account, plus the names you imported. Filters: `ownership` (`owned`,
  the default, `archive` or `all`, as the Domains page's Owned / Archive
  switch), `accountId`, `registrar`, `source` (`registrar` or `imported`),
  `tld`, `folder` (a name, an id, or `Hidden`), `nameContains`,
  `nameserverContains`, `autoRenew`, `locked`, `privacy`, `status`,
  `expiresBefore`, `expiresAfter`, `expiringWithinDays`. Plus `sort` (also
  by `renewalPrice`, compared as numbers whatever the currency), `order`,
  `limit` and `offset`. No registrar calls. Returns
  `{ total, fetchedAt, stale, registrars, errors, rows }`.
  - Each row carries `ownership`, `archiveLabel` (`sold`, `dropped`,
    `archived`, or `removed` for a removal you haven't labeled), `hidden`, and
    `inAccount`.
  - Hidden names count as owned: they're still yours and still renew.
  - Each row also carries what DomBot keeps for the name: `paid` (date,
    amount, currency, and `kind`: registered or purchased), `sold`, `notes`,
    `askingPrice` (`amount`, `minOffer`, `floor`, `currency`) and
    `renewalPrice` (DomBot's yearly estimate with its `source`, as
    `domain_renewal_price`). Each is `null` when there's nothing on record.
  - An imported name has `source: 'imported'`, no `accountId`, `inAccount:
false`, and `registrarLabel` when you typed a registrar DomBot doesn't
    know. Its `autoRenew` is what you told DomBot, or `null`.
  - An Archive name can still be in an account (a sale in escrow). One no
    account reports has `inAccount: false`, its last known registrar, and
    `null` for the settings an account reports. The `domain_*` tools can't act
    on it.
- **`portfolio_alerts`** — what needs you, as the bell shows it: failed
  syncs (`sync-error`), names that left an account (`departure`, high
  priority) and names that arrived (`arrival`, low). Most severe first, then
  newest. `kind?`, `limit?`, `offset?`. Returns `{ total, counts, alerts }`;
  each alert's `eventId` is what `resolves` and `portfolio_alert_dismiss`
  take.
- **`portfolio_alert_dismiss`** — `alertIds[]`, `dismissed?` (default
  `true`; `false` brings them back). Dismisses without recording anything.
  Returns the ids still open.
- **`portfolio_sync`** — re-sync every active account and return a
  per-account summary (counts, last sync, errors).

## Folders

The same folders as Settings → Folders and the Domains table's folder column,
in the same store, so a change shows up in an open window right away. Folder
names are kept unique (case-insensitive), and none may be called `Hidden`.

- **`folder_list`** — every folder's `id`, `name`, `description`, `color`,
  `builtIn` and `domainCount`, ending with the built-in Hidden folder
  (`__hidden__`).
- **`folder_create`** — `name`, `description?`, `color?` (one of the app's
  palette keys; default `blue`). Returns the new folder.
- **`folder_rename`** — `folder`, `name`. Returns `{ id, name, previousName }`.
  Hidden can't be renamed.
- **`folder_delete`** — `folder`. Its domains go back to no folder; nothing is
  deleted at a registrar. Returns `{ id, name, deleted, unassigned }`. Hidden
  can't be deleted.
- **`domain_set_folder`** — `domain`, `folder` (a name, an id, `Hidden`, or
  `null` for no folder). A domain is in at most one folder, so this replaces
  any current one. The domain must be in your portfolio, owned or Archive.
  Returns `{ domain, folder, previous }`.

## History, money, notes and ownership

DomBot's own data about a name, read and written through the same services as
the app. No registrar calls. Each takes `domain`, which must be in your
portfolio: synced, imported, or with history.

- **`domain_history`** — every event for the name, oldest first, with its
  note and current `ownership` / `archiveLabel`. Each event has its `source`;
  sync alerts (`added`, `removed`) also have `alert` (`open`, `dismissed` or
  `resolved`) and `resolvedBy`.
- **`domain_purchase_set`** — `date?`, `amount?`, `currency?`, `kind?`
  (`registered` or `purchased`), `resolves?`. Edits the latest purchase;
  with `resolves` (an open `added` alert) it records the purchase that
  answers it. Leaving out both `date` and `amount` deletes the purchase.
  Returns `{ domain, paid, sold }`.
- **`domain_sale_set`** — `date?`, `amount?`, `currency?`, `resolves?`.
  Records a sale (dated today by default) when none is on record or
  `resolves` names a new alert, otherwise edits the latest; the name moves to
  Archive as Sold. Undo it with `domain_ownership_set` `owned`. Returns
  `{ domain, paid, sold, ownership, archiveLabel }`.

- **`domain_note_set`** — `notes`, replacing the note; `""` deletes it.
  Returns `{ domain, notes }`.
- **`domain_asking_price_set`** — `amount?` (BIN), `minOffer?`, `floor?`,
  `currency?`. Replaces the asking price: what's left out is cleared, and all
  three left out removes it. `currency` is required unless clearing. Returns
  `{ domain, askingPrice }`.
- **`domain_renewal_price_set`** — `amount` (`null` clears it), `currency?`
  (default `USD`). Your yearly price, which `domain_renewal_price` then
  reports with source `manual`. Returns `{ domain, renewalPrice }`.
- **`domain_ownership_set`** — `ownership`: `dropped` or `archived` moves the
  name to Archive; `owned` undoes your Sold, Dropped or Archived mark (Move
  back to Owned). `date?` defaults to today. A name in Archive only because
  sync saw it leave can't be moved back. `resolves?` answers an open
  `removed` alert. Returns `{ domain, ownership, archiveLabel }`.

Purchases, sales and marks an agent records have `source: 'agent'`, shown as **Agent** in Activity, so
you can tell what an agent did from what you did. Otherwise an agent's mark
behaves like yours: your next mark replaces it, and Move back to Owned undoes
it.

## Registrar

- **`registrar_test`** — test an account's credentials.
- **`registrar_domains`** — list every domain in the account, live.
- **`registrar_sync`** — re-sync one account into the cache.
- **`registrar_set_enabled`** — `enabled`: turn an account on or off, as the
  app does. A disabled account keeps its credentials but doesn't sync, and its
  names leave `portfolio_query`; enabling syncs it. Adding, removing and
  credentials stay in the app.
- **`registrar_check_availability`** — `domains[]`: whether each can be
  registered.
- **`registrar_pricing`** — `tld` (or a domain): the registrar's live
  registration, renewal and transfer prices.
- **`registrar_register_domain`** — `domain`, `input` (`contacts` with a
  registrant, `years?`, `nameservers?`, `privacy?`, `autoRenew?`,
  `consent?`). Costs money.
- **`registrar_transfer_domain`** — `domain`, `input` (`authCode`, `years?`,
  `contacts?`, `privacy?`, `autoRenew?`, `consent?`). Costs money.

## Domain

All take `domain`, optional `registrar` and optional `accountId`, except
`domain_set_folder`.

Reads:

- **`domain_get`** — the full record: status, dates, auto-renew, lock,
  privacy, nameservers. Cached; `refresh?`.
- **`domain_nameservers_get`** — nameservers, from the registrar or the
  public registry. Cached; `refresh?`.
- **`domain_contacts_get`** — registrant, admin, tech and billing contacts.
- **`domain_dns_get`** — DNS records at the registrar.
- **`domain_dnssec_get`** — whether DNSSEC is on, and its DS records.
- **`domain_email_forwarding_get`** — email forwarding rules.
- **`domain_url_forwarding_get`** — URL forwarding rules, including read-only
  `masked` ones.
- **`domain_auth_code_get`** — the EPP/auth code. A secret.
- **`domain_renewal_price`** — DomBot's estimated annual renewal price and
  where it came from: your manual price, a per-name quote, the account's TLD
  rate, or the base database. Not the registrar's live quote (that's
  `registrar_pricing`).

Writes:

- **`domain_set_autorenew`** — `enabled`.
- **`domain_set_lock`** — `locked`.
- **`domain_set_privacy`** — `enabled`.
- **`domain_nameservers_set`** — `nameservers[]`.
- **`domain_dns_set`** — `records[]` (`type`, `name`, `value`, `ttl?`,
  `priority?`, `weight?`, `port?`). Replaces the whole set.
- **`domain_contacts_set`** — `contacts` (any of the four roles).
- **`domain_email_forwarding_set`** — `forwards[]` (`alias`, `forwardTo`).
  Replaces the whole set; an empty array clears it.
- **`domain_url_forwarding_set`** — `forwards[]` (`host`, `url`, `type`:
  `temporary` or `permanent`). Replaces the whole set; an empty array clears
  it.
- **`domain_renew`** — `years?` (default 1). Costs money.
- **`domain_set_folder`** — see [Folders](#folders). Local only, so it takes
  no `registrar` or `accountId`.

Auto-renew, lock, privacy, nameservers, forwarding and renew run through the
same dispatcher as the Domains table ([domain-editing.md](domain-editing.md)),
so they're gated by what the registrar supports and return `{ accountId,
registrar, success, status, message }`. `status` is `ok`, `failed`,
`unsupported`, `skipped`, `rate-limited`, `cancelled`, or `unknown` when a
write's outcome couldn't be confirmed; the message says whether it's safe to
try again. `domain_dns_set` and `domain_contacts_set` return the registrar's
`{ success, message }`. `domain_auth_code_get` goes through the dispatcher too
and returns `{ domain, authCode }`, or fails with the reason.

Not every registrar supports every tool; an unsupported call fails with the
reason. The support matrix is in
[domain-editing.md](domain-editing.md#what-each-registrar-supports).

## Markets

Marketplace accounts from Settings → Markets ([markets.md](markets.md)).
Listings, sales and account stats are read from what market sync stored;
`market_sync` refreshes them. A tool or filter a market can't support fails
saying so.

- **`market_list`** — every market account: `accountId`, `market`, `label`,
  `configured`, `enabled`, its last `sync`, and the market's `capabilities`.
  No secrets.
- **`market_sync`** — `accountId?`. Re-reads listings, sales and stats from
  one account or every enabled one. Completed sales become `sold` events.
- **`market_listings`** — your listings across accounts: filter by `market`,
  `accountId`, `status[]`, `forSale`, `nameContains`, `tld`, `priceMin`,
  `priceMax`; `sort` by `name`, `price`, `status`, `listedAt` or
  `searches30`; `order`, `limit`, `offset`. Prices are decimal strings.
- **`domain_listing_get`** — `domain`, `market?`. One name's listings.
- **`market_sales`** — sales, newest first: filter by `market`,
  `accountId`, `from`/`to` (sold on), `status`, `kind`, `nameContains`.
  Returns `totals` (price, commission, net per currency) over every match.
  Never includes auth codes.
- **`market_stats_get`** — `accountId`, `days?`. Stored daily views and
  leads, with totals.
- **`domain_stats_get`** — `domain`, `accountId?`, `days?` (default 30).
  Live from the market that lists the name; for Atom, which reports only
  running totals, from what sync stored (views per day, worked out between
  syncs, and the latest views, shortlists and offers).
- **`market_settings_get`** — `accountId`. The account's defaults for new
  listings, live.
- **`market_categories_get`** — `accountId`. The categories and name
  languages the market's listings take (Sedo; Atom's primary categories,
  no languages), live.
- **`market_payments_get`** — `accountId`, `month` (any day in it). Parking
  payouts for that month (Sedo), live.

- **`market_traffic`** — `accountId?`, `days?` (30 or 365), `sort?`
  (`leads`, `views`), `minViews?`, `limit`, `offset`. Listed names ranked by
  stored views and leads, with `coverage`: per-name traffic is fetched a
  slice of names per sync.
- **`market_report_get`** — market sales by year and in
  total, sell-through over the last 12 months, and views and leads by month.

`portfolio_query` also takes `listedOn` and `notListedOn` (a market id), to
find names listed on a market or the ones that aren't yet. For DomBot's own
asking prices it takes the Domains Pricing filter: `askingPrice` (any of
`forSale`, `bin`, `minOffer`, `floor`, `none`), `binMin`/`binMax`,
`minOfferMin`/`minOfferMax`, `floorMin`/`floorMax`, and `priceCurrency` to
keep those ranges to one currency.

Writes. Each returns one result per name with `ok`, `pending` (accepted, not
live yet), the listing as `saved`, `adjusted` (fields the market saved
differently, like Afternic's lease-to-own cap) and `error`. Prices are
decimal strings or numbers.

- **`domain_listing_set`** — `domain`, `accountId?`, and the fields to set:
  `price` (the Buy Now price; null: offers only), `minOffer`,
  `floor` (null clears), `currency`, `forSale`, `leaseToOwn`, `afternic`
  (lander settings), `sedo` (`categories`, `language`), `atom` (`tier` for
  a new listing, Standard or Plus; `category`; `description`). Lists the
  name if it isn't listed. On Sedo a new listing comes back `pending` until
  Sedo's checks pass. Atom takes one whole-dollar price of $100 or more
  (or null, Make an Offer) and rejects `minOffer` and `floor`. `fromAskingPrice: true` takes the prices from DomBot's
  asking price instead. `accountId` can be left out when the name is listed
  in one account or there's only one.
- **`domain_listing_delete`** — `domain`, `accountId?`. Delists; the name
  stays in your registrar account.
- **`market_listings_set`** — `accountId`, and `changes[]` (each a `name` and
  fields, as above) or `domains[]` with `fromAskingPrice: true`. Any number
  of names, in the market's batch size. On a market that writes one name a
  call (Atom), more than 10 names start a market bulk job instead, returned
  as `{ job }`.
- **`market_listings_delete`** — `accountId`, `domains[]`. Same job rule.
- **`market_job_get`** — `cancel?`. The latest market bulk job: status,
  done of total, counts by outcome (`skipped`: already as asked), and the
  failures so far. Poll until it isn't running; on the web app each call
  also runs it a few seconds.
- **`market_listings_relist`** — `accountId`, `domains[]`, `mode?`
  (`RESYNC` re-checks, `REACTIVATE` brings back an inactive listing).
  `fromAskingPrice` writes already do this for listings that were inactive,
  rejected or stuck pending, and say so per name as `relisted`.
- **`market_sale_auth_code_set`** — `accountId`, `saleId`, `authCode?`.
  Without a code, DomBot gets it from the registrar account that holds the
  name. Never returned or stored.
- **`market_sale_message_send`** — `accountId`, `saleId`, `message`. Reaches
  a person at the market.
- **`market_settings_set`** — `accountId`, and the listing defaults to
  change.

Atom only (each fails saying so on markets without it):

- **`domain_listing_discount_set`** — `domain`, `accountId?`, `amount`
  (whole dollars off, at most 30% of the price; null clears). Lasts until
  Atom resets discounts on Monday.
- **`domain_listing_verify`** — `domain`, `accountId?`. Asks Atom to check
  the name's nameservers or TXT record now; once per account every 12
  hours.
- **`market_grading_submit`** — `accountId`, `domains[]`. Atom's AI grading
  (brand fit, Premium fit); **`market_grading_get`** — `accountId`,
  `page?`, `brandFitOnly?` reads the results.
- **`domain_appraisal_get`** — `domain`, `accountId?`. Atom's appraisal of
  any name; 10 a day.

There is no boost tool and no way to add a Premium Atom listing: both spend
Atom credits, so they're done on atom.com.
