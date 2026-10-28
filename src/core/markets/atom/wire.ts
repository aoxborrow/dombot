import { toAscii } from '../../../shared/domain-name';
import { codeFor, type AtomErrorCode } from './errors';
import type {
  AtomAnalytics,
  AtomAppraisal,
  AtomCategory,
  AtomGradeResult,
  AtomListing,
  AtomListingType,
  AtomPage,
  AtomSale,
} from './types';

// Reading Atom's JSON. Checked live (2026-10-28, docs/atom-api.md,
// "Observed"): lists come as a bare array with no paging fields, one record
// as a bare object, and every failure as `{ "message": … }` with HTTP 200.
// The envelope readers still accept `data`-wrapped shapes (grading results
// come as `{ count, data }`, the primary categories under `categories`).
// What's still a guess says UNVERIFIED.

export const ATOM_BASE_URL = 'https://www.atom.com/api/marketplace';

type Rec = Record<string, unknown>;

export function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The first of `keys` that `rec` has a non-empty value for. */
function pick(rec: Rec, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = rec[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

export function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/** A number, also from "1,500" or "$1500". */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (['1', 'y', 'yes', 'true'].includes(s)) return true;
  if (['0', 'n', 'no', 'false'].includes(s)) return false;
  return null;
}

/** A positive amount, or null: Atom's "no price" and "no discount" are 0. */
function positive(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}

/**
 * ISO 8601 from Atom's dates. The registrar API sends `YYYY-MM-DD HH:MM:SS`
 * with no zone; read as UTC. UNVERIFIED for the seller API.
 */
const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

export function isoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  // Sales send "May 02, 2026 17:45:10" (observed); read as UTC too.
  const us =
    /^([a-z]{3})[a-z]* (\d{1,2}), (\d{4})(?: (\d{2}:\d{2}(?::\d{2})?))?/i.exec(
      s,
    );
  if (us) {
    const month = MONTHS.indexOf(us[1].toLowerCase());
    if (month < 0) return null;
    const date = `${us[3]}-${String(month + 1).padStart(2, '0')}-${us[2].padStart(2, '0')}`;
    const time = us[4]
      ? us[4].length === 5
        ? `${us[4]}:00`
        : us[4]
      : '00:00:00';
    return `${date}T${time}Z`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(s);
  if (!m) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const time = m[2] ? (m[2].length === 5 ? `${m[2]}:00` : m[2]) : '00:00:00';
  return `${m[1]}T${time}Z`;
}

/** YYYY-MM-DD from any of Atom's dates. */
export function dayOf(v: unknown): string | null {
  return isoDate(v)?.slice(0, 10) ?? null;
}

export function listingTypeOf(v: unknown): AtomListingType | null {
  const s = str(v)?.toLowerCase();
  if (!s) return null;
  if (s.includes('premium') || s === 'curated') return 'premium';
  if (s.includes('plus')) return 'plus';
  if (s.includes('geo')) return 'geo';
  if (s.includes('standard')) return 'standard';
  return null;
}

// Envelopes

/** Keys a bare status message carries; anything else means data. */
const ENVELOPE_KEYS = new Set([
  'message',
  'error',
  'errors',
  'success',
  'status',
  'code',
  'daily_limit',
  'used_today',
]);

/** Wording that marks a lone message as a failure rather than a success. */
// Observed refusals include "Discount Price should not be empty", "…should
// not be greater than $195", "Domain description is empty" and "Wrong
// category name in the request".
const FAILURE_WORDS =
  /should|empty|greater than|less than|invalid|required|cannot|can't|can not|unable|not allowed|not authori|fail|error|already|must|exceed|limit|not found|does not|doesn't|no such|denied|insufficient|wrong|not (be )?(listed|valid|eligible)|only supports|outside|below|above/i;

export interface AtomFailure {
  code: AtomErrorCode;
  message: string;
  dailyLimit: number | null;
  usedToday: number | null;
}

/**
 * Whether `body` is Atom saying no. Atom sends failures with HTTP 200, so
 * this is the only test that counts: `success: false`, an error status, or a
 * lone message worded as a failure. A lone message worded otherwise
 * ("Domain added successfully") is a success.
 */
export function failureOf(body: unknown): AtomFailure | null {
  if (!isRecord(body)) return null;
  const message =
    str(body.message) ??
    str(body.error) ??
    (Array.isArray(body.errors) ? body.errors.map(str).join(' ') : null);
  const quota = {
    dailyLimit: num(body.daily_limit),
    usedToday: num(body.used_today),
  };
  const said = (fallback: string): AtomFailure => {
    const text = message || fallback;
    return { code: codeFor(text), message: text, ...quota };
  };
  if (body.success === false) return said('Atom refused the request.');
  const status = str(body.status)?.toLowerCase();
  const envelopeOnly = Object.keys(body).every((k) => ENVELOPE_KEYS.has(k));
  if (
    envelopeOnly &&
    (status === 'error' || status === 'fail' || status === 'failed')
  ) {
    return said('Atom refused the request.');
  }
  if (
    envelopeOnly &&
    message &&
    body.success !== true &&
    FAILURE_WORDS.test(message)
  ) {
    return said(message);
  }
  return null;
}

/** The lone message of a successful write, if Atom sent one. */
export function messageOf(body: unknown): string | null {
  return isRecord(body) ? (str(body.message) ?? null) : null;
}

const ITEM_KEYS = [
  'data',
  'domains',
  'sales',
  'results',
  'items',
  'records',
  'list',
  'categories',
];

/** The records in a response, wherever Atom put them. */
export function itemsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!isRecord(body)) return [];
  for (const k of ITEM_KEYS) {
    const v = body[k];
    if (Array.isArray(v)) return v;
    if (isRecord(v)) {
      const inner = itemsOf(v);
      if (inner.length) return inner;
      if ('domain_name' in v) return [v];
    }
  }
  return 'domain_name' in body ? [body] : [];
}

/** The first record in a response, for single-record calls. */
export function recordOf(body: unknown): Rec | null {
  if (isRecord(body) && isRecord(body.data) && !itemsOf(body.data).length) {
    return body.data;
  }
  const [first] = itemsOf(body);
  if (isRecord(first)) return first;
  return isRecord(body) ? body : null;
}

function pagingOf(body: unknown): Omit<AtomPage<never>, 'items'> {
  const none = { page: null, totalPages: null, total: null };
  if (!isRecord(body)) return none;
  const p = isRecord(body.pagination)
    ? body.pagination
    : isRecord(body.meta)
      ? body.meta
      : body;
  return {
    page: num(pick(p, 'current_page', 'page')),
    totalPages: num(pick(p, 'total_pages', 'last_page', 'pages')),
    total: num(pick(p, 'total_records', 'total', 'count')),
  };
}

export function pageOf<T>(
  body: unknown,
  read: (item: unknown) => T | null,
): AtomPage<T> {
  return {
    items: itemsOf(body).flatMap((i) => {
      const r = read(i);
      return r === null ? [] : [r];
    }),
    ...pagingOf(body),
  };
}

// Records

function nameOf(rec: Rec): { name: string; displayName: string | null } | null {
  // Sales spell it "Domain Name" (observed).
  const raw = str(pick(rec, 'domain_name', 'Domain Name'));
  if (!raw || !raw.includes('.')) return null;
  let name: string;
  try {
    name = toAscii(raw);
  } catch {
    return null;
  }
  return { name, displayName: raw !== name ? raw : null };
}

/**
 * A listing, as /domains, /domain-details and the syndication list send it
 * (observed): `id`, `domain_name` (CamelCased), `status`, `full_price`,
 * `selling_price`, `primary_category`, `discount`, `description`,
 * `logo_image`, `listing_type` ("Premium", "Standard"). Sold names stay in
 * the list with status "Transfer Complete".
 */
export function readListing(
  item: unknown,
  typeHint: AtomListingType | null = null,
): AtomListing | null {
  if (!isRecord(item)) return null;
  const named = nameOf(item);
  if (!named) return null;
  const typeRaw = str(item.listing_type);
  return {
    ...named,
    id: str(item.id),
    type: listingTypeOf(typeRaw) ?? typeHint,
    typeRaw,
    status: str(item.status) ?? '',
    // `full_price` is the listing's price. `selling_price` matches it in the
    // account's own list, but the syndication list sends a partner price
    // there (about 10% higher, observed), so it's only a fallback.
    price: positive(item.full_price ?? item.selling_price),
    // UNVERIFIED: no discounted listing seen yet; read as dollars off, as
    // add-discount takes it and Atom's Sheets column shows it.
    discount: positive(item.discount),
    primaryCategory: str(item.primary_category),
    description: str(item.description),
    // Not in listing records; a sale's `added_on` has it for sold names.
    listedAt: isoDate(item.added_on),
  };
}

/**
 * A sale (observed): `Domain Name`, `sales_type` ("Premium"), `sale_date`
 * ("May 02, 2026 17:45:10"), `sale_amount`, `sale_amount_net` (0 when Atom
 * doesn't say), `sale_terms` ("Outright"), `transfer_status` ("AuthCode
 * Sent" or null), `added_on`. No sale id, so the name and day make one.
 */
export function readSale(item: unknown): AtomSale | null {
  if (!isRecord(item)) return null;
  const named = nameOf(item);
  if (!named) return null;
  const soldOn = dayOf(item.sale_date);
  // UNVERIFIED: no payment-plan sale seen; these names are guesses.
  const paid = num(pick(item, 'installments_paid', 'paid_installments'));
  const total = num(pick(item, 'total_installments', 'installments'));
  return {
    id: `${named.name}:${soldOn ?? 'undated'}`,
    name: named.name,
    type: listingTypeOf(item.sales_type),
    soldOn,
    terms: str(item.sale_terms),
    transferStatus: str(item.transfer_status),
    price: positive(item.sale_amount),
    commission: null,
    net: positive(item.sale_amount_net),
    paidOutOn: null,
    listedOn: dayOf(item.added_on),
    installments: paid === null && total === null ? null : { paid, total },
  };
}

/** One name's counters (observed): total views, shortlists and offers. */
export function readAnalytics(body: unknown, name: string): AtomAnalytics {
  const rec = isRecord(body) ? body : {};
  return {
    name,
    views: num(rec.total_views),
    shortlists: num(rec.total_shortlists),
    offers: num(rec.total_offers),
  };
}

/**
 * A category: /categories sends `{ id, name }`, /primary-categories a list
 * of names under `categories` (observed; the two lists differ).
 */
export function readCategory(item: unknown): AtomCategory | null {
  if (typeof item === 'string') {
    return item.trim() ? { id: null, name: item.trim() } : null;
  }
  if (!isRecord(item)) return null;
  const name = str(item.name);
  return name ? { id: str(item.id), name } : null;
}

/** A grading result, per the spec. UNVERIFIED: the account had none. */
export function readGrade(item: unknown): AtomGradeResult | null {
  if (!isRecord(item)) return null;
  const named = nameOf(item);
  if (!named) return null;
  return {
    name: named.name,
    brandFit: bool(item.is_brand_fit),
    premiumFit: bool(item.premium_fit),
    status: str(item.status) ?? '',
    submittedOn: dayOf(item.date_submitted),
  };
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.flatMap((x) => str(x) ?? []) : [];
}

/**
 * An appraisal (observed): estimate, score, positive and negative signals,
 * root words, TLDs taken, trademark conflicts, whether it's listed and at
 * what BIN, and `usage` (used today of the daily limit).
 */
export function readAppraisal(body: unknown, name: string): AtomAppraisal {
  const rec = isRecord(body) ? body : {};
  const usage = isRecord(rec.usage) ? rec.usage : {};
  return {
    name,
    estimate: positive(rec.atom_appraisal),
    score: num(rec.domain_score),
    positiveSignals: strings(rec.positive_signals),
    negativeSignals: strings(rec.negative_signals),
    rootWords: strings(rec.root_words),
    tldTakenCount: num(rec.tld_taken_count),
    trademarkConflicts: num(rec.tm_conflicts),
    registeredOn: dayOf(rec.date_registered),
    listed: bool(rec.is_listed),
    binPrice: positive(rec.bin_price),
    usedToday: num(usage.used_today),
    dailyLimit: num(usage.daily_limit),
    message: str(rec.external_message),
  };
}
