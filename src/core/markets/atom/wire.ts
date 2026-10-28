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

// Reading Atom's JSON. The seller spec types every response as the same
// five-field record, which can't be true of sales or analytics, so these
// readers accept the shapes Atom is likely to send: a bare array, an array
// under `data` (or `domains`, `sales`, …), or one record, with paging in
// `pagination` (the registrar API's shape) or at the top level.
//
// UNVERIFIED: no authenticated call has been made (no API key yet). The
// field names tried for each value are guesses beyond the spec's; once there
// are live responses, trim each list to what Atom actually sends.

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
export function isoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
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
const FAILURE_WORDS =
  /invalid|required|cannot|can't|can not|unable|not allowed|not authori|fail|error|already|must|exceed|limit|not found|does not|doesn't|no such|denied|insufficient|wrong|not (be )?(listed|valid|eligible)|only supports|outside|below|above/i;

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
  const raw = str(pick(rec, 'domain_name', 'domain', 'name'));
  if (!raw || !raw.includes('.')) return null;
  let name: string;
  try {
    name = toAscii(raw);
  } catch {
    return null;
  }
  return { name, displayName: raw !== name ? raw : null };
}

export function readListing(
  item: unknown,
  typeHint: AtomListingType | null = null,
): AtomListing | null {
  if (!isRecord(item)) return null;
  const named = nameOf(item);
  if (!named) return null;
  const typeRaw = str(
    pick(item, 'domain_type', 'listing_type', 'type', 'listing'),
  );
  return {
    ...named,
    id: str(pick(item, 'id', 'domain_id', 'listing_id')),
    type: listingTypeOf(typeRaw) ?? typeHint,
    typeRaw,
    status: str(pick(item, 'status', 'listing_status', 'domain_status')) ?? '',
    price: positive(pick(item, 'selling_price', 'price', 'bin_price')),
    // UNVERIFIED: whether `discount_price` is the amount off (as the
    // add-discount parameter and Atom's Sheets column are) or the price after
    // it. Read as the amount off.
    discount: positive(
      pick(item, 'discount', 'discount_amount', 'discount_price'),
    ),
    primaryCategory: str(
      pick(item, 'primary_category', 'category', 'industry'),
    ),
    description: str(pick(item, 'description', 'domain_description')),
    listedAt: isoDate(
      pick(
        item,
        'created_at',
        'date_added',
        'added_on',
        'listed_at',
        'approved_date',
      ),
    ),
    views: num(pick(item, 'views', 'total_views', 'page_views')),
    shortlists: num(
      pick(item, 'shortlists', 'shortlist', 'shortlisted', 'shortlist_count'),
    ),
    trackers: num(
      pick(item, 'trackers', 'price_trackers', 'track_price', 'tracking_count'),
    ),
  };
}

export function readSale(item: unknown): AtomSale | null {
  if (!isRecord(item)) return null;
  const named = nameOf(item);
  if (!named) return null;
  const soldOn = dayOf(
    pick(
      item,
      'sold_date',
      'sale_date',
      'sold_at',
      'order_date',
      'date',
      'created_at',
    ),
  );
  const paid = num(pick(item, 'installments_paid', 'paid_installments'));
  const total = num(pick(item, 'total_installments', 'installments'));
  return {
    id:
      str(pick(item, 'id', 'order_id', 'sale_id', 'transaction_id')) ??
      `${named.name}:${soldOn ?? 'undated'}`,
    name: named.name,
    type: listingTypeOf(pick(item, 'domain_type', 'listing_type', 'type')),
    soldOn,
    status:
      str(
        pick(item, 'status', 'order_status', 'sale_status', 'transfer_status'),
      ) ?? '',
    price: num(
      pick(
        item,
        'sale_price',
        'sold_price',
        'selling_price',
        'price',
        'amount',
      ),
    ),
    commission: num(
      pick(item, 'commission', 'commission_amount', 'atom_commission'),
    ),
    net: num(
      pick(
        item,
        'net',
        'net_amount',
        'net_payout',
        'actual_net_payout',
        'payout',
        'expected_net_payout',
      ),
    ),
    paidOutOn: dayOf(
      pick(item, 'payout_date', 'paid_on', 'paid_at', 'disbursed_at'),
    ),
    installments: paid === null && total === null ? null : { paid, total },
  };
}

export function readAnalytics(body: unknown, name: string): AtomAnalytics {
  const rec = recordOf(body) ?? {};
  const direct = num(
    pick(rec, 'direct_lander_visits', 'direct_visits', 'lander_visits'),
  );
  const discovery = num(
    pick(rec, 'platform_discovery_views', 'discovery_views'),
  );
  const views =
    num(pick(rec, 'views', 'total_views', 'page_views')) ??
    (direct !== null || discovery !== null
      ? (direct ?? 0) + (discovery ?? 0)
      : null);
  return {
    name,
    views,
    shortlists: num(
      pick(rec, 'shortlists', 'shortlist', 'shortlisted', 'shortlist_count'),
    ),
    trackers: num(
      pick(rec, 'trackers', 'price_trackers', 'track_price', 'tracking_count'),
    ),
    directVisits: direct,
    discoveryViews: discovery,
    repeatViews: num(pick(rec, 'repeat_views', 'repeat_buyer_views')),
  };
}

export function readCategory(item: unknown): AtomCategory | null {
  if (typeof item === 'string')
    return item.trim() ? { id: null, name: item.trim() } : null;
  if (!isRecord(item)) return null;
  const name = str(pick(item, 'name', 'category_name', 'category', 'title'));
  return name ? { id: str(pick(item, 'id', 'category_id')), name } : null;
}

export function readGrade(item: unknown): AtomGradeResult | null {
  if (!isRecord(item)) return null;
  const named = nameOf(item);
  if (!named) return null;
  return {
    name: named.name,
    brandFit: bool(pick(item, 'is_brand_fit', 'brand_fit')),
    premiumFit: bool(pick(item, 'premium_fit', 'is_premium_fit')),
    status: str(item.status) ?? '',
    submittedOn: dayOf(pick(item, 'date_submitted', 'submitted_at')),
  };
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.flatMap((x) => str(x) ?? []) : [];
}

export function readAppraisal(body: unknown, name: string): AtomAppraisal {
  const rec = recordOf(body) ?? {};
  return {
    name,
    estimate: positive(rec.atom_appraisal),
    score: num(rec.domain_score),
    signals: strings(rec.key_signals),
    rootWords: strings(rec.root_words),
    tldTakenCount: num(rec.tld_taken_count),
    trademarkConflicts: num(rec.tm_conflicts),
    message: str(rec.external_message),
  };
}
