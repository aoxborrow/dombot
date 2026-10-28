// The Atom client's own types (docs/atom-api.md). Money is whole US dollars,
// as Atom sends it; the adapter turns it into DomBot's decimal strings.
//
// Field by field these follow what Atom sent live (docs/atom-api.md,
// "Observed"); what's still a guess says UNVERIFIED.

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
  /** Atom's id for the listing. */
  id: string | null;
  type: AtomListingType | null;
  /** Atom's word for the tier, as sent ("Premium", "Standard"). */
  typeRaw: string | null;
  /** Atom's status ("Approved", "Seller Approved", "Transfer Complete"). */
  status: string;
  /** Whole USD; null when Atom shows Make an Offer (a price of 0). */
  price: number | null;
  /** Whole USD off the price until Monday; null when none. */
  discount: number | null;
  /** Atom's primary category (industry), by name. */
  primaryCategory: string | null;
  description: string | null;
  /** ISO 8601 when Atom says; listing records don't. */
  listedAt: string | null;
}

export interface AtomPage<T> {
  items: T[];
  /** From the response's paging, when it has any. */
  page: number | null;
  totalPages: number | null;
  total: number | null;
}

export interface AtomSale {
  /** Atom sends no sale id: the name and the day it sold. */
  id: string;
  name: string;
  type: AtomListingType | null;
  /** YYYY-MM-DD. */
  soldOn: string | null;
  /** "Outright", or a payment plan's terms. */
  terms: string | null;
  /** Where the transfer is ("AuthCode Sent"), or null. */
  transferStatus: string | null;
  /** USD. */
  price: number | null;
  /** Atom doesn't send it; the adapter estimates it from the tier. */
  commission: number | null;
  /** Null when Atom sends 0, which it does for completed sales too. */
  net: number | null;
  /** YYYY-MM-DD. */
  paidOutOn: string | null;
  /** YYYY-MM-DD, when the name was added to Atom. */
  listedOn: string | null;
  /** A payment plan: installments paid of total, when Atom says. */
  installments: { paid: number | null; total: number | null } | null;
}

/** One name's running totals (observed: lifetime counts). */
export interface AtomAnalytics {
  name: string;
  views: number | null;
  shortlists: number | null;
  offers: number | null;
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
  positiveSignals: string[];
  negativeSignals: string[];
  rootWords: string[];
  /** How many of this name's other TLDs are taken. */
  tldTakenCount: number | null;
  trademarkConflicts: number | null;
  /** YYYY-MM-DD. */
  registeredOn: string | null;
  /** Listed on Atom (by anyone), and at what BIN. */
  listed: boolean | null;
  binPrice: number | null;
  /** Appraisals used today, of the daily limit (10 by default). */
  usedToday: number | null;
  dailyLimit: number | null;
  message: string | null;
}

/** What a write answered. Atom's success bodies are a message, if anything. */
export interface AtomWriteAck {
  message: string | null;
}
