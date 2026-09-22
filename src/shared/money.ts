/**
 * Currency codes, symbols, and the on-screen number formats. Amounts are
 * stored as a plain decimal string plus an ISO 4217 code — never converted.
 */

export const NUMBER_FORMATS = [
  { id: 'us', label: '1,234.56', group: ',', decimal: '.' },
  { id: 'eu-dot', label: '1.234,56', group: '.', decimal: ',' },
  { id: 'fr', label: '1 234,56', group: ' ', decimal: ',' },
  { id: 'si', label: '1 234.56', group: ' ', decimal: '.' },
  { id: 'ch', label: "1'234.56", group: "'", decimal: '.' },
  { id: 'ch-comma', label: "1'234,56", group: "'", decimal: ',' },
] as const;

export type NumberFormatId = (typeof NUMBER_FORMATS)[number]['id'];

export const DEFAULT_NUMBER_FORMAT: NumberFormatId = 'us';
export const DEFAULT_CURRENCY = 'USD';

/** Shown first in the picker until the user types a search. */
export const PINNED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'JPY'] as const;

/** Yen and yuan share ¥ and always keep the code, even when preferred. */
const ALWAYS_SHOW_CODE = new Set(['JPY', 'CNY']);

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

let cached: CurrencyInfo[] | null = null;
let symbolOwners: Map<string, Set<string>> | null = null;

function currencyCodes(): string[] {
  try {
    return Intl.supportedValuesOf('currency');
  } catch {
    return [...PINNED_CURRENCIES];
  }
}

function symbolOf(code: string): string {
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

function decimalsOf(code: string): number {
  try {
    return (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency: code,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

export function currencies(): CurrencyInfo[] {
  if (cached) return cached;
  const names = new Intl.DisplayNames(['en'], { type: 'currency' });
  cached = currencyCodes().map((code) => ({
    code,
    name: names.of(code) ?? code,
    symbol: symbolOf(code),
    decimals: decimalsOf(code),
  }));
  symbolOwners = new Map();
  for (const c of cached) {
    const set = symbolOwners.get(c.symbol) ?? new Set<string>();
    set.add(c.code);
    symbolOwners.set(c.symbol, set);
  }
  return cached;
}

export function currencyInfo(code: string): CurrencyInfo | null {
  const upper = code.trim().toUpperCase();
  return currencies().find((c) => c.code === upper) ?? null;
}

export function isIsoCurrency(code: unknown): code is string {
  return typeof code === 'string' && currencyInfo(code) !== null;
}

export function isNumberFormatId(id: unknown): id is NumberFormatId {
  return typeof id === 'string' && NUMBER_FORMATS.some((f) => f.id === id);
}

export function numberFormatOf(id: NumberFormatId) {
  return NUMBER_FORMATS.find((f) => f.id === id) ?? NUMBER_FORMATS[0];
}

/**
 * Currencies matching a search. An empty query leads with USD, EUR, GBP,
 * CNY, and JPY. Otherwise the code or an English name word must start with
 * the query ("US" → USD, "yen" → JPY, "yuan" → CNY).
 */
export function searchCurrencies(query: string): CurrencyInfo[] {
  const all = currencies();
  const q = query.trim().toLowerCase();
  if (!q) {
    const pinned = PINNED_CURRENCIES.map((code) =>
      all.find((c) => c.code === code),
    ).filter((c): c is CurrencyInfo => c != null);
    const rest = all
      .filter(
        (c) =>
          !PINNED_CURRENCIES.includes(
            c.code as (typeof PINNED_CURRENCIES)[number],
          ),
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    return [...pinned, ...rest];
  }
  return all
    .filter((c) => {
      if (c.code.toLowerCase().startsWith(q)) return true;
      return c.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((word) => word.startsWith(q));
    })
    .sort((a, b) => {
      const aCode = a.code.toLowerCase().startsWith(q) ? 0 : 1;
      const bCode = b.code.toLowerCase().startsWith(q) ? 0 : 1;
      return aCode - bCode || a.code.localeCompare(b.code);
    });
}

function groupDigits(intPart: string, group: string): string {
  if (!group) return intPart;
  const parts: string[] = [];
  for (let i = intPart.length; i > 0; i -= 3) {
    parts.unshift(intPart.slice(Math.max(0, i - 3), i));
  }
  return parts.join(group);
}

/** On-screen digits for a stored amount, without a currency symbol. */
export function formatAmountInput(
  canonical: string,
  currency: string,
  formatId: NumberFormatId,
): string {
  const info = currencyInfo(currency);
  const decimals = info?.decimals ?? 2;
  const format = numberFormatOf(formatId);
  const [intRaw, fracRaw = ''] = canonical.split('.');
  const intPart = intRaw.replace(/^0+(?=\d)/, '') || '0';
  const grouped = groupDigits(intPart, format.group);
  if (decimals === 0) return grouped;
  const frac = fracRaw.padEnd(decimals, '0').slice(0, decimals);
  return grouped + format.decimal + frac;
}

/**
 * Symbol when this is the preferred currency. Another currency that uses the
 * same symbol also gets its code. Yen and yuan always include the code.
 */
export function formatMoney(
  canonical: string,
  currency: string,
  preferred: string,
  formatId: NumberFormatId,
): string {
  const info = currencyInfo(currency);
  const code = (info?.code ?? currency).toUpperCase();
  const number = formatAmountInput(canonical, code, formatId);
  const symbol = info?.symbol ?? '';
  const owners = symbol ? (symbolOwners?.get(symbol)?.size ?? 1) : 1;
  const showCode =
    ALWAYS_SHOW_CODE.has(code) ||
    (owners > 1 && code !== preferred.trim().toUpperCase());
  const body = symbol ? `${symbol}${number}` : number;
  return showCode ? `${body} ${code}` : body;
}

/**
 * Parse a stored amount: digits, an optional period, and no thousands
 * separators. Empty clears the amount. `$0` is allowed; negatives are not.
 * Fraction digits must fit the currency (USD 2, JPY 0, KWD 3).
 */
export function parseCanonicalAmount(
  raw: string,
  currency: string,
): string | null {
  const s = raw.trim();
  if (!s) return null;
  const info = currencyInfo(currency);
  if (!info)
    throw new Error(`Unknown currency ${currency.trim().toUpperCase()}.`);
  if (s.startsWith('-')) throw new Error("Purchase amount can't be negative.");
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error('Purchase amount must be a plain number.');
  }
  const [intRaw, frac = ''] = s.split('.');
  if (frac.length > info.decimals) {
    const places =
      info.decimals === 0
        ? 'no decimal places'
        : `${info.decimals} decimal place${info.decimals === 1 ? '' : 's'}`;
    throw new Error(`${info.code} uses ${places}.`);
  }
  const intPart = intRaw.replace(/^0+(?=\d)/, '') || '0';
  if (info.decimals === 0) return intPart;
  return `${intPart}.${frac.padEnd(info.decimals, '0')}`;
}

/** Parse an amount typed in the user's number format. Empty clears it. */
export function parseLocalizedAmount(
  raw: string,
  currency: string,
  formatId: NumberFormatId,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const format = numberFormatOf(formatId);
  let s = trimmed;
  if (format.group === ' ') s = s.replace(/[ \u00a0\u202f]/g, '');
  else if (format.group) s = s.split(format.group).join('');
  if (format.decimal !== '.') {
    const mark = s.indexOf(format.decimal);
    if (mark !== -1) {
      s = s.slice(0, mark) + '.' + s.slice(mark + format.decimal.length);
    }
  }
  return parseCanonicalAmount(s, currency);
}

/** Calendar date `YYYY-MM-DD`, or null when blank. `label` is the field name in errors. */
export function parsePurchaseDate(
  raw: string,
  label = 'Purchase date',
): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`${label} must be YYYY-MM-DD.`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new Error(`${label} is not a real calendar day.`);
  }
  return s;
}

/** Key purchase records by the domain name, not the registrar account. */
export function purchaseKey(domainName: string): string {
  return domainName.trim().replace(/\.$/, '').toLowerCase();
}

export function assertDomainName(domainName: string): string {
  const key = purchaseKey(domainName);
  if (!key.includes('.') || /\s/.test(key) || key.length > 253) {
    throw new Error(`“${domainName.trim() || 'row'}” is not a domain name.`);
  }
  return key;
}
