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
  buyNow: boolean;
  forSale: boolean;
  leaseToOwn: boolean;
}

/** Two amounts are the same price (decimal strings, null for none). */
export const samePrice = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : Number(a) === Number(b);

/**
 * The change the listing editor sends: for a listed name only the fields that
 * differ from the listing, so the market's other settings stay as they are;
 * for a new listing everything set. Fields the market doesn't have are never
 * sent (its adapter would refuse them). A change with only `name` means
 * nothing changed.
 */
export function listingChange(
  name: string,
  listing: MarketListing | null,
  caps: Pick<
    MarketCapabilities,
    'currencies' | 'minOffer' | 'floor' | 'askingPrice' | 'hide' | 'leaseToOwn'
  >,
  form: ListingForm,
): MarketListingChange {
  const change: MarketListingChange = { name };
  const priceChanged =
    !listing ||
    !samePrice(form.price, listing.price) ||
    form.currency !== listing.currency;
  if (priceChanged) change.price = form.price;
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
  // Buy Now or an asking price only means something with a price.
  if (
    caps.askingPrice &&
    form.price &&
    (priceChanged || form.buyNow !== listing?.buyNow)
  ) {
    change.buyNow = form.buyNow;
  }
  if (
    caps.hide &&
    (listing ? form.forSale !== listing.forSale : !form.forSale)
  ) {
    change.forSale = form.forSale;
  }
  if (
    caps.leaseToOwn &&
    (listing
      ? form.leaseToOwn !== (listing.leaseToOwn?.enabled ?? false)
      : form.leaseToOwn)
  ) {
    change.leaseToOwn = { enabled: form.leaseToOwn };
  }
  return change;
}
