import type { CurrencyCode } from '../../shared/currencies';
import type { RegistrarConfigField } from '../../shared/ipc';
import type {
  FastTransferStatus,
  IntakeStyle,
  LandingPage,
  RelistMode,
} from './afternic/types';

// The shared market model (docs/markets.md). Each market's client speaks its
// own API in its own types; an adapter per market
// (src/core/services/markets/<market>.ts) maps it into these. Everything
// else in DomBot sees only these types and a market's capabilities.

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
  landingPage: LandingPage | null;
  intakeStyle: IntakeStyle | null;
  showLanderBuynowOption: boolean;
  showLanderMakeOfferOption: boolean;
  showLanderLeaseToOwnOption: boolean;
  featured: boolean | null;
  fastTransferStatus: FastTransferStatus | null;
  /** The registrar Afternic sees, as a registrar-client name. */
  registrar: string | null;
  registrarRaw: string | null;
  offerCount: number | null;
  /** Discount Domain Club Domain Pro accounts only. */
  searches: { total: SearchCounts; unique: SearchCounts } | null;
}

// Atom's and Sedo's extras join this union when their adapters exist.
export type MarketExtra = AfternicExtra;

export interface AfternicExtraChange {
  market: 'afternic';
  landingPage?: LandingPage;
  intakeStyle?: IntakeStyle;
  showLanderBuynowOption?: boolean;
  showLanderMakeOfferOption?: boolean;
  showLanderLeaseToOwnOption?: boolean;
  featured?: boolean;
}

export type MarketExtraChange = AfternicExtraChange;

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

export interface MarketAdapter {
  readonly market: MarketId;
  readonly accountId: string;
  readonly capabilities: MarketCapabilities;
  test(): Promise<MarketTestResult>;
  /** `complete` is false when the read may have missed or doubled names. */
  allListings(): Promise<{ listings: MarketListing[]; complete: boolean }>;
  /** Names that aren't listed are left out. */
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

/** Afternic's market-only actions, gated by its capabilities. */
export interface AfternicActions {
  setSaleAuthCode(saleId: string, authCode: string): Promise<void>;
  sendSaleMessage(saleId: string, message: string): Promise<void>;
  relist(
    names: readonly string[],
    mode?: RelistMode,
  ): Promise<MarketWriteResult[]>;
}

/** Thrown for a change a market can't make, before anything is sent. */
export class MarketUnsupportedError extends Error {
  constructor(
    readonly market: MarketId,
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'MarketUnsupportedError';
  }
}
