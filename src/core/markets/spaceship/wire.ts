import { toAscii } from '../../../shared/domain-name';
import type {
  SellerHubListing,
  SellerHubSale,
  SellerHubStatus,
  SellerHubVerificationOption,
} from './types';

// Reading Spaceship's JSON for SellerHub, from its OpenAPI spec
// (docs/sellerhub-api.md). Money is `{ amount: "10.99", currency: "USD" }`,
// names come as `name` (A-label), `unicodeName` and `displayName`. Pages are
// `{ items, total }` (take/skip) or `{ items, cursor }` (the sold report).
// Checked live, reads only (2026-11-07): the listing list, the sold report
// (empty) and the verification records (one TXT option at `@`).

export const SPACESHIP_BASE_URL = 'https://spaceship.dev/api';

type Rec = Record<string, unknown>;

export function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * A money object's amount as a canonical decimal string ("2500",
 * "10.99"), or null when it's missing or not a number. Zero stays "0".
 */
export function amountOf(v: unknown): string | null {
  const s = str(isRecord(v) ? v.amount : v);
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  const whole = int.replace(/^0+(?=\d)/, '');
  const cents = frac.replace(/0+$/, '');
  return cents ? `${whole}.${cents}` : whole;
}

/** A money object's currency, upper case; USD when it doesn't say. */
export function currencyOf(v: unknown): string {
  return (isRecord(v) ? str(v.currency) : null)?.toUpperCase() ?? 'USD';
}

/** The money object Spaceship takes: at most two decimal places, USD. */
export function money(amount: string): { amount: string; currency: 'USD' } {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`“${amount}” isn’t an amount.`);
  }
  // Spaceship's pattern is ^[0-9]+(\.[0-9]{1,2})?$.
  const fixed = n.toFixed(2).replace(/\.?0+$/, '');
  return { amount: fixed || '0', currency: 'USD' };
}

const STATUSES: readonly SellerHubStatus[] = [
  'failed',
  'verifying',
  'onSale',
  'onSaleStopped',
  'saleProcessing',
  'privateSale',
  'leaseActive',
  'sold',
];

export function statusOf(v: unknown): SellerHubStatus | null {
  const s = str(v);
  return s && (STATUSES as readonly string[]).includes(s)
    ? (s as SellerHubStatus)
    : null;
}

/** A name as DomBot keys it (punycode, lowercase); null when missing. */
export function asciiName(v: unknown): string | null {
  const s = str(v);
  return s ? toAscii(s) : null;
}

/** A SellerHub domain: from the list, a get, a create or an update. */
export function readListing(v: unknown): SellerHubListing | null {
  if (!isRecord(v)) return null;
  const name = asciiName(v.name) ?? asciiName(v.unicodeName);
  if (!name) return null;
  return {
    name,
    unicodeName: str(v.unicodeName) ?? name,
    displayName: str(v.displayName),
    description: str(v.description),
    status: statusOf(v.status),
    statusRaw: str(v.status) ?? '',
    binPrice: amountOf(v.binPrice),
    binPriceEnabled: v.binPriceEnabled === true,
    minPrice: amountOf(v.minPrice),
    minPriceEnabled: v.minPriceEnabled === true,
  };
}

/** One row of the sold report. */
export function readSale(v: unknown): SellerHubSale | null {
  if (!isRecord(v)) return null;
  const name = asciiName(v.name) ?? asciiName(v.unicodeName);
  if (!name) return null;
  const when = str(v.saleDateTime);
  const source = str(v.source);
  return {
    name,
    displayName: str(v.displayName),
    saleDateTime: when && !Number.isNaN(Date.parse(when)) ? when : null,
    salePrice: amountOf(v.salePrice),
    payout: amountOf(v.payout),
    currency: currencyOf(v.salePrice),
    source: source === 'N/A' ? null : source,
  };
}

/** The verification options: any one of them verifies. */
export function readVerificationOptions(
  v: unknown,
): SellerHubVerificationOption[] {
  const options = isRecord(v) && Array.isArray(v.options) ? v.options : [];
  return options.flatMap((o) => {
    const records = isRecord(o) && Array.isArray(o.records) ? o.records : [];
    const read = records.flatMap((r) => {
      if (!isRecord(r)) return [];
      const type = str(r.type);
      const name = str(r.name);
      const value = str(r.value);
      return type && name && value
        ? [{ type: type.toUpperCase(), name, value }]
        : [];
    });
    return read.length ? [{ records: read }] : [];
  });
}

/** A page's items and its total or next cursor. */
export function pageOf(v: unknown): {
  items: unknown[];
  total: number | null;
  cursor: string | null;
} {
  if (!isRecord(v)) return { items: [], total: null, cursor: null };
  return {
    items: Array.isArray(v.items) ? v.items : [],
    total: typeof v.total === 'number' ? v.total : null,
    cursor: str(v.cursor),
  };
}

/**
 * The message to show for a failure: the problem's `detail`, with the
 * first field error for a 422.
 */
export function messageOf(v: unknown): string | null {
  if (!isRecord(v)) return null;
  const detail = str(v.detail) ?? str(v.title);
  const first =
    Array.isArray(v.data) && isRecord(v.data[0]) ? v.data[0] : undefined;
  const field = first ? str(first.field) : null;
  const why = first ? str(first.details) : null;
  if (detail && why) return `${detail} ${field ? `${field}: ` : ''}${why}`;
  return detail ?? why;
}
