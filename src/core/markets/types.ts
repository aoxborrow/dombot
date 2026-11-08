import type {
  MarketId,
  MarketWriteResult,
  MarketCapabilities,
  MarketListing,
  MarketListingChange,
  MarketSale,
  MarketStatsDay,
  MarketTestResult,
} from '../../shared/markets';
import type {
  AccountSettingsInput,
  AfternicAccountSettings,
  RelistMode,
} from './afternic/types';
import type {
  AtomAppraisal,
  AtomCategory,
  AtomGradeResult,
} from './atom/types';
import type { SedoCategory, SedoLanguage, SedoPayment } from './sedo/types';

// The core side of the shared market model (docs/markets.md): the adapter
// each market implements, and its market-only actions. The data types are
// in src/shared/markets.ts, where the renderer can use them too.

export * from '../../shared/markets';

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
  /** Sales sold from `since` (ever, without it) until `until` (now). */
  allSales?(since?: string, until?: string): Promise<MarketSale[]>;
  /**
   * The day a market's sales history starts, when the market filters sales
   * by date itself. Sync then reads that history a year at a time.
   */
  readonly salesHistoryFrom?: string;
  /** One sale, or null when the market has no such sale. */
  getSale?(saleId: string): Promise<MarketSale | null>;
  accountStats?(days: number): Promise<MarketStatsDay[]>;
  domainStats?(name: string, days: number): Promise<MarketStatsDay[]>;
  /**
   * A name's running totals, for markets whose stats are snapshots
   * (`domainStats: 'snapshot'`): sync diffs two of them into a day's views.
   */
  domainCounters?(name: string): Promise<MarketCounters>;
  /**
   * The account's ownership verification value, for a market whose API
   * gives it (Dynadot's Open Marketplace Key); sync saves it, so there's
   * nothing to paste. Null when the market can't say yet.
   */
  verificationId?(): Promise<string | null>;
  /**
   * For a market that won't take a listing until it has verified that you
   * own the name (Dynadot, for names held elsewhere): send DomBot's pending
   * listings for the names it has verified since. Each result's `saved` is
   * the listing as it stands, listed or still pending.
   */
  listVerified?(
    pending: readonly MarketListing[],
  ): Promise<MarketWriteResult[]>;
}

/** Running totals for one name, as a snapshot market reports them. */
export interface MarketCounters {
  name: string;
  views: number | null;
  shortlists: number | null;
  offers: number | null;
}

/** Afternic's market-only actions, gated by its capabilities. */
export interface AfternicActions {
  setSaleAuthCode(saleId: string, authCode: string): Promise<void>;
  sendSaleMessage(saleId: string, message: string): Promise<void>;
  relist(
    names: readonly string[],
    mode?: RelistMode,
  ): Promise<MarketWriteResult[]>;
  getListingDefaults(): Promise<AfternicAccountSettings>;
  setListingDefaults(settings: AccountSettingsInput): Promise<void>;
}

/** Atom's market-only actions. Each one is one call for one name. */
export interface AtomActions {
  /** Whole dollars off until Monday; null or 0 clears it (UNVERIFIED). */
  setDiscount(name: string, amount: string | null): Promise<MarketWriteResult>;
  /** Ask Atom to check the name's nameservers or TXT record now. */
  verifyDns(name: string): Promise<MarketWriteResult>;
  /** The primary (industry) categories a listing can take. */
  primaryCategories(): Promise<AtomCategory[]>;
  submitForGrading(names: readonly string[]): Promise<{ submitted: number }>;
  gradingResults(options?: {
    page?: number;
    brandFitOnly?: boolean;
  }): Promise<{ results: AtomGradeResult[]; total: number | null }>;
  appraisal(name: string): Promise<AtomAppraisal>;
}

/** Sedo's market-only reads: its listing vocabularies and parking payouts. */
export interface SedoActions {
  categories(): Promise<SedoCategory[]>;
  languages(): Promise<SedoLanguage[]>;
  /** Parking payouts for the month containing `month` (YYYY-MM-DD). */
  parkingPayments(month: string): Promise<SedoPayment[]>;
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
