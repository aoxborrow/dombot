import type { CurrencyCode } from './currencies';
import type { RegistrarConfigField } from './ipc';

// The shared market model (docs/markets.md). Each market's client speaks its
// own API in its own types; an adapter per market
// (src/core/services/markets/<market>.ts) maps it into these. Everything
// else in DomBot, the renderer included, sees only these types and a
// market's capabilities.

/** Afternic's lander and Fast Transfer values, as its API spells them. */
export type AfternicLandingPage = 'PARKING_TYPE' | 'SALES_TYPE';
export type AfternicIntakeStyle = 'BUYNOW' | 'PRICE_FORM' | 'CUSTOM_LANDER';
export type AfternicFastTransferStatus =
  | 'ACTIVE'
  | 'AWAITING_OPT_IN'
  | 'INACTIVE'
  | 'INACTIVE_BUYNOW_HIGH'
  | 'INACTIVE_BUYNOW_MISSING'
  | 'INELIGIBLE_REGISTRAR'
  | 'INELIGIBLE_TLD'
  | 'PENDING_REVIEW'
  | 'USER_EXCLUDED'
  | 'UNKNOWN';

export type MarketId = 'afternic' | 'atom' | 'sedo';

/** A canonical decimal string, as DomBot's ListPrice ("2500", "1479.09"). */
export type Amount = string;

export type ListingStatus =
  /** Live and for sale. */
  | 'active'
  /** Accepted, not live yet (verification, review, an async insert). */
  | 'pending'
  /** Listed but not live (needs DNS, deactivated). */
  | 'inactive'
  /** The market refused it. */
  | 'rejected'
  /** Mid-sale or locked. */
  | 'on_hold'
  | 'sold'
  | 'unknown';

export interface MarketListing {
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
  /** Buyers can buy outright at `price`; false: an asking price. */
  buyNow: boolean;
  minOffer: Amount | null;
  /** Lowest price auto-accepted; never shown to buyers. */
  floor: Amount | null;
  /** A temporary reduction (Atom: until Monday). */
  discount: { amount: Amount; until: string | null } | null;
  currency: CurrencyCode;
  leaseToOwn: { enabled: boolean; maxPayments: number | null } | null;
  /** A listing tier (Atom: standard, plus, premium, geo). */
  tier: string | null;
  /** ISO 8601. */
  listedAt: string | null;
  updatedAt: string | null;
  extra: MarketExtra;
}

/** Rolling search counts on GoDaddy. */
export interface SearchCounts {
  days30: number | null;
  days90: number | null;
  days365: number | null;
}

export interface AfternicExtra {
  market: 'afternic';
  landingPage: AfternicLandingPage | null;
  intakeStyle: AfternicIntakeStyle | null;
  showLanderBuynowOption: boolean;
  showLanderMakeOfferOption: boolean;
  showLanderLeaseToOwnOption: boolean;
  featured: boolean | null;
  fastTransferStatus: AfternicFastTransferStatus | null;
  /** The registrar Afternic sees, as a registrar-client name. */
  registrar: string | null;
  registrarRaw: string | null;
  offerCount: number | null;
  /** Discount Domain Club Domain Pro accounts only. */
  searches: { total: SearchCounts; unique: SearchCounts } | null;
}

export interface SedoExtra {
  market: 'sedo';
  /** Up to three Sedo category ids. */
  categories: number[];
  /** ISO 639-1 language of the name. */
  language: string | null;
  /** Lifetime parking earnings. UNVERIFIED: in which currency. */
  parkingEarnings: Amount | null;
  /** The name's master keywords for parking. */
  keywords: string[];
}

export interface AtomExtra {
  market: 'atom';
  /** Atom's listing id, when it sends one. */
  id: string | null;
  /** The primary (industry) category. */
  category: string | null;
  description: string | null;
  /**
   * Premium only: Atom allows this name on other marketplaces too. Null for
   * other tiers, or when the syndication list couldn't be read.
   */
  syndicationAuthorized: boolean | null;
}

export type MarketExtra = AfternicExtra | AtomExtra | SedoExtra;

/** A listing's GoDaddy search counts, when its market sends them. */
export function searchesOf(l: MarketListing): AfternicExtra['searches'] | null {
  return l.extra.market === 'afternic' ? l.extra.searches : null;
}

/** A listing's Afternic Fast Transfer status, if it's on Afternic. */
export function fastTransferOf(
  l: MarketListing,
): AfternicFastTransferStatus | null {
  return l.extra.market === 'afternic' ? l.extra.fastTransferStatus : null;
}

export interface AfternicExtraChange {
  market: 'afternic';
  landingPage?: AfternicLandingPage;
  intakeStyle?: AfternicIntakeStyle;
  showLanderBuynowOption?: boolean;
  showLanderMakeOfferOption?: boolean;
  showLanderLeaseToOwnOption?: boolean;
  featured?: boolean;
}

export interface SedoExtraChange {
  market: 'sedo';
  /** Up to three Sedo category ids (market_categories_get lists them). */
  categories?: number[];
  /** ISO 639-1; Sedo needs one to list a name. */
  language?: string;
}

export interface AtomExtraChange {
  market: 'atom';
  /** The tier for a new listing; DomBot never adds Premium. */
  tier?: 'standard' | 'plus';
  /** A primary category by name (market_categories_get lists them). */
  category?: string;
  description?: string;
}

export type MarketExtraChange =
  AfternicExtraChange | AtomExtraChange | SedoExtraChange;

/** A change to one listing. Only the fields given are changed. */
export interface MarketListingChange {
  name: string;
  displayName?: string;
  price?: Amount | null;
  buyNow?: boolean;
  minOffer?: Amount | null;
  floor?: Amount | null;
  currency?: CurrencyCode;
  forSale?: boolean;
  leaseToOwn?: { enabled: boolean; maxPayments?: number };
  extra?: MarketExtraChange;
}

export interface MarketWriteResult {
  name: string;
  ok: boolean;
  /** Accepted but not live yet. */
  pending: boolean;
  /** The listing as saved, when the market said or a read-back showed it. */
  saved: MarketListing | null;
  /** Fields the market saved differently from what was asked. */
  adjusted: { field: string; asked: unknown; saved: unknown }[];
  error: { code: string; message: string } | null;
  /** Nothing was sent: the listing already matched (bulk writes only). */
  unchanged?: boolean;
}

export interface MarketSale {
  market: MarketId;
  accountId: string;
  /** The market's transaction id; with market and account, the record's key. */
  id: string;
  name: string;
  /** YYYY-MM-DD (UTC), the day it sold: the `sold` event's date. */
  soldOn: string | null;
  status: 'in_progress' | 'completed' | 'cancelled' | 'unknown';
  statusRaw: string;
  kind: 'buy_now' | 'offer' | 'lease' | 'unknown';
  price: Amount | null;
  commission: Amount | null;
  /** Derived from the market's published rates when the API doesn't say. */
  commissionEstimated: boolean;
  net: Amount | null;
  currency: CurrencyCode;
  installments: {
    amount: Amount | null;
    paid: number | null;
    total: number | null;
    next: string | null;
  } | null;
  /** YYYY-MM-DD. */
  paidOutOn: string | null;
  /** What the seller has to do next, when the market says. */
  action: 'auth_code' | 'transfer' | 'payee_details' | null;
}

/** One day for one name, or for an account (`name` null). */
export interface MarketStatsDay {
  market: MarketId;
  accountId: string;
  name: string | null;
  /** YYYY-MM-DD. */
  date: string;
  views: number | null;
  leads: number | null;
  clicks: number | null;
  earnings: Amount | null;
  currency: CurrencyCode | null;
  shortlists: number | null;
  trackers: number | null;
  /** 'market': the market's daily figure; 'derived': DomBot's diff of two snapshots. */
  source: 'market' | 'derived';
}

export interface MarketCapabilities {
  currencies: readonly CurrencyCode[];
  minOffer: boolean;
  floor: boolean;
  discount: boolean;
  leaseToOwn: boolean;
  tiers: readonly string[] | null;
  sales: boolean;
  saleAuthCode: boolean;
  saleMessages: boolean;
  accountStats: boolean;
  domainStats: 'daily' | 'snapshot' | null;
  leads: boolean;
  parkingEarnings: boolean;
  /** The market can send search counts (it may still not, per account). */
  searchCounts: boolean;
  accountSettings: boolean;
  relist: boolean;
  verifyDns: boolean;
  asyncInsert: boolean;
  /** Names per write call. */
  writeBatch: number;
  /** A file-based bulk path for very large pushes. */
  jobs: boolean;
  /** Writes that can cost money. */
  spends: boolean;
  /** Requests a minute per account; null when unpublished. */
  rateLimit: number | null;
}

export type MarketConfigField = RegistrarConfigField;

export interface MarketTestResult {
  /** Listings on the account, when the market says. */
  listings: number | null;
  /** Things worth showing on the card ("No search data on this account"). */
  notes: string[];
}

// Accounts (Settings → Markets)

/** A market DomBot supports, for the Settings catalog. */
export interface MarketInfo {
  id: MarketId;
  name: string;
  website: string;
  /** Where the user creates API keys. */
  keysUrl: string;
  /** One or two sentences shown above the credential form. */
  helpText: string;
  configFields: MarketConfigField[];
  capabilities: MarketCapabilities;
}

/** A connected market account, as stored in `market-accounts`. */
export interface MarketAccount {
  id: string;
  market: MarketId;
  /** The account name shown on its card. */
  label: string;
  /** Off: kept, but not synced and not shown. */
  enabled: boolean;
  /** A registrar account whose key this market account uses (Atom, later). */
  registrarAccountId?: string | null;
  createdAt: number;
}

/** What the last sync of a market account found, in `market-last-sync`. */
export interface MarketSyncState {
  /** ms epoch. */
  at: number;
  /** Null when it succeeded. Named like the registrar caches' field so
   *  bundle export scrubs keys out of it. */
  lastError: string | null;
  listings: number;
  sales: number;
  /** The listings read may have missed or doubled names. */
  incomplete: boolean;
  /** Things worth showing on the card. */
  notes: string[];
}

/** A market account with what Settings needs to draw its card. */
export interface MarketAccountView extends MarketAccount {
  /** Credentials are saved. */
  configured: boolean;
  sync: MarketSyncState | null;
}

/** Traffic for reporting: account days and each listed name's totals. */
export interface MarketTraffic {
  /** Daily account stats, every enabled account, oldest first. */
  accountDays: MarketStatsDay[];
  /** By `toAscii` name; only names whose traffic has been fetched. */
  domains: Record<
    string,
    { views30: number; leads30: number; views365: number; leads365: number }
  >;
}

// Bulk market writes (src/core/services/bulk-jobs.ts, "Market jobs")

/** What a market job does to each name. */
export type MarketBulkOp =
  /** Each target's own `change`. */
  | { kind: 'write' }
  /** Make the market's price match DomBot's asking price. */
  | { kind: 'pushAskingPrices' }
  | { kind: 'delete' };

export interface MarketBulkTarget {
  accountId: string;
  /** toAscii(name). */
  name: string;
  /** For `write` jobs. */
  change?: MarketListingChange;
}

export type MarketBulkStatus =
  | 'ok'
  /** Already as asked: nothing was sent. */
  | 'skipped'
  | 'failed'
  | 'unsupported'
  /** Still rate-limited after being put back in the queue. */
  | 'rate-limited'
  | 'cancelled';

export interface MarketBulkResult {
  accountId: string;
  name: string;
  status: MarketBulkStatus;
  /** Empty when it went through. */
  message: string;
  /** The market's or DomBot's error code. */
  code: string | null;
  /** Accepted but not live yet. */
  pending: boolean;
  /** Fields the market saved differently from what was asked. */
  adjusted: MarketWriteResult['adjusted'];
}

/**
 * A bulk write to market accounts, run by the bulk runner one name at a
 * time per account. Persisted, one at a time, separate from registrar bulk
 * jobs so a long push doesn't hold those up. The saved listings go straight
 * into the synced listings; the job keeps only the outcome per name.
 */
export interface MarketBulkJob {
  id: string;
  op: MarketBulkOp;
  status: 'running' | 'done' | 'cancelled';
  total: number;
  /** Results so far, in completion order. */
  results: MarketBulkResult[];
  counts: Record<MarketBulkStatus, number>;
  startedAt: number;
  finishedAt: number | null;
}

export interface MarketBulkStep {
  job: MarketBulkJob;
  /** The earliest time another slice can do work; null once finished. */
  nextAt: number | null;
}
