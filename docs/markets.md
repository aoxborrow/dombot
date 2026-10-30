# Markets

How DomBot works with domain marketplaces: the shared model that Afternic,
Atom and Sedo map into, and what DomBot builds on it (storage, sync, Settings,
bulk writes, MCP). Each market's own API, quirks and client are in its plan:

- [afternic-api.md](afternic-api.md): client built
  (`src/core/markets/afternic/`), verified live.
- [atom-api.md](atom-api.md): client and adapter
  (`src/core/markets/atom/`, `src/core/services/markets/atom.ts`); reads
  and writes verified live.
- [sedo-api.md](sedo-api.md): client and adapter built
  (`src/core/markets/sedo/`, `src/core/services/markets/sedo.ts`), verified
  live (reads and writes).

Atom's and Sedo's plans each proposed a first cut of shared types. This doc
replaces both; where they disagreed, the choice and the reason are below.

## Two layers

1. **A client per market** in `src/core/markets/<market>/`, speaking that API
   in its own types. Afternic's stays as built: whole-dollar numbers,
   Afternic's enums and names. Clients don't know about each other or about
   DomBot's storage.
2. **An adapter per market** in `src/core/services/markets/<market>.ts`,
   mapping its client into the shared types in `src/core/markets/types.ts`.
   Everything else in DomBot (storage, sync, the Domains table, Settings,
   bulk writes, MCP) sees only shared types and the market's capabilities,
   never a market's own shapes, and never `if (market === 'atom')`.

**The shared layer came before Afternic's DomBot work.** Stored records
(`market-*` namespaces, `sold` events) don't change once written without a
migration, and MCP tools are a public interface, so both started out
market-neutral. Sedo and Atom then each added a client, an adapter and some
capability flags.

## Shared types

`src/core/markets/types.ts`, abridged; the file is the reference.

```ts
type MarketId = 'afternic' | 'atom' | 'sedo';

/** Canonical decimal strings, as DomBot's ListPrice ("2500", "1479.09"). */
type Amount = string;

interface MarketListing {
  market: MarketId;
  accountId: string;
  /** toAscii(name). */
  name: string;
  /** Mixed case or Unicode form shown to buyers, when the market has one. */
  displayName: string | null;
  status: ListingStatus;
  /** The market's own word for it. */
  statusRaw: string;
  /** Shown to buyers at all (Afternic `!hidden`, Sedo `forsale`). */
  forSale: boolean;
  /** The listed price; null when there isn't one (offers only). */
  price: Amount | null;
  /** Buyers can buy outright at `price`; false: asking, offers welcome. */
  buyNow: boolean;
  minOffer: Amount | null;
  /** Lowest price auto-accepted; never shown to buyers. */
  floor: Amount | null;
  /** A temporary reduction (Atom: until Monday). */
  discount: { amount: Amount; until: string | null } | null;
  currency: CurrencyCode;
  leaseToOwn: { enabled: boolean; maxPayments: number | null } | null;
  /** A market's listing tier (Atom: standard, plus, premium, geo). */
  tier: string | null;
  listedAt: string | null;
  updatedAt: string | null;
  /** The rest, typed per market: AfternicExtra | AtomExtra | SedoExtra. */
  extra: MarketExtra;
}

type ListingStatus =
  | 'active' // live and for sale
  | 'pending' // accepted, not live yet (verification, review, async insert)
  | 'inactive' // listed but not live (Afternic INACTIVE, needs DNS, …)
  | 'rejected' // the market refused it (FAILED_COMPLIANCE, review rejected)
  | 'on_hold' // mid-sale or locked
  | 'sold'
  | 'unknown';

/** A change to one listing. Only the fields given are changed. */
interface MarketListingChange {
  name: string;
  price?: Amount | null;
  minOffer?: Amount | null;
  floor?: Amount | null;
  currency?: CurrencyCode;
  forSale?: boolean;
  leaseToOwn?: { enabled: boolean; maxPayments?: number };
  /** Per-market settings (Afternic lander, Atom category, …). */
  extra?: MarketExtraChange;
}

interface MarketWriteResult {
  name: string;
  ok: boolean;
  /** Accepted but not live yet. */
  pending: boolean;
  /** The listing as saved, when the market said or a read-back showed it. */
  saved: MarketListing | null;
  /** Fields the market saved differently from what was asked. */
  adjusted: { field: string; asked: unknown; saved: unknown }[];
  error: { code: string; message: string } | null;
}

interface MarketSale {
  market: MarketId;
  accountId: string;
  /** The market's transaction id; with market + account, the record's key. */
  id: string;
  name: string;
  /** YYYY-MM-DD, the day it sold: the `sold` event's date. */
  soldOn: string | null;
  status: 'in_progress' | 'completed' | 'cancelled' | 'unknown';
  statusRaw: string;
  kind: 'buy_now' | 'offer' | 'lease' | 'unknown';
  price: Amount;
  commission: Amount | null;
  /** Derived from the market's published rates when the API doesn't say. */
  commissionEstimated: boolean;
  net: Amount | null;
  currency: CurrencyCode;
  installments: {
    amount: Amount | null;
    paid: number;
    total: number;
    next: string | null;
  } | null;
  paidOutOn: string | null;
  /** What the seller has to do next, when the market says (auth code, …). */
  action: 'auth_code' | 'transfer' | 'payee_details' | null;
}

/** One day for one name, or for an account (name null). */
interface MarketStatsDay {
  market: MarketId;
  accountId: string;
  name: string | null;
  date: string; // YYYY-MM-DD
  views: number | null; // Afternic views, Sedo visitors, Atom views
  leads: number | null; // Afternic
  clicks: number | null; // Sedo parking
  earnings: Amount | null; // Sedo parking, in `currency`
  currency: CurrencyCode | null;
  shortlists: number | null; // Atom
  trackers: number | null; // Atom price trackers
  /** 'market': the market's daily figure; 'derived': DomBot's diff of
   *  two snapshots (Atom). */
  source: 'market' | 'derived';
}
```

Rolling counters that aren't daily (Afternic's GoDaddy searches 30/90/365d,
Atom's analytics counters, offer counts) ride on the listing's `extra`. Sync
keeps dated snapshots of them so trends show over time.

### Choices between the two first cuts

- **Money is decimal strings with a currency** (Sedo's cut), not whole-dollar
  numbers (Atom's): DomBot's asking price is already that, Sedo prices in
  EUR, USD or GBP with cents, and Afternic sales carry cents. Afternic's and
  Atom's adapters convert.
- **`price` + `buyNow`** rather than Atom's `buyNow` price or Sedo's
  `fixedPrice`: one listed price, and a flag for whether a buyer can pay it
  outright, with no negotiation. Atom: always. Afternic: whenever a Buy Now
  price is set. Sedo: `fixedprice`; DomBot doesn't use Sedo's "Seller's asking
  price" (a price with `fixedprice: 0`, neither Buy Now nor a minimum offer),
  so it reads as offers only, every price DomBot sends is Buy Now, and an
  update clears an asking price. A change has no `buyNow`. The lander doesn't change that; it only
  changes what the name's own page shows, and buyers also reach the name
  through GoDaddy and partner registrars, which show the Buy Now price and
  minimum offer.
- **What the three prices mean** (Afternic, the market with all three):
  `price` is what a buyer can pay outright; `minOffer` is the lowest offer
  that starts a negotiation (the seller may still accept below the floor);
  `floor` is the lowest price a broker may accept without asking. Afternic
  enforces minimum offer ≤ floor ≤ Buy Now, equal allowed (checked live).
- **`forSale` is separate from `status`**: a listing can be live and not for
  sale (Sedo parks it, Afternic hides it). Sedo's `not_for_sale` status
  became this flag.
- **Statuses** are the union of both cuts' values, plus `inactive` (Afternic,
  Atom's DNS-pending) and `unknown`. The raw status is always kept.
- **Sales are shared** (Atom's cut): Afternic and Atom both have them, so the
  record is shared now and Sedo reports "no sales API" through its
  capabilities.
- **`adjusted` on write results** is new: Afternic silently caps lease-to-own
  payments by price (afternic-api.md, "Observed"), and Atom may clamp Premium
  prices to a tier range. The adapter compares the saved listing with the
  change and says so.

## Capabilities

Each adapter declares what its market can do. The UI, bulk runner and MCP
read these; nothing checks a market's name.

```ts
interface MarketCapabilities {
  currencies: CurrencyCode[]; // afternic, atom: USD; sedo: EUR, USD, GBP
  minOffer: boolean; // afternic, sedo
  floor: boolean; // afternic
  discount: boolean; // atom
  leaseToOwn: boolean; // afternic
  tiers: string[] | null; // atom
  sales: boolean; // afternic, atom
  saleAuthCode: boolean; // afternic
  saleMessages: boolean; // afternic
  accountStats: boolean; // afternic, sedo
  domainStats: 'daily' | 'snapshot' | null; // atom: snapshot
  leads: boolean; // afternic
  parkingEarnings: boolean; // sedo
  searchCounts: boolean; // afternic (Domain Pro accounts only)
  accountSettings: boolean; // afternic
  relist: boolean; // afternic
  verifyDns: boolean; // atom
  asyncInsert: boolean; // sedo
  /** Names per write call: afternic 500, sedo 50, atom 1. */
  writeBatch: number;
  /** A file-based bulk path for very large pushes (afternic jobs). */
  jobs: boolean;
  /** Writes that can cost money (atom premium, boost). */
  spends: boolean;
  /** Requests a minute per account; null when unpublished (a setting). */
  rateLimit: number | null;
}
```

An unsupported field in a change (a floor for Atom, lease-to-own for Sedo) is
**rejected with a message**, never silently dropped.

## The adapter

```ts
interface MarketAdapter {
  readonly market: MarketId;
  readonly capabilities: MarketCapabilities;
  /** Settings form fields, like registrar-client's configFields. */
  readonly configFields: MarketConfigField[];
  test(): Promise<{ listings: number | null; notes: string[] }>;
  allListings(): Promise<{ listings: MarketListing[]; complete: boolean }>;
  getListings(names: readonly string[]): Promise<MarketListing[]>;
  /** At most `capabilities.writeBatch` changes; the bulk runner slices. */
  writeListings(
    changes: readonly MarketListingChange[],
  ): Promise<MarketWriteResult[]>;
  deleteListings(names: readonly string[]): Promise<MarketWriteResult[]>;
  allSales?(since?: string): Promise<MarketSale[]>;
  accountStats?(days: number): Promise<MarketStatsDay[]>;
  domainStats?(name: string, days: number): Promise<MarketStatsDay[]>;
}
```

Market-only actions (Afternic's auth code, relist and listing defaults;
Atom's discount, DNS verify, boost, grading, appraisal; Sedo's categories and
parking payments) are methods on that market's adapter, reached through the
MCP tools and UI actions listed below, each gated by a capability.

## Storage

Following docs/storage-model.md:

| Name                      | Flags  | Keyed by                 | Holds                                               |
| ------------------------- | ------ | ------------------------ | --------------------------------------------------- |
| `market-accounts`         |        | account id               | `{ market, label, enabled, registrarAccountId? }`   |
| `market-credentials`      | sealed | account id               | API keys; must be added to the desktop's sealed set |
| `market-listings`         | cache  | account                  | each account's listings as last synced              |
| `market-last-sync`        |        | account id               | when, how many, last error                          |
| `market-sales`            |        | `${accountId}:${saleId}` | sale records (never the auth code)                  |
| `market-stats`            |        | account id               | daily account `MarketStatsDay` rows, by date        |
| `market-domain-stats`     |        | `${accountId}:${name}`   | per-name views and leads, days with traffic only    |
| `market-search-snapshots` |        | `${accountId}:${name}`   | weekly snapshots of rolling search counts           |

- **Credentials** follow the Afternic plan: the desktop host only seals the
  namespaces it lists, so `market-credentials` goes in that set, and data
  bundles treat it like `registrar-credentials`.
- **`registrarAccountId`** (from the Atom plan) lets a market account borrow a
  registrar account's key when one provider is both (AtomRegistrar, later
  Dynadot and Namecheap). The field is in the record from the start; the
  Settings flow for it comes with the first such market.
- **Sales become `sold` events.** A completed sale writes one `sold` event
  (source `sync`, date `soldOn`, amount `price`, `currency`) unless one already
  exists for that sale: the event carries `marketSale`, the sale's
  `market-sales` key (`src/core/services/markets/sale-events.ts`). A `sold`
  event you recorded yourself within 14 days of the sale is linked rather
  than duplicated. A name an account still holds is only marked sold for a
  sale in the last 90 days; an older one means you bought it back. Commission and net stay on the sale record; reports join them.
  Cancelled sales write nothing, and a sale cancelled after its event was
  written raises an alert rather than deleting the event.

## Sync

- One sync per enabled market account, on the registrar schedule (Settings →
  Sync), sharing each market's per-account rate limit with everything else on
  that key.
- Listings: `allListings()` each time; an incomplete or torn read keeps the
  previous snapshot rather than dropping names.
- Sales: full history once, then from the newest `soldOn` minus a week.
- Account stats: the last few days each sync, a year on first sync.
- Per-domain stats: a slow background rotation (one call per name: hours for
  10,000 names on Afternic, longer on Atom), prioritizing names the user opens
  and names whose account-level numbers moved.

## Bulk writes

`src/core/services/markets/writes.ts` runs every market write in the
market's batch size (`capabilities.writeBatch`) and stores what the market
saved, so the Domains table shows it before the next sync.

- **Afternic, built:** 500 names a call, so a 10,000-name push is 20 calls.
  That runs directly in the request (the desktop app, or the Worker, where
  waiting on the network doesn't count against its CPU time), and returns
  one result per name.
- **Atom, built:** one name a call, so a large push takes hours. More than
  10 names on such a market (`writeBatch` 1) run as a **market job** in
  DomBot's bulk runner (`src/core/services/bulk-jobs.ts`, "Market jobs"):
  one lane per market account, persisted, a name at a time per account
  about a second apart (the market's rate, when it publishes one). Names
  whose synced listing already has the asked values are skipped without a
  call. A rate-limited name goes back in the queue (up to three times);
  every other outcome is final, since a write is never retried. It's a job
  of its own beside the registrar job, so an hours-long push doesn't hold
  up registrar bulk operations, and unlike a registrar job it resumes after
  a restart (a name that was mid-request is recorded as unknown, not
  re-sent). The Domains table's List and Delist dialog follows it with
  progress and a Stop button; MCP's `market_listings_set` and
  `market_listings_delete` return `{ job }`, and `market_job_get` reads it.
  The web host's Worker can't hold the loop, so each progress read runs it
  for a few seconds.
- Afternic's CSV jobs (`runJob`) stay available for pushes past what the
  `$each` calls handle comfortably; nothing uses them yet.
- **Sedo, built:** 50 names a call, the same direct path.
- Writes that cost money (`capabilities.spends`) need a confirmed total first.

## Domains table and actions

- **A listing column per connected market** (Afternic, Atom, Sedo, …), in the slot
  saved layouts call `listing`, so a name listed on two markets stays on one
  line: the market's price (or "Offers") right-aligned in grey, and one
  status icon at the left: a soft check when live at your DomBot price, an
  amber circled arrow up or down when the market's price is above or below
  it, an eye-slash for visibility you control (inactive or hidden), a grey
  clock for what the market will change (pending, on hold), a red warning
  when rejected, and a grey icon when sold or unknown. A price that isn't
  live is faded. The tooltip has
  the detail. A name can only be in one account per market, so each cell holds
  one listing.
- **A click on a listing cell edits that listing** on that market (or lists
  the name there, starting from its DomBot asking price). The editor shows
  only the fields the market has, read from its capabilities: a Buy Now
  price (empty for offers only), then Afternic's minimum offer, floor and
  lease-to-own (on or off, and the most monthly payments: 3, 6, 9, 12, then
  every 6 to 60, each showing its payment; a new listing starts from the
  account's own defaults, which Afternic doesn't apply to API listings); Sedo's currency and minimum offer; Atom's price alone. Save
  sends only the fields you changed straight to the market
  (`writeMarketListings`), makes a hidden listing visible (there's no "not
  for sale" mode in the app), re-runs a stuck listing's checks where the
  market can, and Delist takes it down. Pricing stays DomBot's own asking price; this edits what the market
  has.
- **The Markets filter** (the Markets tab's icon, after Pricing in Add
  filter): the markets in play (all to start), then a listing's status
  (Active, Pending or on hold, Inactive or hidden, Rejected, or Not listed),
  its price against your DomBot price (above, below, at), and a range on its
  price. Each condition applies to one listing at a time; a name matches
  when any market in play has a listing meeting all of them, or has none
  while Not listed is picked (`src/shared/market-filter.ts`). The markets in
  play keep their columns on screen while it's set.
- **List at your price** pushes DomBot's asking prices to every market account
  you tick (all of them to start), one account after another, with results
  grouped by market. A listing that was inactive, rejected or stuck pending
  also gets the market's checks re-run (`relist`), so there's no separate
  Relist action in the app; `market_listings_relist` stays for agents.
- **Delist** ticks accounts the same way, starting from those that list the
  names.
- Both sit directly beside Pricing in the row menu and the bulk bar; a
  Markets submenu returns when these menus are split into submenus.

- **Views, Leads and Searches over 12 months** (hidden at first; the
  Columns picker shows them), sortable, Leads breaking ties on Views: the
  names buyers look at most. Views and leads add every market up
  (`getMarketTraffic().domains`); Searches are GoDaddy's, sent only to
  Discount Domain Club Domain Pro members, as its header's note says.
- **Summary cards** above the Owned table, once a market account is
  connected or any sale exists (hidden on phones): Listed (sets the Markets
  filter), Sold and Net over 12 months (open the Sales tab; every sale, not
  only market ones), Views over 30 days. Domains reads the Markets and
  Pricing filters from its URL (`src/renderer/lib/domains-link.ts`), so other
  pages link to a filtered table.

## Sales tab

The Sales tab replaced the Markets page (docs/sales-tab.md); `/markets`
redirects to it. It reads sale records (`src/shared/sales.ts`), one per
sale from every source:

- `sold` events, yours, imported, or market sync's; market sales joined
  through the event's `marketSale` for commission, net, payout and the
  next step; and market sales no event records yet (under way, cancelled,
  or ones sync left unrecorded, like a sale before a buyback).
- The acquisition (`registered` or `purchased`) before each sale for cost
  and holding period, so a buyback starts a new holding. Drops, archives
  and Owned / Archive labels play no part.
- A recent sale of a name an account still holds is a sale awaiting
  transfer, not an error.
- Fees on a sale you record (the sale dialog, `domain_sale_set`): blank is
  unknown, 0 none. Net is price less fees, or the market's net. A cost
  counts only in the sale's currency; amounts are never converted or added
  across currencies, and partial totals say how many sales they cover.

**Overview:** Needs attention (sales waiting on you, with Send auth code;
rejected listings and ones pending over a week; prices below yours; past
three names, a grouped row into Domains with the Markets filter set; priced
names not listed on each market), the year's sold, gross, net and average,
sell-through over 12 months, views over 30 days, and sales by month. The
bell's sale alert links here.

**Sales:** one row per sale, under way first; filters on the sale date
(a bounded range leaves undated sales out and says how many), where and
currency; totals by year, market, TLD or registrar; CSV export; a row menu
for the name's history, Edit sale (that sale, even an earlier one) and the
market.

Sell-through is `sellThrough` (`src/shared/market-reports.ts`) over every
sale: names sold in 12 months over names listed now plus those sold.

## Settings → Markets

As in the Afternic plan, generalized: one card per market account, built
from the adapter's `configFields` and `test()`, with the same ⋯ menu as
registrar cards. An opened card has two parts, so it's clear what lives where:

- **Your <market> account:** what the market holds, read through its API.
  What the account has shows read-only (`MarketSyncState.status`, such as
  Afternic's Discount Domain Club Domain Pro, which decides whether search
  counts come back; sync keeps it current). Account settings, where the
  market has them (`accountSettings`), are editable and saved back to the
  market: Afternic's lander (Buy Now, price request or custom) and
  Lease To Own defaults (enable or disable installments, Maximum Lease
  Period with Afternic's commission discount for each length), saved together with one Save as a partial
  update (`setMarketListingDefaults`).
- **In DomBot:** how DomBot connects: the credentials (encrypted, never sent
  anywhere but the market), DomBot's sync notes, and market-specific help
  such as Sedo's partner-access note and Atom's API-access note.

The demo connects one account on each market over an in-memory world
(`src/core/demo/markets.ts`), with listings, a year of traffic, sales, and a
sale waiting on an auth code.

## Ownership verification

**Planned, not built.** Every market checks that you own a name before its
listing goes live or for sale, and the APIs mostly don't report it or offer a
way to complete it. Afternic keeps a listing `PENDING` until the name points
at its nameservers. Sedo lists a new name not for sale, refuses to change
that (`E3124`), and shows it under "Ownership Verification Pending" on
sedo.com (seen live, docs/sedo-api.md). Atom checks DNS "at random
intervals" unless asked to check now.

### The four ways markets verify

Most markets accept two or three of these:

| Method                  | What you set                                            | Example                                                            |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| Default nameservers     | The name's nameservers, to the market's shared pair     | `ns1/ns2.afternic.com`, `ns1/ns2.sedoparking.com`                  |
| Per-customer nameserver | One of the name's nameservers, assigned to you          | Afternic: an extra NS `verification-<ID>.ns101.verify.hn`          |
| TXT record              | A TXT record holding a verification ID from the market  | Afternic: `afternic-verification-<ID>`; Sedo: the bare ID          |
| CNAME record            | A CNAME from the verification ID to the market's target | Sedo: host `<verification ID>`, value `verify.sedo.com.`, TTL 3600 |

Afternic and Sedo each give one verification ID per account, shown only in
their dashboards: neither API returns it (Afternic's account settings are
lander, intake style, lease-to-own, lander options and self-broker, checked
against its OpenAPI spec), so the user copies it into DomBot. Afternic's
nameserver is added as a third (NS3) beside the name's own pair, so the name
keeps its DNS host.

What each costs:

- **Nameservers** hand the name's DNS to the market, which then serves its
  lander or parked page. That ends whatever the name did before: a website,
  or email (domainio.com, for one, forwards mail through ImprovMX). Some
  features need it anyway: Afternic's lander and Fast Transfer, Atom
  Premium.
- **Shared nameservers don't prove ownership on their own.** Anyone can
  point a name at a market's shared pair, so for a name another account
  already lists, only per-customer nameservers, a TXT record or a CNAME
  settle it. Seen with domanio.com on Sedo (2026-10-28): pointing it at
  `ns1/ns2.sedoparking.com` left it in the other account, and DomBot moved
  it back to 101domain's nameservers to add Sedo's TXT ID instead.
- **TXT and CNAME** leave DNS where it is and add one record. They need the
  name's DNS hosted at a registrar account DomBot is connected to, and every
  existing record kept: registrar DNS APIs mostly replace the whole record
  set, so DomBot reads, adds and writes back (done by hand on domainio.com,
  2026-10-28: Sedo's TXT ID added beside its A, MX and SPF records). A
  registrar or DNS host only manages records while the name uses its
  nameservers (101domain says `NAMESERVERS_NOT_LOCAL`), so a name pointed at
  a market's nameservers has to move back before it can take a TXT or
  CNAME record.

### What DomBot will need

- **Settings, per market account** (stored on the `market-accounts` record;
  they aren't secrets): the verification ID (used by both TXT and CNAME), any
  custom nameservers assigned to you, and which method you prefer.
- **Capabilities, per market:** which methods it accepts, its default
  nameservers and CNAME target, and whether it has a "check now" call (Atom's
  verify DNS). Each market already declares its nameservers next to its
  client (`src/core/markets/<market>/nameservers.ts`), published in the
  catalog as `MarketInfo.nameservers`; the Nameservers filter groups by
  them, and `defaultMarketNameservers` gives the pair to point a name at. A
  market that assigns nameservers per customer can list them as a pattern
  (`*.ns.example.com`), or through the account later. Settings shows only the fields a market's methods need.
  Atom's check-now allows one request per account every 12 hours, for any
  name (seen live, docs/atom-api.md): the action should apply DNS to every
  selected name first and ask once, not once per name.
- **A "Verify ownership" action** for selected names on an account, in the
  Domains table and as an MCP tool (`domain_listing_verify`, generalized from
  Atom's). For each name, it applies the chosen method through the registrar
  account that holds it (nameservers via the registrar, TXT or CNAME via a
  DNS read-merge-write), asks the market to check now when it can, and
  reports per name: done, DNS not hosted at the registrar, registrar not
  connected, or the registrar has no DNS API. Changing nameservers asks first
  and says what the name will stop doing.
- **Maybe a per-account preference to verify on list,** off by default,
  since it changes DNS. With it on, listing a name also runs the action.
- **Status:** a name stays `pending` until the market puts it up for sale
  (already the case for Sedo, `asyncInsert`), and the account card says how
  many are waiting.

Open: whether a TXT or CNAME record can be removed once a market has
verified a name, and how each market reports a failed check.

## MCP

The tool list, for all markets (naming as docs/mcp-tools.md). A tool or
parameter a market can't support fails with "not supported for <market>",
from its capabilities, never empty data.

Accounts: `market_list`, `market_test`, `market_sync`, `market_set_enabled`.

Listings:

- `market_listings`: query synced listings across accounts (status, forSale,
  price ranges, tier, discount, offers, searches, …).
- `domain_listing_get`, `domain_listing_set`, `domain_listing_delete`.
- `market_listings_set` (explicit changes, or `fromAskingPrice` to push
  DomBot's prices), `market_listings_delete`: any number of names, one
  result per name.
- `portfolio_query` gains `listedOn` / `notListedOn`.

Sales and stats: `market_sales`, `market_sale_get`, `market_stats_get`,
`domain_stats_get`.

Market-only actions, each with a `market` parameter and gated by a
capability:

| Tool                           | Capability                            | Market     |
| ------------------------------ | ------------------------------------- | ---------- |
| `market_sale_auth_code_set`    | `saleAuthCode`                        | Afternic   |
| `market_sale_message_send`     | `saleMessages`                        | Afternic   |
| `market_settings_get`/`_set`   | `accountSettings`                     | Afternic   |
| `market_listings_relist`       | `relist`                              | Afternic   |
| `domain_listing_discount_set`  | `discount`                            | Atom       |
| `domain_listing_verify`        | (planned, see Ownership verification) | All        |
| `domain_listing_boost`         | `spends`                              | Atom       |
| `market_grading_submit`/`_get` | —                                     | Atom       |
| `domain_appraisal_get`         | —                                     | Atom       |
| `market_categories_get`        | —                                     | Atom, Sedo |
| `market_payments_get`          | `parkingEarnings`                     | Sedo       |

Anything that spends money takes `confirmSpend: true`; anything that reaches
a person (a sale message) says so in its description.

## Order of work

1. **Shared types and the Afternic adapter** (done) (`src/core/markets/types.ts`,
   `src/core/services/markets/afternic.ts`), with unit tests mapping the
   Afternic fixtures.
2. **Afternic phase 4 on top of them** (done): storage namespaces, sync,
   Settings → Markets, listing columns and the listing filter, `sold`
   events, read-only MCP tools.
3. **Afternic phases 5–6** (done): writes, reporting.
4. **Atom and Sedo** (done): client, adapter, then their capability-gated
   extras, built from their docs and verified live once credentials arrived
   (2026-10-28). Atom's API access needs approval and 500+ listings; Sedo
   needs a partner ID and sign key. Atom also brought market bulk jobs (see "Bulk writes"). Status and
   what's left: atom-api.md, "Status"; sedo-api.md.
5. **Ownership verification** for every market: planned above, not built.

## Open questions

1. Market rate limits for Atom and Sedo are unpublished. Atom drew no
   throttling at about 300 calls a minute, and its client paces at 120; its
   DNS check is limited to one per account every 12 hours. Sedo's default
   (60 a minute) is a guess until throttling shows or Sedo says.
