/**
 * Every currency an amount can be recorded in, with its ISO 4217 decimal
 * places (minor units). A fixed list rather than `Intl.supportedValuesOf`, so
 * Electron, browsers, and the Worker all accept exactly the same codes and
 * agree on how many decimals each takes. Display names and symbols still come
 * from `Intl` (money.ts); they don't affect what's stored.
 *
 * National currencies only: fund codes (BOV, CHE, …), precious metals (XAU,
 * …), and testing codes (XTS, XXX) aren't money you pay for a domain in.
 */
// prettier-ignore
export const CURRENCIES = {
  AED: 2, AFN: 2, ALL: 2, AMD: 2, AOA: 2, ARS: 2, AUD: 2, AWG: 2, AZN: 2,
  BAM: 2, BBD: 2, BDT: 2, BHD: 3, BIF: 0, BMD: 2, BND: 2, BOB: 2, BRL: 2,
  BSD: 2, BTN: 2, BWP: 2, BYN: 2, BZD: 2, CAD: 2, CDF: 2, CHF: 2, CLP: 0,
  CNY: 2, COP: 2, CRC: 2, CUP: 2, CVE: 2, CZK: 2, DJF: 0, DKK: 2, DOP: 2,
  DZD: 2, EGP: 2, ERN: 2, ETB: 2, EUR: 2, FJD: 2, FKP: 2, GBP: 2, GEL: 2,
  GHS: 2, GIP: 2, GMD: 2, GNF: 0, GTQ: 2, GYD: 2, HKD: 2, HNL: 2, HTG: 2,
  HUF: 2, IDR: 2, ILS: 2, INR: 2, IQD: 3, IRR: 2, ISK: 0, JMD: 2, JOD: 3,
  JPY: 0, KES: 2, KGS: 2, KHR: 2, KMF: 0, KPW: 2, KRW: 0, KWD: 3, KYD: 2,
  KZT: 2, LAK: 2, LBP: 2, LKR: 2, LRD: 2, LSL: 2, LYD: 3, MAD: 2, MDL: 2,
  MGA: 2, MKD: 2, MMK: 2, MNT: 2, MOP: 2, MRU: 2, MUR: 2, MVR: 2, MWK: 2,
  MXN: 2, MYR: 2, MZN: 2, NAD: 2, NGN: 2, NIO: 2, NOK: 2, NPR: 2, NZD: 2,
  OMR: 3, PAB: 2, PEN: 2, PGK: 2, PHP: 2, PKR: 2, PLN: 2, PYG: 0, QAR: 2,
  RON: 2, RSD: 2, RUB: 2, RWF: 0, SAR: 2, SBD: 2, SCR: 2, SDG: 2, SEK: 2,
  SGD: 2, SHP: 2, SLE: 2, SOS: 2, SRD: 2, SSP: 2, STN: 2, SVC: 2, SYP: 2,
  SZL: 2, THB: 2, TJS: 2, TMT: 2, TND: 3, TOP: 2, TRY: 2, TTD: 2, TWD: 2,
  TZS: 2, UAH: 2, UGX: 0, USD: 2, UYU: 2, UZS: 2, VED: 2, VES: 2, VND: 0,
  VUV: 0, WST: 2, XAF: 0, XCD: 2, XCG: 2, XOF: 0, XPF: 0, YER: 2, ZAR: 2,
  ZMW: 2, ZWG: 2,
  // Withdrawn recently, kept so a purchase recorded in one stays valid.
  ANG: 2, BGN: 2, CUC: 2, HRK: 2, SLL: 2, ZWL: 2,
} as const satisfies Record<string, number>;

export type CurrencyCode = keyof typeof CURRENCIES;

/** Codes no longer issued. Still valid on a record; the picker lists them last. */
export const WITHDRAWN_CURRENCIES: ReadonlySet<CurrencyCode> = new Set([
  'ANG',
  'BGN',
  'CUC',
  'HRK',
  'SLL',
  'ZWL',
]);

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.hasOwn(CURRENCIES, value);
}

/** The code in canonical form ("usd " → "USD"), or null when not listed. */
export function toCurrencyCode(value: string): CurrencyCode | null {
  const code = value.trim().toUpperCase();
  return isCurrencyCode(code) ? code : null;
}

/** How many decimal places an amount in this currency carries. */
export function currencyDecimals(code: CurrencyCode): number {
  return CURRENCIES[code];
}
