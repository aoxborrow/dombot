import type { Amount } from '../../../shared/markets';

// What the Dynadot client returns: Dynadot's marketplace in its own terms,
// with dates as ISO strings and prices as decimal strings.

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
