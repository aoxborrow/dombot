import { XMLParser } from 'fast-xml-parser';

// Sedo's Basic API on the wire (docs/sedo-api.md): form-encoded requests and
// XML responses. Nothing outside this folder sees these shapes.
//
// Built from the docs (https://api.sedo.com/apidocs/v1/Basic/) and checked
// against a live account for reads (2026-10-28). "UNVERIFIED" comments mark
// what still isn't confirmed.

export const SEDO_BASE_URL = 'https://api.sedo.com/api/v1/';

/** Sedo's currency codes, as listings send and take them. */
export const SEDO_CURRENCIES = ['EUR', 'USD', 'GBP'] as const;
export type SedoCurrency = (typeof SEDO_CURRENCIES)[number];

export function currencyFromCode(code: string | undefined): SedoCurrency {
  // Listing functions send 0/1/2; DomainStatus's example sends "EUR".
  const upper = (code ?? '').trim().toUpperCase();
  if ((SEDO_CURRENCIES as readonly string[]).includes(upper)) {
    return upper as SedoCurrency;
  }
  const byIndex = SEDO_CURRENCIES[Number(upper)];
  if (upper !== '' && byIndex) return byIndex;
  throw new Error(`Unknown Sedo currency: ${code}`);
}

export function currencyToCode(currency: SedoCurrency): number {
  return SEDO_CURRENCIES.indexOf(currency);
}

// Requests

export type FormValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly FormValue[]
  | { readonly [key: string]: FormValue };

/**
 * Parameters as PHP's `http_build_query` spells them, which is what the
 * docs' examples send: `domainentry[0][domain]=…`,
 * `domainentry[0][category][1]=2`. Booleans as 1/0; null and undefined left
 * out.
 */
export function encodeForm(params: Record<string, FormValue>): string {
  const out = new URLSearchParams();
  const add = (key: string, value: FormValue) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => add(`${key}[${i}]`, v));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
    } else if (typeof value === 'boolean') {
      out.append(key, value ? '1' : '0');
    } else {
      out.append(key, String(value));
    }
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  return out.toString();
}

// Responses

/** A parsed XML node: text, attributes and children, as fast-xml-parser
 * gives them with attributes kept and every value left a string. */
export type XmlNode = string | { [key: string]: XmlNode | XmlNode[] };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Lists that may hold one entry still come back as arrays.
  isArray: (name) =>
    [
      'item',
      'keyword',
      'maincategory',
      'subcategory1',
      'subcategory2',
      'language',
    ].includes(name),
});

export interface ParsedResponse {
  /** The document element's name: SEDOLIST, SEDODOMAINLIST, SEDOFAULT, … */
  root: string;
  body: { [key: string]: XmlNode | XmlNode[] };
}

/** Parses a response document. Throws when it isn't XML Sedo would send. */
export function parseXml(text: string): ParsedResponse {
  const doc = parser.parse(text) as Record<string, unknown>;
  const root = Object.keys(doc).find((k) => !k.startsWith('?'));
  if (!root) throw new Error('Empty XML response.');
  const body = doc[root];
  return {
    root,
    body:
      body && typeof body === 'object' ? (body as ParsedResponse['body']) : {},
  };
}

/** A node's text: `<x type="xsd:int">1</x>` and `<x>1</x>` both give "1". */
export function text(node: XmlNode | XmlNode[] | undefined): string {
  if (node === undefined) return '';
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'string') return node;
  const t = node['#text'];
  return typeof t === 'string' ? t : '';
}

export function child(
  node: XmlNode | XmlNode[] | undefined,
  name: string,
): XmlNode | XmlNode[] | undefined {
  if (!node || typeof node === 'string' || Array.isArray(node))
    return undefined;
  return node[name];
}

export function list(node: XmlNode | XmlNode[] | undefined): XmlNode[] {
  if (node === undefined || node === '') return [];
  return Array.isArray(node) ? node : [node];
}

/** The document's `<item>`s, the shape of every list response. */
export function items(res: ParsedResponse): XmlNode[] {
  return list(res.body.item);
}

/** `1`/`0`, `true`/`false`, `Y`/`N` → boolean. */
export function flag(value: string): boolean {
  return ['1', 'true', 'y', 'yes'].includes(value.trim().toLowerCase());
}

export function int(value: string): number | null {
  const n = Number(value);
  return value.trim() !== '' && Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * A Sedo amount ("99.99", "500", "0.00") as a canonical decimal string
 * ("99.99", "500"), or null for blank or zero: Sedo spells "no price" 0.
 */
export function amount(value: string): string | null {
  const v = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  const [int, frac = ''] = v.split('.');
  const whole = int.replace(/^(-?)0+(?=\d)/, '$1');
  const cents = frac.replace(/0+$/, '');
  const out = cents ? `${whole}.${cents}` : whole;
  return /^-?0$/.test(out) ? null : out;
}

/**
 * Sedo's insert date as ISO 8601. The docs say `YYYY-MM-DD HH:MM:SS`, "in
 * some cases" a UNIX timestamp (their own example is one). No time zone is
 * given; UNVERIFIED: read as UTC.
 */
export function insertedAt(value: string): string | null {
  const v = value.trim();
  if (/^\d{9,11}$/.test(v)) {
    return new Date(Number(v) * 1000).toISOString().replace(/\.000Z$/, 'Z');
  }
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(v);
  if (m) return `${m[1]}T${m[2]}Z`;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : null;
}

// The listing shapes the functions return.

export interface WireListing {
  domain: string;
  /** Up to three category ids (`<cat1>`…`<cat3>`). */
  category: number[];
  forsale: boolean;
  price: string | null;
  minprice: string | null;
  fixedprice: boolean;
  currency: SedoCurrency;
  domainlanguage: string | null;
  // DomainListExtended only:
  inserted?: string | null;
  earningscomplete?: string | null;
  keywords?: WireKeyword[];
}

export interface WireKeyword {
  keyword: string;
  market: string;
  views: number | null;
  clicks: number | null;
  earnings: string | null;
  rpm: string | null;
  inserted: string | null;
}

export function readListing(item: XmlNode): WireListing {
  const categories = child(item, 'category');
  const category = ['cat1', 'cat2', 'cat3']
    .map((k) => int(text(child(categories, k))))
    .filter((n): n is number => n != null && n > 0);
  const keywords = child(item, 'keywords');
  const wire: WireListing = {
    domain: text(child(item, 'domain')).toLowerCase(),
    category,
    forsale: flag(text(child(item, 'forsale'))),
    price: amount(text(child(item, 'price'))),
    minprice: amount(text(child(item, 'minprice'))),
    fixedprice: flag(text(child(item, 'fixedprice'))),
    currency: currencyFromCode(text(child(item, 'currency'))),
    domainlanguage: text(child(item, 'domainlanguage')) || null,
  };
  if (child(item, 'inserted') !== undefined) {
    wire.inserted = insertedAt(text(child(item, 'inserted')));
  }
  if (child(item, 'earningscomplete') !== undefined) {
    wire.earningscomplete = amount(text(child(item, 'earningscomplete')));
  }
  if (keywords !== undefined) {
    wire.keywords = list(child(keywords, 'keyword')).map((k) => ({
      keyword: text(child(k, 'keyword')),
      market: text(child(k, 'market')),
      views: int(text(child(k, 'views'))),
      clicks: int(text(child(k, 'clicks'))),
      earnings: amount(text(child(k, 'earnings'))),
      rpm: amount(text(child(k, 'rpm'))),
      inserted: insertedAt(text(child(k, 'inserted'))),
    }));
  }
  return wire;
}

/** A per-name answer to a batch write: `ok`, or a fault code and string. */
export interface WireBatchResult {
  domain: string;
  status: string;
  message: string;
}

export function readBatchResult(item: XmlNode): WireBatchResult {
  return {
    domain: text(child(item, 'domain')).toLowerCase(),
    status: text(child(item, 'status')),
    message: text(child(item, 'message')),
  };
}
