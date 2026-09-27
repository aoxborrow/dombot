import { describe, expect, it } from 'vitest';
import {
  CURRENCY_CODES,
  WITHDRAWN_CURRENCIES,
  currencyDecimals,
  isCurrencyCode,
  toCurrencyCode,
} from './currencies';
import { currencyInfo, parseCanonicalAmount, searchCurrencies } from './money';

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

  it('drives money.ts: known codes, decimals, and withdrawn codes last', () => {
    expect(currencyInfo('hrk')?.decimals).toBe(2);
    expect(currencyInfo('XAU')).toBeNull();
    expect(parseCanonicalAmount('1500', 'JPY')).toBe('1500');
    expect(() => parseCanonicalAmount('1.5', 'JPY')).toThrow(/no decimal/);
    const order = searchCurrencies('').map((c) => c.code);
    const firstWithdrawn = order.findIndex((c) => WITHDRAWN_CURRENCIES.has(c));
    expect(
      order.slice(firstWithdrawn).every((c) => WITHDRAWN_CURRENCIES.has(c)),
    ).toBe(true);
  });
});
