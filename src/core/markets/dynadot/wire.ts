import { toAscii } from '../../../shared/domain-name';
import type {
  DynadotAccountDomain,
  DynadotAccountInfo,
  DynadotExternalDomain,
  DynadotListing,
  DynadotListingType,
  DynadotVerification,
} from './types';

// Reading Dynadot's JSON. Every answer is the RESTful v2 envelope,
// `{ code, message, data }`, with `error.description` on a failure. Checked
// live, reads only (2026-11-04, docs/dynadot-marketplace-api.md):
// - `domain_list` marks names `is_for_sale: "Yes" | "No"`, pages with
//   `pagination_result` and takes `page_size=200`.
// - `get_listing_item` needs `currency` (400 without it), answers
//   `listing_item` with `type` in capitals (`BIN`, `BIN_MAKE_OFFER`),
//   `is_pending_sale_locked: "No"`, and no `is_huge_domains`; 404 for a
//   name with no listing.
// - `get_listings` is the whole marketplace (a total of 493,548), not the
//   account's own: DomBot doesn't use it.
// - The other-registrar list has no paging fields; an unlisted name reads
//   `for_sale_type: "Not Set"`, `price: ""`, dates 0 when unknown.

export const DYNADOT_BASE_URL = 'https://api.dynadot.com';

type Rec = Record<string, unknown>;

export function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/** Dynadot's "Yes"/"No" flags, and real booleans where it sends them. */
export function yes(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  return typeof v === 'string' && /^(yes|true|1)$/i.test(v.trim());
}

/**
 * A price ("7999.00", "1,500") as a canonical decimal string ("7999",
 * "1500"), or null for blank or zero.
 */
export function amount(v: unknown): string | null {
  const s = (str(v) ?? '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  const whole = int.replace(/^0+(?=\d)/, '');
  const cents = frac.replace(/0+$/, '');
  const out = cents ? `${whole}.${cents}` : whole;
  return out === '0' ? null : out;
}

/** ISO 8601 from a millisecond timestamp; null for 0, -1 or nothing. */
export function isoFromMs(v: unknown): string | null {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * A listing type from either spelling: the listing read's `BIN_MAKE_OFFER`
 * or the other-registrar list's "Buy Now + Make Offer". Null for "Not Set".
 */
export function listingTypeOf(v: unknown): DynadotListingType | null {
  const s = (str(v) ?? '').toLowerCase().replace(/[_+]/g, ' ');
  const bin = /(^|\s)bin(\s|$)|buy\s*now/.test(s);
  const offer = /make\s*offer/.test(s);
  if (bin && offer) return 'bin_make_offer';
  if (bin) return 'bin';
  if (offer) return 'make_offer';
  return null;
}

/** The `listing_type` Dynadot takes for a listing type. */
export function listingTypeParam(type: DynadotListingType): string {
  return type === 'bin'
    ? 'buy_now'
    : type === 'make_offer'
      ? 'make_offer'
      : 'buy_now_and_make_offer';
}

/**
 * A decimal amount in cents, as the other-registrar listing takes prices
 * ("1000 = $10.00"). UNVERIFIED for currencies without cents.
 */
export function cents(amount: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
    throw new Error(`${amount} isn’t an amount Dynadot takes.`);
  }
  const [whole, frac = ''] = amount.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** The envelope's `data`, or null when there isn't one. */
export function dataOf(body: unknown): Rec | null {
  return isRecord(body) && isRecord(body.data) ? body.data : null;
}

/** What Dynadot said went wrong, from the envelope. */
export function messageOf(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const error = isRecord(body.error) ? str(body.error.description) : null;
  return error ?? str(body.message);
}

/** The envelope's own code (it mirrors the HTTP status). */
export function envelopeCode(body: unknown): number | null {
  if (!isRecord(body)) return null;
  const n = Number(body.code);
  return Number.isFinite(n) ? n : null;
}

/** A name as DomBot keys it (lowercase punycode); null if it isn't one. */
export function asciiName(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    return toAscii(s);
  } catch {
    return null;
  }
}

export function readAccountInfo(data: Rec | null): DynadotAccountInfo {
  const info = isRecord(data?.account_info) ? data.account_info : data;
  return {
    username: str(info?.username),
    priceLevel: str(info?.price_level),
  };
}

export function readAccountDomain(item: unknown): DynadotAccountDomain | null {
  if (!isRecord(item)) return null;
  const n = asciiName(item.domain_name);
  return n ? { name: n, forSale: yes(item.is_for_sale) } : null;
}

export function readListing(item: unknown): DynadotListing | null {
  if (!isRecord(item)) return null;
  const n = asciiName(item.domain);
  if (!n) return null;
  return {
    listingId: str(item.listing_id),
    name: n,
    price: amount(item.price),
    type: listingTypeOf(item.type),
    typeRaw: str(item.type) ?? '',
    pendingSale: yes(item.is_pending_sale_locked),
  };
}

export function readExternalDomain(
  item: unknown,
): DynadotExternalDomain | null {
  if (!isRecord(item)) return null;
  const n = asciiName(item.domain_name);
  if (!n) return null;
  const verifyStatusRaw = str(item.verify_status) ?? '';
  return {
    name: n,
    registrar: str(item.registrar),
    status: str(item.status) ?? '',
    verified: /^verified$/i.test(verifyStatusRaw),
    verifyStatusRaw,
    listingType: listingTypeOf(item.for_sale_type),
    listingTypeRaw: str(item.for_sale_type) ?? '',
    price: amount(item.price),
    transferStatus: str(item.transfer_status),
    updatedAt: isoFromMs(item.updated_date),
  };
}

export function readVerification(
  data: Rec | null,
  fallbackName: string,
): DynadotVerification {
  const list = Array.isArray(data?.nameserver_list) ? data.nameserver_list : [];
  return {
    name: asciiName(data?.domain_name) ?? fallbackName,
    verified: /^verified$/i.test(str(data?.verify_status) ?? ''),
    key: str(data?.open_market_key)?.toLowerCase() ?? null,
    txt: str(data?.txt),
    nameservers: list.flatMap((ns) => str(ns)?.toLowerCase() ?? []),
    cname: str(data?.cname),
  };
}

/** Paging from `pagination_result`, when Dynadot sends it. */
export function pagingOf(data: Rec | null): {
  total: number | null;
  hasNext: boolean | null;
} {
  const p = isRecord(data?.pagination_result) ? data.pagination_result : null;
  if (!p) return { total: null, hasNext: null };
  const total = Number(p.total);
  return {
    total: Number.isFinite(total) ? total : null,
    hasNext: p.has_next_page === undefined ? null : yes(p.has_next_page),
  };
}

/** A list in `data` under the first of `keys` it has. */
export function listOf(data: Rec | null, ...keys: string[]): unknown[] {
  for (const k of keys) {
    const v = data?.[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}
