import { describe, expect, it } from 'vitest';
import {
  formatAmountInput,
  formatMoney,
  formatMoneyNumber,
  parseCanonicalAmount,
  parseLocalizedAmount,
  parsePurchaseDate,
  currencyOptions,
} from './money';

describe('formatMoney', () => {
  it('shows a million US dollars with a symbol and two decimals', () => {
    expect(formatMoney('1000000.00', 'USD', 'USD', 'us')).toBe('$1,000,000.00');
  });

  it('adds the code when another currency shares the dollar sign', () => {
    expect(formatMoney('500.00', 'CAD', 'USD', 'us')).toBe('$500.00 CAD');
    expect(formatMoney('500.00', 'USD', 'USD', 'us')).toBe('$500.00');
  });

  it('always includes the code for yen and yuan', () => {
    expect(formatMoney('50000', 'JPY', 'JPY', 'us')).toBe('¥50,000 JPY');
    expect(formatMoney('50000.00', 'CNY', 'CNY', 'us')).toBe('¥50,000.00 CNY');
  });

  it('groups digits in the other number formats', () => {
    expect(formatAmountInput('1234.56', 'EUR', 'eu-dot')).toBe('1.234,56');
    expect(formatAmountInput('1234.56', 'EUR', 'fr')).toBe('1 234,56');
    expect(formatAmountInput('1234.56', 'USD', 'si')).toBe('1 234.56');
    expect(formatAmountInput('1234.56', 'CHF', 'ch')).toBe("1'234.56");
    expect(formatAmountInput('1234.56', 'EUR', 'ch-comma')).toBe("1'234,56");
  });
});

describe('formatMoneyNumber', () => {
  it('writes out the currency’s decimals', () => {
    expect(formatMoneyNumber(45, 'USD', 'USD', 'us')).toBe('$45.00');
    expect(formatMoneyNumber(11.4, 'USD', 'USD', 'us')).toBe('$11.40');
    expect(formatMoneyNumber(1500, 'JPY', 'USD', 'us')).toBe('¥1,500 JPY');
    expect(formatMoneyNumber(1.25, 'KWD', 'USD', 'us')).toBe('KWD1.250');
  });

  it('rounds a float sum rather than cutting it off', () => {
    expect(formatMoneyNumber(0.7 + 0.1, 'USD', 'USD', 'us')).toBe('$0.80');
    expect(formatMoneyNumber(12.999, 'USD', 'USD', 'us')).toBe('$13.00');
  });

  it('follows the number format and shows a shared symbol’s code', () => {
    expect(formatMoneyNumber(1234.5, 'EUR', 'EUR', 'eu-dot')).toBe('€1.234,50');
    expect(formatMoneyNumber(12.99, 'CAD', 'USD', 'us')).toBe('$12.99 CAD');
  });

  it('rounds to whole amounts and signs a loss', () => {
    expect(formatMoneyNumber(1240.5, 'USD', 'USD', 'us', true)).toBe('$1,241');
    expect(formatMoneyNumber(-89.7, 'USD', 'USD', 'us')).toBe('−$89.70');
    expect(formatMoneyNumber(-0.001, 'USD', 'USD', 'us')).toBe('$0.00');
  });
});

describe('parse amounts', () => {
  it('accepts zero and pads to the currency’s decimals', () => {
    expect(parseCanonicalAmount('0', 'USD')).toBe('0.00');
    expect(parseLocalizedAmount('0', 'USD', 'us')).toBe('0.00');
    expect(parseCanonicalAmount('500.123', 'KWD')).toBe('500.123');
    expect(parseCanonicalAmount('50000', 'JPY')).toBe('50000');
  });

  it('rejects negatives and too many decimals', () => {
    expect(() => parseCanonicalAmount('-1', 'USD')).toThrow(/negative/);
    expect(() => parseCanonicalAmount('1.234', 'USD')).toThrow(/2 decimal/);
    expect(() => parseCanonicalAmount('1.5', 'JPY')).toThrow(/no decimal/);
  });

  it('parses each number format back to a plain amount', () => {
    expect(parseLocalizedAmount('1,000,000.00', 'USD', 'us')).toBe(
      '1000000.00',
    );
    expect(parseLocalizedAmount('1.000.000,50', 'EUR', 'eu-dot')).toBe(
      '1000000.50',
    );
    expect(parseLocalizedAmount('1 234,50', 'EUR', 'fr')).toBe('1234.50');
    expect(parseLocalizedAmount("1'234.50", 'USD', 'ch')).toBe('1234.50');
    expect(parseLocalizedAmount('', 'USD', 'us')).toBeNull();
  });
});

describe('dates and currency choices', () => {
  it('accepts a real calendar day', () => {
    expect(parsePurchaseDate('2020-02-29')).toBe('2020-02-29');
    expect(parsePurchaseDate('')).toBeNull();
    expect(() => parsePurchaseDate('2021-02-29')).toThrow(/calendar/);
    expect(() => parsePurchaseDate('03/01/2020')).toThrow(/YYYY-MM-DD/);
  });

  it('leads with the pinned currencies, then the rest by code', () => {
    const codes = currencyOptions().map((c) => c.code);
    expect(codes).toHaveLength(30);
    expect(codes.slice(0, 6)).toEqual([
      'USD',
      'EUR',
      'GBP',
      'CNY',
      'JPY',
      'AUD',
    ]);
    expect(codes.at(-1)).toBe('ZAR');
  });

  it("narrows to a market's currencies, keeping the pinned order", () => {
    expect(currencyOptions(['EUR', 'USD', 'GBP']).map((c) => c.code)).toEqual([
      'USD',
      'EUR',
      'GBP',
    ]);
  });

  it('adds a stored code outside the list at the end, once', () => {
    expect(currencyOptions(undefined, 'TWD').at(-1)?.code).toBe('TWD');
    expect(currencyOptions(undefined, 'USD')).toHaveLength(30);
    expect(currencyOptions(['USD'], 'nope').map((c) => c.code)).toEqual([
      'USD',
    ]);
  });
});
