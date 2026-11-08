import type { CurrencyCode } from '../../../shared/currencies';
import type { Amount } from '../../../shared/markets';

// What the Dynadot client returns: Dynadot's marketplace in its own terms,
// with dates as ISO strings and prices as decimal strings.

/**
 * The currencies Dynadot lists in: the 32 its reference names, less BTC
 * and the withdrawn LTL, which DomBot doesn't have. One account took 14 of
 * them (USD, EUR, GBP, CAD, AUD, CNY, HKD, BRL, INR, MXN, IDR, THB, PHP,
 * KRW) and answered "The value for parameter currency is invalid" for the
 * rest (domanio.com, 2026-11-07); whether that's the account's doing isn't
 * known, so DomBot offers them all and passes the refusal on. Reads
 * convert to any of the 32.
 */
// prettier-ignore
export const DYNADOT_CURRENCIES = [
  'USD', 'GBP', 'EUR', 'INR', 'PLN', 'ZAR', 'CNY', 'CAD', 'JPY', 'NZD',
  'RUB', 'AUD', 'MXN', 'BRL', 'IDR', 'ARS', 'COP', 'DKK', 'RSD', 'HKD',
  'CHF', 'AED', 'MYR', 'NGN', 'KES', 'CZK', 'NOK', 'THB', 'PHP', 'KRW',
] as const satisfies readonly CurrencyCode[];

export type DynadotCurrency = (typeof DYNADOT_CURRENCIES)[number];

export function isDynadotCurrency(value: unknown): value is DynadotCurrency {
  return (
    typeof value === 'string' &&
    (DYNADOT_CURRENCIES as readonly string[]).includes(value)
  );
}

/** Buy Now, Make Offer, or both (`BIN`, `MAKE_OFFER`, `BIN_MAKE_OFFER`). */
export type DynadotListingType = 'bin' | 'make_offer' | 'bin_make_offer';

export interface DynadotAccountInfo {
  username: string | null;
  /** "Regular Account", "Bulk Account" or "Super Bulk Account" (observed: "Bulk Account"). */
  priceLevel: string | null;
}

/** A name in the account, and whether Dynadot marks it for sale. */
export interface DynadotAccountDomain {
  /** Lowercase ASCII. */
  name: string;
  forSale: boolean;
}

/** A listing of a name in the account, as `get_listing_item` reads it. */
export interface DynadotListing {
  listingId: string | null;
  name: string;
  /** In the currency asked for; Dynadot converts (observed). */
  price: Amount | null;
  type: DynadotListingType | null;
  typeRaw: string;
  /** A buyer's purchase is under way. */
  pendingSale: boolean;
}

/** A name held at another registrar, from Dynadot's other-registrar list. */
export interface DynadotExternalDomain {
  name: string;
  /** As Dynadot names it ("101domain"); null when it doesn't know. */
  registrar: string | null;
  /** Dynadot's word for the name ("Registered", "Unregistered", …). */
  status: string;
  verified: boolean;
  verifyStatusRaw: string;
  /** Null when it isn't listed ("Not Set"). */
  listingType: DynadotListingType | null;
  listingTypeRaw: string;
  price: Amount | null;
  transferStatus: string | null;
  /** ISO 8601. */
  updatedAt: string | null;
}

/** What DomBot sends to list, reprice or delist a name, of either kind. */
export interface DynadotListingInput {
  forSale: boolean;
  listingType: DynadotListingType;
  /** Buy Now; null for Make Offer alone. */
  price: Amount | null;
  minOffer: Amount | null;
  /** ISO 4217; Dynadot takes it lowercase. A listing keeps it. */
  currency: string;
  /** Required, non-empty, by `set_for_sale` for a name in the account. */
  description?: string;
}

/** How to verify a name held elsewhere: the account's key, three ways. */
export interface DynadotVerification {
  name: string;
  verified: boolean;
  /** The Open Marketplace Key: one per account (seen in the dashboard). */
  key: string | null;
  /** The TXT record's value (the key). */
  txt: string | null;
  /** Dynadot's DNS pair and the NS3 that carries the key. */
  nameservers: string[];
  cname: string | null;
}
