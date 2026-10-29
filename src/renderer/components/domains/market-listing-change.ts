import type {
  MarketCapabilities,
  MarketListing,
  MarketListingChange,
} from '../../../shared/markets';

/** What the listing editor holds, with amounts parsed (null for empty). */
export interface ListingForm {
  price: string | null;
  minOffer: string | null;
  floor: string | null;
  currency: string;
  leaseToOwn: boolean;
  /** The most monthly payments, when lease-to-own is on. */
  leaseMonths: number;
}

/** Two amounts are the same price (decimal strings, null for none). */
export const samePrice = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : Number(a) === Number(b);

/**
 * The change the listing editor sends: for a listed name only the fields that
 * differ from the listing, so the market's other settings stay as they are;
 * for a new listing everything set. Fields the market doesn't have are never
 * sent (its adapter would refuse them). A hidden listing is made visible: the
 * editor has no "not for sale" mode. A change with only `name` means nothing
 * changed.
 */
export function listingChange(
  name: string,
  listing: MarketListing | null,
  caps: Pick<
    MarketCapabilities,
    'currencies' | 'minOffer' | 'floor' | 'leaseToOwn'
  >,
  form: ListingForm,
): MarketListingChange {
  const change: MarketListingChange = { name };
  if (
    !listing ||
    !samePrice(form.price, listing.price) ||
    form.currency !== listing.currency
  ) {
    change.price = form.price;
  }
  if (
    caps.currencies.length > 1 &&
    (!listing || form.currency !== listing.currency)
  ) {
    change.currency = form.currency as MarketListingChange['currency'];
  }
  if (
    caps.minOffer &&
    (listing ? !samePrice(form.minOffer, listing.minOffer) : form.minOffer)
  ) {
    change.minOffer = form.minOffer;
  }
  if (
    caps.floor &&
    (listing ? !samePrice(form.floor, listing.floor) : form.floor)
  ) {
    change.floor = form.floor;
  }
  // Not while the market is still verifying the name: it decides when that
  // goes up for sale (Sedo refuses it before then).
  if (listing && !listing.forSale && listing.status !== 'pending') {
    change.forSale = true;
  }
  // A new listing says either way, months included: Afternic turns leasing
  // on by default, with its own idea of the months.
  if (caps.leaseToOwn) {
    const was = listing?.leaseToOwn;
    const toggled = !listing || form.leaseToOwn !== (was?.enabled ?? false);
    const months =
      form.leaseToOwn && (!listing || form.leaseMonths !== was?.maxPayments);
    if (toggled || months) {
      change.leaseToOwn = form.leaseToOwn
        ? { enabled: true, maxPayments: form.leaseMonths }
        : { enabled: false };
    }
  }
  return change;
}
