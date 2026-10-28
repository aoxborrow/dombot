// The Atom client's own types (docs/atom-api.md). Money is whole US dollars,
// as Atom sends it; the adapter turns it into DomBot's decimal strings.
//
// UNVERIFIED: Atom's specs give almost no response schemas, so every field
// below beyond `domain_name`, `status`, `selling_price`, `primary_category`,
// `discount_price` and `description` is a guess at a likely name, read
// leniently by wire.ts. docs/atom-api.md, "Unverified", lists what to check.

/** Atom's listing tiers. The API filters by premium, standard and geo. */
export type AtomListingType = 'standard' | 'plus' | 'premium' | 'geo';

/** The tiers DomBot will create. Premium spends an AI credit and goes to
 *  review, so DomBot never adds one; submit Premium names on atom.com. */
export type AtomCreatableType = 'standard' | 'plus';

export interface AtomListing {
  /** toAscii(name). */
  name: string;
  /** The name as Atom shows it (Atom CamelCases names), when it differs. */
  displayName: string | null;
  /** Atom's id for the listing, when it sends one. */
  id: string | null;
  type: AtomListingType | null;
  /** Atom's word for the tier, as sent. */
  typeRaw: string | null;
  /** Atom's status word ("Approved", "Seller Approved", …). */
  status: string;
  /** Whole USD; null when Atom shows Make an Offer (0 or missing). */
  price: number | null;
  /** Whole USD off the price until Monday; null when none. */
  discount: number | null;
  /** Atom's primary category (industry), by name or id as sent. */
  primaryCategory: string | null;
  description: string | null;
  /** ISO 8601 when Atom says. */
  listedAt: string | null;
  /** Counters when the list sends them (UNVERIFIED that it does). */
  views: number | null;
  shortlists: number | null;
  trackers: number | null;
}

export interface AtomPage<T> {
  items: T[];
  /** From the response's paging, when it has any. */
  page: number | null;
  totalPages: number | null;
  total: number | null;
}

export interface AtomSale {
  /** Atom's id for the sale; the name and day when it sends none. */
  id: string;
  name: string;
  type: AtomListingType | null;
  /** YYYY-MM-DD. */
  soldOn: string | null;
  status: string;
  /** Whole or decimal USD as sent. */
  price: number | null;
  commission: number | null;
  net: number | null;
  /** YYYY-MM-DD. */
  paidOutOn: string | null;
  /** A payment plan: installments paid of total, when Atom says. */
  installments: { paid: number | null; total: number | null } | null;
}

/** One name's counters. Lifetime totals, as far as Atom says (UNVERIFIED). */
export interface AtomAnalytics {
  name: string;
  views: number | null;
  shortlists: number | null;
  trackers: number | null;
  directVisits: number | null;
  discoveryViews: number | null;
  repeatViews: number | null;
}

export interface AtomCategory {
  id: string | null;
  name: string;
}

export interface AtomGradeResult {
  name: string;
  brandFit: boolean | null;
  premiumFit: boolean | null;
  status: string;
  /** YYYY-MM-DD. */
  submittedOn: string | null;
}

export interface AtomAppraisal {
  name: string;
  /** Whole USD; null when Atom has no estimate (`message` says why). */
  estimate: number | null;
  score: number | null;
  signals: string[];
  rootWords: string[];
  /** How many of this name's other TLDs are taken. */
  tldTakenCount: number | null;
  trademarkConflicts: number | null;
  message: string | null;
}

/** What a write answered. Atom's success bodies are a message, if anything. */
export interface AtomWriteAck {
  message: string | null;
}
