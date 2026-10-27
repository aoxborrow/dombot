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
