import type { SedoCurrency } from './wire';

export type { SedoCurrency };

// What the Sedo client returns and takes. Money is canonical decimal strings
// ("99.99", "500") with the listing's currency, as DomBot stores amounts;
// Sedo prices carry cents and come in EUR, USD or GBP.
//
// UNVERIFIED: every shape here is from Sedo's docs and example responses,
// not from live calls (docs/sedo-api.md).

export interface SedoKeyword {
  keyword: string;
  /** Sedo's keyword market code (see KeywordMarkets). */
  market: string;
  views: number | null;
  clicks: number | null;
  earnings: string | null;
  /** Revenue per 1,000 views. */
  rpm: string | null;
  inserted: string | null;
}

export interface SedoListing {
  /** ASCII (punycode) lowercase name. */
  name: string;
  /** Up to three Sedo category ids. */
  categories: number[];
  /** Listed for sale; false: parked only. */
  forSale: boolean;
  /** Null when no price is set (Sedo's 0). */
  price: string | null;
  /** The lowest offer Sedo forwards; null when unset (Sedo's 0). */
  minPrice: string | null;
  /** Buyers can buy outright at `price`; false: an asking price, offers. */
  fixedPrice: boolean;
  currency: SedoCurrency;
  /** ISO 639-1 language of the name. */
  language: string | null;
  /** DomainListExtended only: when it was added (ISO 8601). */
  insertedAt: string | null;
  /** DomainListExtended only: lifetime parking earnings. */
  earningsTotal: string | null;
  /** DomainListExtended only: master keywords and their parking stats. */
  keywords: SedoKeyword[] | null;
}

/**
 * Every field DomainInsert and DomainEdit take. Edit replaces the listing
 * with this, so a partial change goes through `updateListings`, which reads
 * the current values first.
 */
export interface SedoListingInput {
  name: string;
  categories?: number[];
  forSale: boolean;
  /** Null or "0": no price. */
  price: string | null;
  minPrice: string | null;
  fixedPrice: boolean;
  currency: SedoCurrency;
  /** Required by DomainInsert, optional for DomainEdit. */
  language?: string | null;
}

/** A change to an existing listing: only the fields given are changed. */
export type SedoListingChange = Partial<Omit<SedoListingInput, 'name'>> & {
  name: string;
};

/** What happened to one name in a batch call. */
export interface SedoWriteResult {
  name: string;
  ok: boolean;
  /** Sedo's fault code when not ok (E3121, …). */
  code: string | null;
  message: string | null;
}

/** DomainStatus: what Sedo shows publicly about any name. */
export interface SedoDomainStatus {
  name: string;
  /** In Sedo's database at all. */
  onSedo: boolean;
  forSale: boolean;
  price: string | null;
  currency: SedoCurrency | null;
  visitorsPerMonth: number | null;
}

/** One row of parking statistics: a day (or month) for a name or account. */
export interface SedoParkingStats {
  /** Null for account-wide rows. */
  name: string | null;
  /** YYYY-MM-DD; the first of the month for monthly rows. */
  date: string;
  visitors: number | null;
  clicks: number | null;
  /** UNVERIFIED: the docs don't say which currency earnings are in. */
  earnings: string | null;
  /** False while Sedo still calls the earnings an estimate. */
  final: boolean;
}

export interface SedoPayment {
  /** YYYY-MM-01. */
  month: string;
  earnings: string | null;
}

export interface SedoCategory {
  id: number;
  name: string;
  /** The parent's id, for subcategories. */
  parentId: number | null;
}

export interface SedoLanguage {
  /** ISO 639-1. */
  code: string;
  name: string;
}
