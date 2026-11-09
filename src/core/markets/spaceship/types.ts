// SellerHub's records as the client hands them over: read from Spaceship's
// JSON (wire.ts), still in SellerHub's own terms. The adapter
// (src/core/services/markets/spaceship.ts) maps them into DomBot's market
// model.

/** A SellerHub listing's status, as the spec lists them. */
export type SellerHubStatus =
  | 'failed'
  | 'verifying'
  | 'onSale'
  | 'onSaleStopped'
  | 'saleProcessing'
  | 'privateSale'
  | 'leaseActive'
  | 'sold';

export interface SellerHubListing {
  /** A-label, lowercase. */
  name: string;
  /** U-label; the same as `name` for an ASCII name. */
  unicodeName: string;
  /** The seller's capitalization, when set. */
  displayName: string | null;
  description: string | null;
  status: SellerHubStatus | null;
  /** SellerHub's word, kept for a status DomBot doesn't know yet. */
  statusRaw: string;
  /** Buy It Now: the amount is kept while the option is off. */
  binPrice: string | null;
  binPriceEnabled: boolean;
  /** Make an Offer with a minimum: the amount is kept while it's off. */
  minPrice: string | null;
  minPriceEnabled: boolean;
}

/** What to send for a new listing or a change; only the fields given go. */
export interface SellerHubListingInput {
  displayName?: string;
  description?: string;
  binPriceEnabled?: boolean;
  binPrice?: string;
  minPriceEnabled?: boolean;
  minPrice?: string;
}

/** One row of the sold report. */
export interface SellerHubSale {
  /** A-label, lowercase. */
  name: string;
  displayName: string | null;
  /** ISO 8601 (UTC); null when SellerHub doesn't have it. */
  saleDateTime: string | null;
  /** Gross: what the buyer paid. */
  salePrice: string | null;
  /** Net: what the seller gets after Spaceship's commission. */
  payout: string | null;
  currency: string;
  /** The channel: `spaceshipSearch`, `forSalePage`, `checkoutLink`, `N/A`, … */
  source: string | null;
}

/** One DNS record of a verification option. */
export interface SellerHubVerificationRecord {
  type: string;
  /** Relative to the name: `@` is the apex. */
  name: string;
  value: string;
}

/** Any one option verifies; every record in it has to be in place. */
export interface SellerHubVerificationOption {
  records: SellerHubVerificationRecord[];
}
