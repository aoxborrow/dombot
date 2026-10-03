import { getDomain } from 'tldts';
import {
  CURRENCIES,
  isCurrencyCode,
  toCurrencyCode,
  type CurrencyCode,
} from './currencies';
import { isDomainKey, toAscii } from './domain-name';

// Reading the values real files hold (docs/domain-import-export.md,
// "Values"): every spelling a registrar, marketplace, or spreadsheet writes,
// turned into the one form DomBot stores. Each reader throws an Error whose
// message is shown on the row; blank always reads as null ("keep").

// ── domains ─────────────────────────────────────────────────────────────────

/**
 * A domain cell as its ASCII key. Takes Unicode or punycode, any case, a
 * scheme, a path, or a trailing dot. A subdomain is an error that names the
 * registrable domain, so `www.example.com` doesn't become a name of its own.
 */
export function readDomain(raw: string): string | null {
  const cell = raw.trim().replace(/^["']+|["']+$/g, '');
  if (!cell) return null;
  const key = toAscii(
    cell.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, ''),
  );
  if (!isDomainKey(key)) throw new Error(`“${cell}” is not a domain name.`);
  const registrable = getDomain(key);
  if (registrable && registrable !== key) {
    throw new Error(`${key} is a subdomain. Did you mean ${registrable}?`);
  }
  return key;
}

/** True when a cell looks like a domain name (for spotting a header-less list). */
export function looksLikeDomain(raw: string): boolean {
  try {
    return readDomain(raw) !== null;
  } catch {
    return false;
  }
}

// ── currencies ──────────────────────────────────────────────────────────────

/** Symbols that name one currency. `$` and `¥` are handled apart: they're shared. */
const SYMBOLS: Record<string, CurrencyCode> = {
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '₩': 'KRW',
  '₽': 'RUB',
  '₺': 'TRY',
  '₪': 'ILS',
  '₦': 'NGN',
  '₱': 'PHP',
  '฿': 'THB',
  '₫': 'VND',
  '₴': 'UAH',
  zł: 'PLN',
  R$: 'BRL',
  C$: 'CAD',
  CA$: 'CAD',
  A$: 'AUD',
  AU$: 'AUD',
  NZ$: 'NZD',
  HK$: 'HKD',
  S$: 'SGD',
  US$: 'USD',
  MX$: 'MXN',
};

const SYMBOL_ORDER = [...Object.keys(SYMBOLS), '$', '¥', '￥'].sort(
  (a, b) => b.length - a.length,
);

const NAMES: Record<string, CurrencyCode> = {
  euro: 'EUR',
  euros: 'EUR',
  pound: 'GBP',
  pounds: 'GBP',
  sterling: 'GBP',
  yen: 'JPY',
  yuan: 'CNY',
  renminbi: 'CNY',
  rupee: 'INR',
  rupees: 'INR',
  'us dollar': 'USD',
  'us dollars': 'USD',
  'canadian dollar': 'CAD',
  'australian dollar': 'AUD',
  franc: 'CHF',
  'swiss franc': 'CHF',
};

/** Currencies written with a bare `$`. */
const DOLLARS: ReadonlySet<string> = new Set([
  'USD',
  'CAD',
  'AUD',
  'NZD',
  'HKD',
  'SGD',
  'MXN',
  'TWD',
]);

/** How a bare `$` reads: your preferred currency when it's a dollar, else USD. */
export function dollarFor(preferred: string): CurrencyCode {
  const code = toCurrencyCode(preferred);
  return code && DOLLARS.has(code) ? code : 'USD';
}

/** A currency cell: an ISO code, a symbol, or an English name. */
export function readCurrency(
  raw: string,
  preferred: string,
): CurrencyCode | null {
  const cell = raw.trim();
  if (!cell) return null;
  const code = toCurrencyCode(cell);
  if (code) return code;
  if (SYMBOLS[cell]) return SYMBOLS[cell];
  if (cell === '$') return dollarFor(preferred);
  const name = cell.toLowerCase().replace(/\s+/g, ' ');
  if (NAMES[name]) return NAMES[name];
  if (name === 'dollar' || name === 'dollars') return dollarFor(preferred);
  throw new Error(`Unknown currency ${cell}.`);
}

// ── money ───────────────────────────────────────────────────────────────────

export interface MoneyCell {
  /** Digits and an optional period, not yet fitted to a currency. */
  value: string;
  /** The currency the cell named itself, if it did. */
  currency: CurrencyCode | null;
}

/**
 * A money cell: digits with any grouping and either decimal mark, and a
 * currency symbol or code before or after. When both `.` and `,` appear,
 * the last is the decimal mark; a single one followed by exactly three
 * digits is grouping. Negative amounts are errors. Zero is kept: it clears
 * the stored amount, where a blank cell leaves it alone.
 */
export function readMoney(raw: string, preferred: string): MoneyCell | null {
  let s = raw.trim();
  if (!s) return null;
  if (/^\(.*\)$/.test(s) || /^-|-$|^[^\d]*-/.test(s)) {
    throw new Error(`${s} is negative.`);
  }
  let currency: CurrencyCode | null = null;
  const code = /^([A-Za-z]{3})\s*|\s*([A-Za-z]{3})$/.exec(s);
  if (code) {
    const found = toCurrencyCode(code[1] ?? code[2]);
    if (found) {
      currency = found;
      s = s.replace(code[0], '');
    }
  }
  s = s.trim();
  // The longest symbol first, so "US$" wins over "$".
  for (const sym of SYMBOL_ORDER) {
    const at = s.startsWith(sym) ? 'start' : s.endsWith(sym) ? 'end' : null;
    if (!at) continue;
    if (sym === '¥' || sym === '￥') {
      throw new Error(`${raw.trim()}: ¥ could be yen or yuan. Add the code.`);
    }
    const named = SYMBOLS[sym] ?? dollarFor(preferred);
    if (currency && currency !== named)
      throw new Error(`${raw.trim()} names two currencies.`);
    currency = named;
    s = at === 'start' ? s.slice(sym.length) : s.slice(0, -sym.length);
    break;
  }
  s = s.replace(/[\s\u00a0\u202f']/g, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) {
    throw new Error(`${raw.trim()} is not an amount.`);
  }
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimalMark: string | null = null;
  if (lastDot !== -1 && lastComma !== -1) {
    decimalMark = lastDot > lastComma ? '.' : ',';
  } else if (lastDot !== -1 || lastComma !== -1) {
    const mark = lastDot !== -1 ? '.' : ',';
    const count = s.split(mark).length - 1;
    const after = s.length - s.lastIndexOf(mark) - 1;
    decimalMark = count === 1 && after !== 3 ? mark : null;
  }
  let int = s;
  let frac = '';
  if (decimalMark) {
    const at = s.lastIndexOf(decimalMark);
    int = s.slice(0, at);
    frac = s.slice(at + 1);
  }
  int = int.replace(/[.,]/g, '');
  if (!/^\d*$/.test(int) || !/^\d*$/.test(frac)) {
    throw new Error(`${raw.trim()} is not an amount.`);
  }
  const value = `${int.replace(/^0+(?=\d)/, '') || '0'}${frac ? `.${frac}` : ''}`;
  return { value, currency };
}

/**
 * An amount fitted to its currency's decimal places, in stored form.
 * Trailing zeros past them are dropped; any other extra digit is an error,
 * since money is never rounded.
 */
export function fitAmount(value: string, currency: CurrencyCode): string {
  const places = CURRENCIES[currency];
  const [int, rawFrac = ''] = value.split('.');
  let frac = rawFrac;
  while (frac.length > places && frac.endsWith('0')) frac = frac.slice(0, -1);
  if (frac.length > places) {
    throw new Error(
      `${currency} ${value}: ${currency} ${
        places === 0 ? 'has no decimal places' : `uses ${places} decimal places`
      }.`,
    );
  }
  return places === 0 ? int : `${int}.${frac.padEnd(places, '0')}`;
}

// ── dates ───────────────────────────────────────────────────────────────────

export type DateOrder = 'mdy' | 'dmy';

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

const NUMERIC_DAY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/;

/**
 * Which order a column's `12/03/2024`-style dates are in: day first when a
 * first part is over 12, month first when a second part is; null when no
 * value tells (or the column contradicts itself).
 */
export function detectDateOrder(values: string[]): DateOrder | null {
  let dmy = false;
  let mdy = false;
  for (const v of values) {
    const m = NUMERIC_DAY.exec(v.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  return dmy === mdy ? null : dmy ? 'dmy' : 'mdy';
}

/** True when a column has `12/03/2024`-style dates no value disambiguates. */
export function hasAmbiguousDates(values: string[]): boolean {
  return (
    values.some((v) => NUMERIC_DAY.test(v.trim())) &&
    detectDateOrder(values) === null
  );
}

function ymd(year: number, month: number, day: number): string {
  if (year < 100) year += year < 70 ? 2000 : 1900;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new Error('not a real calendar day');
  }
  if (year < 1985 || year > 2100) throw new Error('the year is out of range');
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthIndex(name: string): number {
  const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return i === -1 ? 0 : i + 1;
}

/**
 * A date cell as `YYYY-MM-DD`, the date as written (a time or zone after it
 * is ignored, never converted). `order` decides `03/04/2024`.
 */
export function readDate(raw: string, order: DateOrder = 'mdy'): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    // Epoch seconds or milliseconds (Dynadot's timestamp columns).
    if (/^\d{10}$|^\d{13}$/.test(s)) {
      const ms = s.length === 10 ? Number(s) * 1000 : Number(s);
      const d = new Date(ms);
      return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(s);
    if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
    m = NUMERIC_DAY.exec(s);
    if (m) {
      const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
      return order === 'dmy' ? ymd(y, b, a) : ymd(y, a, b);
    }
    // "Dec 13 2021", "December 13, 2021"
    m = /^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(s);
    if (m && monthIndex(m[1]))
      return ymd(Number(m[3]), monthIndex(m[1]), Number(m[2]));
    // "13 Dec 2021", "13-Dec-2021"
    m = /^(\d{1,2})[\s-]+([A-Za-z]{3,})\.?[\s-]+(\d{4})\b/.exec(s);
    if (m && monthIndex(m[2]))
      return ymd(Number(m[3]), monthIndex(m[2]), Number(m[1]));
  } catch (err) {
    throw new Error(
      `${s}: ${err instanceof Error ? err.message : 'bad date'}.`,
    );
  }
  throw new Error(`${s} is not a date.`);
}

// ── words ───────────────────────────────────────────────────────────────────

const word = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9✓✔✗✘]/g, '');

const YES = new Set([
  'yes',
  'y',
  'true',
  't',
  '1',
  'on',
  'enabled',
  'enable',
  'active',
  'autorenew',
  'autorenewal',
  'renew',
  '✓',
  '✔',
]);
const NO = new Set([
  'no',
  'n',
  'false',
  'f',
  '0',
  'off',
  'disabled',
  'disable',
  'inactive',
  'donotrenew',
  'dontrenew',
  'norenew',
  'manual',
  'manualrenew',
  'expire',
  '✗',
  '✘',
]);

/** A yes/no cell, including the words registrars use for auto-renew. */
export function readBoolean(raw: string): boolean | null {
  const w = word(raw);
  if (!w) return null;
  if (YES.has(w)) return true;
  if (NO.has(w)) return false;
  throw new Error(`${raw.trim()} isn't yes or no.`);
}

export type ImportStatus =
  'owned' | 'sold' | 'dropped' | 'archived' | 'removed';

const STATUS_WORDS: Record<string, ImportStatus> = {
  owned: 'owned',
  own: 'owned',
  active: 'owned',
  portfolio: 'owned',
  held: 'owned',
  inaccount: 'owned',
  sold: 'sold',
  dropped: 'dropped',
  deleted: 'dropped',
  expired: 'dropped',
  lapsed: 'dropped',
  released: 'dropped',
  archived: 'archived',
  removed: 'removed',
};

/** An ownership status word, or null when the cell isn't one. */
export function statusWord(raw: string): ImportStatus | null {
  return STATUS_WORDS[word(raw)] ?? null;
}

export function readStatus(raw: string): ImportStatus | null {
  if (!raw.trim()) return null;
  const status = statusWord(raw);
  if (!status) throw new Error(`${raw.trim()} isn't a status DomBot knows.`);
  return status;
}

const PURCHASE_TYPES: Record<string, 'registered' | 'purchased'> = {
  registered: 'registered',
  registration: 'registered',
  register: 'registered',
  handregistered: 'registered',
  handregistration: 'registered',
  handreg: 'registered',
  reg: 'registered',
  new: 'registered',
  purchased: 'purchased',
  purchase: 'purchased',
  bought: 'purchased',
  aftermarket: 'purchased',
  marketplace: 'purchased',
  auction: 'purchased',
  backorder: 'purchased',
  dropcatch: 'purchased',
  private: 'purchased',
  privatesale: 'purchased',
};

export function readPurchaseType(
  raw: string,
): 'registered' | 'purchased' | null {
  const w = word(raw);
  if (!w) return null;
  const type = PURCHASE_TYPES[w];
  if (!type) throw new Error(`${raw.trim()} isn't Registered or Purchased.`);
  return type;
}

/** A whole number of years, 1 to 10. */
export function readYears(raw: string): number | null {
  const s = raw.trim().replace(/\s*(years?|yrs?|y)$/i, '');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 10)
    throw new Error(`${raw.trim()} isn't a number of years.`);
  return n;
}

// ── registrars ──────────────────────────────────────────────────────────────

export interface RegistrarName {
  id: string;
  displayName: string;
}

const COMPANY =
  /\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|company|sa|sas|ag|bv|plc|pty|srl|sl)\b/g;

function registrarKeys(raw: string): string[] {
  const lower = raw.toLowerCase().replace(COMPANY, ' ');
  const whole = lower.replace(/[^a-z0-9]/g, '');
  const noTld = lower
    .replace(/\.(com|net|org|io|co|biz|info|us|eu|ca)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
  return [...new Set([whole, noTld])].filter(Boolean);
}

/**
 * A registrar cell as one DomBot knows (its id), matched on the id, display
 * name, website, or legal name ("GoDaddy.com, LLC", "Dynadot LLC");
 * anything else is kept as free text.
 */
export function readRegistrar(
  raw: string,
  known: RegistrarName[],
): { id: string } | { label: string } | null {
  const cell = raw.trim();
  if (!cell) return null;
  const keys = registrarKeys(cell);
  for (const r of known) {
    const theirs = new Set([
      ...registrarKeys(r.id),
      ...registrarKeys(r.displayName),
    ]);
    if (keys.some((k) => theirs.has(k))) return { id: r.id };
  }
  return { label: cell.slice(0, 100) };
}

/** True when `code` is a currency DomBot records. */
export const isImportCurrency = isCurrencyCode;
