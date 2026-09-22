import { describe, expect, it } from 'vitest';
import {
  formatAmountInput,
  formatMoney,
  parseCanonicalAmount,
  parseLocalizedAmount,
  parsePurchaseDate,
  searchCurrencies,
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

describe('dates and currency search', () => {
  it('accepts a real calendar day', () => {
    expect(parsePurchaseDate('2020-02-29')).toBe('2020-02-29');
    expect(parsePurchaseDate('')).toBeNull();
    expect(() => parsePurchaseDate('2021-02-29')).toThrow(/calendar/);
    expect(() => parsePurchaseDate('03/01/2020')).toThrow(/YYYY-MM-DD/);
  });

  it('leads with the pinned currencies and searches by code or name', () => {
    expect(
      searchCurrencies('')
        .slice(0, 5)
        .map((c) => c.code),
    ).toEqual(['USD', 'EUR', 'GBP', 'CNY', 'JPY']);
    expect(searchCurrencies('US').some((c) => c.code === 'USD')).toBe(true);
    expect(searchCurrencies('yen').map((c) => c.code)).toContain('JPY');
    expect(searchCurrencies('yuan').map((c) => c.code)).toContain('CNY');
  });
});
