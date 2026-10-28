// The Afternic Portfolio API's JSON, as sent and received (docs/afternic-api.md).
// Nothing outside this folder sees these shapes: the client converts them to
// the types in ./types, where money is dollars rather than microunits.
//
// Field names and enums follow the published OpenAPI spec
// (/docs/portfolio-api/openapi-bundled.yaml), corrected where the live API
// differs (see "Observed" in the doc).

export const LIST_STATUSES = [
  'PENDING',
  'FAILED_COMPLIANCE',
  'ACTIVE',
  'HIDDEN',
  'ON_HOLD',
  'SOLD',
  'INACTIVE',
] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];

export const FAST_TRANSFER_STATUSES = [
  'ACTIVE',
  'AWAITING_OPT_IN',
  'INACTIVE',
  'INACTIVE_BUYNOW_HIGH',
  'INACTIVE_BUYNOW_MISSING',
  'INELIGIBLE_REGISTRAR',
  'INELIGIBLE_TLD',
  'PENDING_REVIEW',
  'USER_EXCLUDED',
  'UNKNOWN',
] as const;
export type FastTransferStatus = (typeof FAST_TRANSFER_STATUSES)[number];

export type LandingPage = 'PARKING_TYPE' | 'SALES_TYPE';
export type IntakeStyle = 'BUYNOW' | 'PRICE_FORM' | 'CUSTOM_LANDER';

/** The optional extras a domain read can ask for. */
export const DOMAIN_INCLUDES = [
  'fastTransferStatus',
  'featured',
  'offerCount',
  'registrar',
  'searches',
] as const;
export type DomainInclude = (typeof DOMAIN_INCLUDES)[number];

export const DOMAIN_ORDERS = [
  'BUYNOW_PRICE_ASC',
  'BUYNOW_PRICE_DESC',
  'CREATED_AT_ASC',
  'CREATED_AT_DESC',
  'NAME_ASC',
  'NAME_DESC',
  'DISPLAY_NAME_ASC',
  'DISPLAY_NAME_DESC',
  'LEADS_ASC',
  'LEADS_DESC',
  'INTAKE_VIEWS_ASC',
  'INTAKE_VIEWS_DESC',
  'FAST_TRANSFER_STATUS_ASC',
  'FAST_TRANSFER_STATUS_DESC',
  'FEATURED_ASC',
  'FEATURED_DESC',
  'FLOOR_PRICE_ASC',
  'FLOOR_PRICE_DESC',
  'INTAKE_STYLE_ASC',
  'INTAKE_STYLE_DESC',
  'LANDING_PAGE_ASC',
  'LANDING_PAGE_DESC',
  'LIST_STATUS_ASC',
  'LIST_STATUS_DESC',
  'MINBID_PRICE_ASC',
  'MINBID_PRICE_DESC',
  'REGISTRAR_ASC',
  'REGISTRAR_DESC',
  'LISTED_AT_ASC',
  'LISTED_AT_DESC',
] as const;
export type DomainOrder = (typeof DOMAIN_ORDERS)[number];

export interface WireSearchCounts {
  '30d'?: number;
  '90d'?: number;
  '365d'?: number;
}

export interface WireDomain {
  name: string;
  displayName?: string;
  buynowPrice?: number;
  floorPrice?: number;
  minbidPrice?: number;
  leasingEnabled?: boolean;
  maxLeasePeriod?: number;
  intakeStyle?: IntakeStyle;
  landingPage?: LandingPage;
  showLanderBuynowOption?: boolean;
  showLanderMakeOfferOption?: boolean;
  showLanderLeaseToOwnOption?: boolean;
  featured?: boolean;
  hidden?: boolean;
  listStatus: ListStatus;
  createdAt: string;
  updatedAt: string;
  // Only with `includes`; any of these may still be missing.
  registrar?: string;
  fastTransferStatus?: FastTransferStatus;
  offerCount?: number;
  searches?: { total?: WireSearchCounts; unique?: WireSearchCounts };
}

export interface WirePagination {
  first?: string;
  last?: string;
  next?: string;
  previous?: string;
  total?: number;
}

export interface WireDomainsPage {
  domains: WireDomain[];
  pagination: WirePagination;
}

/** `$each/get`: the domains found; names not listed are simply absent. */
export interface WireDomainsList {
  domains: WireDomain[];
}

export interface WireStats {
  stats?: { date: string; views: number; leads: number }[];
}

export const SALE_STATUSES = [
  'AWAITING_AUTH_CODE',
  'AWAITING_PAYEE_INFO',
  'AWAITING_PAYEE_UPDATE',
  'AWAITING_TRANSFER_OWNERSHIP',
  'CANCELLED',
  'CANCEL_REQUESTED',
  'COMPLETED',
  'CONFIRMED_TRANSFER',
  'LEASE_FULLY_PAID',
  'PAID_LEASE_INSTALLMENT',
  'PENDING',
  'PENDING_PAYOUT',
  'PENDING_TRANSFER',
  'PENDING_TRANSFER_INSTRUCTIONS',
  'SCHEDULED_PAYOUT',
  'UNKNOWN',
] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export type SaleType = 'BUYNOW' | 'LEASED';

export type CancelReason =
  | 'BUYER_TRANSFER_FAILURE'
  | 'MUTUALLY_CANCELLED'
  | 'RESELLER_CANCELLATION_REQUEST'
  | 'SELLER_TRANSFER_FAILURE'
  | 'SYSTEM_TRANSFER_FAILURE';

export const SALE_ORDERS = [
  'NAME_ASC',
  'NAME_DESC',
  'SALE_PRICE_ASC',
  'SALE_PRICE_DESC',
  'SOLD_AT_ASC',
  'SOLD_AT_DESC',
  'STATUS_ASC',
  'STATUS_DESC',
] as const;
export type SaleOrder = (typeof SALE_ORDERS)[number];

export interface WireSale {
  transactionId: string;
  name: string;
  saleType?: SaleType;
  status?: SaleStatus;
  cancelReason?: CancelReason;
  salePrice?: number;
  saleTotal?: number;
  commission?: number;
  soldAt?: string;
  disbursedAt?: string;
  authCode?: string;
  installmentAmount?: number;
  totalInstallments?: number;
  totalInstallmentsPaid?: number;
  prevInstallmentDate?: string;
  nextInstallmentDate?: string;
}

export interface WireSalesPage {
  sales: WireSale[];
  pagination: WirePagination;
}

export interface WireAccountSettings {
  landingPage?: LandingPage;
  intakeStyle?: IntakeStyle;
  leasingEnabled?: boolean;
  maxLeasePeriod?: number;
  showLanderBuynowOption?: boolean;
  showLanderMakeOfferOption?: boolean;
  showLanderLeaseToOwnOption?: boolean;
  selfBrokerEnabled?: boolean;
}

/** The writable part of a domain, for create, PATCH and upsert. */
export type WireDomainFields = Partial<
  Pick<
    WireDomain,
    | 'displayName'
    | 'buynowPrice'
    | 'floorPrice'
    | 'minbidPrice'
    | 'leasingEnabled'
    | 'maxLeasePeriod'
    | 'intakeStyle'
    | 'landingPage'
    | 'showLanderBuynowOption'
    | 'showLanderMakeOfferOption'
    | 'showLanderLeaseToOwnOption'
    | 'featured'
    | 'hidden'
  >
>;

/** A bulk call's answer: one entry per name, keyed by name. */
export type WireOperationsMap = Record<
  string,
  { code: number; domain?: WireDomain; error?: WireError }
>;

export interface WireError {
  code?: string;
  message?: string;
  details?: string;
  /** The jobs limit error spells it `detail`. */
  detail?: string;
  fields?: { code?: string; message?: string; path?: string }[];
}

// Money. The API counts USD in microunits (1 USD = 1,000,000).

const MICRO = 1_000_000;

/**
 * Microunits as a canonical decimal string ("1479.09", "2500"), exactly:
 * integer math, so no float rounding. Sales can carry cents (lease totals).
 */
export function microToDecimal(micro: number): string {
  if (!Number.isSafeInteger(micro)) {
    throw new Error(`Not a whole microunit amount: ${micro}`);
  }
  const sign = micro < 0 ? '-' : '';
  const abs = Math.abs(micro);
  const whole = Math.floor(abs / MICRO);
  const frac = String(abs % MICRO)
    .padStart(6, '0')
    .replace(/0+$/, '');
  return `${sign}${whole}${frac ? `.${frac}` : ''}`;
}

/** Microunits as whole dollars; listing prices are whole by the API's rules. */
export function microToDollars(micro: number): number {
  if (!Number.isSafeInteger(micro) || micro % MICRO !== 0) {
    throw new Error(`Not a whole-dollar amount: ${micro} microunits`);
  }
  return micro / MICRO;
}

/** Whole dollars as microunits. Throws for cents, negatives and non-numbers. */
export function dollarsToMicro(dollars: number): number {
  if (!Number.isSafeInteger(dollars) || dollars < 0) {
    throw new Error(`Prices are whole dollars: ${dollars}`);
  }
  return dollars * MICRO;
}
