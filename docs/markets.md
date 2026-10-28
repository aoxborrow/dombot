# Markets

How DomBot works with domain marketplaces: the shared model that Afternic,
Atom and Sedo map into, and what DomBot builds on it (storage, sync, Settings,
bulk writes, MCP). Each market's own API, quirks and client are in its plan:

- [afternic-api.md](afternic-api.md): client built
  (`src/core/markets/afternic/`), verified live.
- [atom-api.md](atom-api.md): plan only; no API key yet.
- [sedo-api.md](sedo-api.md): client and adapter built from the docs
  (`src/core/markets/sedo/`, `src/core/services/markets/sedo.ts`),
  unverified; live checks wait on Sedo partner access.

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

**Build the shared layer before Afternic's DomBot work, not after.** Phase 4
of the Afternic plan writes stored records (`market-*` namespaces, `sold`
events) and MCP tool schemas. Stored values don't change once written
without a migration, and MCP tools are a public interface. Built
Afternic-shaped first, both would need reworking when Atom or Sedo arrives;
built on these types, the next market adds an adapter and some capability
flags. (Sedo's plan suggested extracting the shared types after phase 4, from
working code; with three plans in hand the overlap is clear enough now.)

## Shared types

`src/core/markets/types.ts`. A sketch; names may shift when it's written.

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
  buyNow?: boolean;
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
  outright, with no negotiation. Atom: always. Sedo: `fixedprice`. Afternic:
  whenever a Buy Now price is set. The lander doesn't change that; it only
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
  exists for that sale. That needs the event to carry which sale it came from:
  add `marketSale?: string` (the `market-sales` key) to `DomainEvent`. A user's
  own `sold` event for the same name and day is matched and linked rather than
  duplicated. Commission and net stay on the sale record; reports join them.
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
- **Atom, later:** one name a call, so a large push takes hours. That's when
  market accounts join DomBot's bulk runner
  (`src/core/services/bulk-jobs.ts`) as lanes next to registrars: persisted,
  resumable after a restart, progress per name. `market_listings_set` then
  returns a bulk job for markets with a small `writeBatch`, and a
  `market_job_get` tool reads it.
- Afternic's CSV jobs (`runJob`) stay available for pushes past what the
  `$each` calls handle comfortably; nothing uses them yet.
- Writes that cost money (`capabilities.spends`) need a confirmed total first.

## Settings → Markets

As in the Afternic plan, generalized: one card per market account, built from
the adapter's `configFields` and `test()`, with the same ⋯ menu as registrar
cards. Market-specific rows come from capabilities: listing defaults where
`accountSettings`, a rate-limit field where `rateLimit` is null, the
partner-access note for Sedo, the API-beta note for Atom.

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

| Tool                           | Capability        | Market     |
| ------------------------------ | ----------------- | ---------- |
| `market_sale_auth_code_set`    | `saleAuthCode`    | Afternic   |
| `market_sale_message_send`     | `saleMessages`    | Afternic   |
| `market_settings_get`/`_set`   | `accountSettings` | Afternic   |
| `market_listings_relist`       | `relist`          | Afternic   |
| `domain_listing_discount_set`  | `discount`        | Atom       |
| `domain_listing_verify`        | `verifyDns`       | Atom       |
| `domain_listing_boost`         | `spends`          | Atom       |
| `market_grading_submit`/`_get` | —                 | Atom       |
| `domain_appraisal_get`         | —                 | Atom       |
| `market_categories_get`        | —                 | Atom, Sedo |
| `market_payments_get`          | `parkingEarnings` | Sedo       |

Anything that spends money takes `confirmSpend: true`; anything that reaches
a person (a sale message) says so in its description.

## Order of work

1. **Shared types and the Afternic adapter** (done) (`src/core/markets/types.ts`,
   `src/core/services/markets/afternic.ts`), with unit tests mapping the
   Afternic fixtures.
2. **Afternic phase 4 on top of them** (done): storage namespaces, sync,
   Settings → Markets, listing columns and the Listing filter, `sold`
   events, read-only MCP tools.
3. **Afternic phases 5–6:** writes through the bulk runner, reporting.
4. **Atom and Sedo** when there are credentials: client, then an adapter, then
   their capability-gated extras. Atom's API access needs approval and 500+
   listings; Sedo needs a partner ID and sign key. Sedo was built ahead of
   its credentials from the docs (unverified; docs/sedo-api.md lists what to
   check first).

## Open questions

1. The `marketSale` link on `DomainEvent`: confirm it against
   docs/storage-model.md's rules before phase 4 writes the first event.
2. Do Atom and Sedo report errors with HTTP 200 for every failure? Both plans
   suspect so; adapters must check bodies either way.
3. Market rate limits for Atom and Sedo are unpublished; the defaults (60 a
   minute, one a second) are guesses until 429s or the markets say.
