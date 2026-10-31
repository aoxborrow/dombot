import { describe, expect, it } from 'vitest';
import {
  CURRENCY_CODES,
  RATE_CURRENCIES,
  WITHDRAWN_CURRENCIES,
  currencyDecimals,
  isCurrencyCode,
  toCurrencyCode,
  toEntryCurrency,
} from './currencies';
import { currencyInfo, parseCanonicalAmount } from './money';

describe('currencies', () => {
  it('lists national currencies with their ISO decimal places', () => {
    expect(currencyDecimals('USD')).toBe(2);
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('KWD')).toBe(3);
    expect(CURRENCY_CODES.length).toBeGreaterThan(150);
    for (const notMoney of ['XAU', 'XTS', 'XXX', 'CHE', 'BOV'])
      expect(isCurrencyCode(notMoney)).toBe(false);
  });

  it('normalizes a typed code', () => {
    expect(toCurrencyCode(' eur ')).toBe('EUR');
    expect(toCurrencyCode('nope')).toBeNull();
  });

  it('drives money.ts: known codes and decimals', () => {
    expect(currencyInfo('hrk')?.decimals).toBe(2);
    expect(currencyInfo('XAU')).toBeNull();
    expect(parseCanonicalAmount('1500', 'JPY')).toBe('1500');
    expect(() => parseCanonicalAmount('1.5', 'JPY')).toThrow(/no decimal/);
  });

  it('enters one of the 30, or a record’s own currency left as it was', () => {
    expect(toEntryCurrency(' eur ')).toBe('EUR');
    expect(toEntryCurrency('')).toBeNull();
    expect(toEntryCurrency(null)).toBeNull();
    expect(() => toEntryCurrency('nope')).toThrow('Unknown currency NOPE.');
    expect(() => toEntryCurrency('TWD')).toThrow("DomBot can't convert TWD.");
    expect(() => toEntryCurrency('TWD', 'KES')).toThrow(/convert TWD/);
    expect(toEntryCurrency('twd', 'TWD')).toBe('TWD');
  });

  it('picks from the 30 the ECB quotes, all of them stored codes', () => {
    expect(RATE_CURRENCIES).toHaveLength(30);
    expect(RATE_CURRENCIES.every((c) => isCurrencyCode(c))).toBe(true);
    expect(RATE_CURRENCIES.some((c) => WITHDRAWN_CURRENCIES.has(c))).toBe(
      false,
    );
  });
});
