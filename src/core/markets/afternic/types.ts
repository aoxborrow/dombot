import type { RegistrarName } from '@aoxborrow/registrar-client';
import type {
  CancelReason,
  DomainInclude,
  DomainOrder,
  FastTransferStatus,
  IntakeStyle,
  LandingPage,
  ListStatus,
  SaleOrder,
  SaleStatus,
  SaleType,
} from './wire';

export type {
  CancelReason,
  DomainInclude,
  DomainOrder,
  FastTransferStatus,
  IntakeStyle,
  LandingPage,
  ListStatus,
  SaleOrder,
  SaleStatus,
  SaleType,
};

// What the client returns. Prices are dollars, never microunits: listing
// prices as whole-dollar numbers (the API allows nothing else), sale amounts
// as canonical decimal strings because a lease total can carry cents.
// Other fields keep the API's names and enums so they're easy to trace back
// to the docs.

/** Rolling search counts on GoDaddy (Discount Domain Club Domain Pro only). */
export interface SearchCounts {
  days30: number | null;
  days90: number | null;
  days365: number | null;
}

export interface AfternicListing {
  /** ASCII (punycode) lowercase name, the key everywhere. */
  name: string;
  /** Mixed case or Unicode form shown on the lander. */
  displayName: string;
  /** Buy Now price; null when unset (the API's 0). */
  buyNow: number | null;
  /** Minimum offer; the API's floor for it is $20. */
  minOffer: number | null;
  /** Lowest price auto-accepted; null when unset (the API's 0). */
  floor: number | null;
  leasingEnabled: boolean;
  /** Most monthly payments a lease-to-own buyer can choose (2–60). */
  maxLeasePeriod: number | null;
  landingPage: LandingPage | null;
  intakeStyle: IntakeStyle | null;
  showLanderBuynowOption: boolean;
  showLanderMakeOfferOption: boolean;
  showLanderLeaseToOwnOption: boolean;
  featured: boolean | null;
  hidden: boolean;
  listStatus: ListStatus;
  /** ISO 8601, when Afternic created the listing. */
  createdAt: string;
  /** ISO 8601, the listing's last change (yours or Afternic's). */
  updatedAt: string;
  /** Afternic's registrar text as sent ("Dynadot, LLC", "UNKNOWN"). */
  registrarRaw: string | null;
  /** That registrar as a registrar-client name, when we recognize it. */
  registrar: RegistrarName | null;
  fastTransferStatus: FastTransferStatus | null;
  /** Null when not sent, which is the usual answer for a name with none. */
  offerCount: number | null;
  /** Null when the account doesn't get search data. */
  searches: { total: SearchCounts; unique: SearchCounts } | null;
}

export interface ListingsPage {
  listings: AfternicListing[];
  /** Matches across all pages, from the API's pagination. */
  total: number | null;
}

export interface ListListingsOptions {
  /** Defaults to every include, so a listing is complete. */
  includes?: readonly DomainInclude[];
  limit?: number;
  offset?: number;
  order?: DomainOrder;
  listStatus?: readonly ListStatus[];
  /** Price filters in whole dollars. */
  buyNowMin?: number;
  buyNowMax?: number;
  floorMin?: number;
  floorMax?: number;
  minOfferMin?: number;
  minOfferMax?: number;
  leasing?: boolean;
  hidden?: boolean;
  listedFrom?: Date | string;
  listedTo?: Date | string;
}

export interface AllListingsResult {
  listings: AfternicListing[];
  /**
   * The total changed while paging, so a listing may be missing or doubled:
   * re-run if it matters.
   */
  changedDuringRead: boolean;
}

export interface DailyStats {
  /** YYYY-MM-DD (UTC). */
  date: string;
  views: number;
  leads: number;
}

export interface StatsOptions {
  /** 1–365. Defaults to 30. */
  days?: number;
  /** The last day of the window. Defaults to now. */
  endDate?: Date | string;
}

export interface AfternicSale {
  transactionId: string;
  name: string;
  saleType: SaleType | null;
  status: SaleStatus | null;
  cancelReason: CancelReason | null;
  /** Decimal dollars ("4250", "1479.09"). */
  salePrice: string | null;
  /** Including tax; not sent for leases. */
  saleTotal: string | null;
  /** Afternic's commission, decimal dollars. */
  commission: string | null;
  /** salePrice − commission, when both are known. */
  net: string | null;
  /** ISO 8601. */
  soldAt: string | null;
  /** ISO 8601, when the payout went out. */
  disbursedAt: string | null;
  /** The transfer code you supplied. Sensitive: don't store it. */
  authCode: string | null;
  lease: {
    installmentAmount: string | null;
    totalInstallments: number | null;
    totalInstallmentsPaid: number | null;
    /** YYYY-MM-DD. */
    prevInstallmentDate: string | null;
    nextInstallmentDate: string | null;
  } | null;
}

export interface ListSalesOptions {
  /** Earliest sale. With neither from nor to, the API returns the last month. */
  from?: Date | string;
  to?: Date | string;
  status?: SaleStatus;
  keyword?: string;
  order?: SaleOrder;
  /** 1–100. */
  limit?: number;
  offset?: number;
}

export interface SalesPage {
  sales: AfternicSale[];
  total: number | null;
}

export interface AfternicAccountSettings {
  landingPage: LandingPage | null;
  intakeStyle: IntakeStyle | null;
  leasingEnabled: boolean | null;
  maxLeasePeriod: number | null;
  showLanderBuynowOption: boolean | null;
  showLanderMakeOfferOption: boolean | null;
  showLanderLeaseToOwnOption: boolean | null;
  selfBrokerEnabled: boolean | null;
}

// Writes

export type RelistMode = 'RESYNC' | 'REACTIVATE';

/**
 * Listing settings to write. Omitted fields are left as they are on an update
 * and take Afternic's account defaults on a create. Prices are whole dollars;
 * `null` clears Buy Now or floor (the API's 0).
 */
export interface ListingFields {
  displayName?: string;
  buyNow?: number | null;
  /** At least $20, Afternic's minimum. */
  minOffer?: number;
  floor?: number | null;
  leasingEnabled?: boolean;
  /** 2–60. */
  maxLeasePeriod?: number;
  landingPage?: LandingPage;
  intakeStyle?: IntakeStyle;
  showLanderBuynowOption?: boolean;
  showLanderMakeOfferOption?: boolean;
  showLanderLeaseToOwnOption?: boolean;
  featured?: boolean;
  hidden?: boolean;
}

export interface ListingInput extends ListingFields {
  name: string;
}

/** What happened to one name in a bulk call. */
export interface ListingResult {
  name: string;
  ok: boolean;
  /** The per-name HTTP status Afternic reported (or the whole call's). */
  status: number;
  /** The listing as saved, when Afternic sent it back (upserts do). */
  listing: AfternicListing | null;
  error: { code: string; message: string } | null;
}

export type AccountSettingsInput = Partial<{
  [K in keyof AfternicAccountSettings]: NonNullable<AfternicAccountSettings[K]>;
}>;

// Bulk jobs

export type JobType = 'BULK_JOB' | 'RECONCILE_JOB';
export type JobState =
  | 'CREATED'
  | 'DATA_UPLOADED'
  | 'CLOSED'
  | 'RUNNING'
  | 'FAILED'
  | 'COMPLETED'
  | 'CANCELED';

export interface AfternicJob {
  jobId: string;
  type: JobType;
  state: JobState;
  description: string | null;
  /** 0–100, once it's running. */
  percentComplete: number | null;
  totalRequests: number | null;
  totalSuccess: number | null;
  totalFailures: number | null;
  /** Afternic's reason when `state` is `FAILED`. */
  failedReason: string | null;
  /** ISO 8601. */
  createdAt: string;
  completedAt: string | null;
}

/** One row of a job's results file. */
export interface JobRowResult {
  name: string;
  /** `UPDATE_OR_ADD` for a bulk job. */
  operation: string;
  /** `UPDATE_PROCESSED`, `NO_CHANGE`, `FAILED`, … */
  result: string;
  ok: boolean;
  error: string | null;
}

export interface RunJobOptions {
  /** Shown in Afternic's job list. Up to 255 characters. */
  description?: string;
  /** How often to check on it. Defaults to 2 seconds. */
  pollMs?: number;
  /** Give up waiting (the job keeps running). Defaults to 30 minutes. */
  timeoutMs?: number;
  onProgress?: (job: AfternicJob) => void;
}

export interface JobRun {
  job: AfternicJob;
  /** One per listing given, in order; a name missing from the file is failed. */
  results: ListingResult[];
}
