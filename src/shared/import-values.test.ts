import { describe, expect, it } from 'vitest';
import {
  detectDateOrder,
  fitAmount,
  hasAmbiguousDates,
  readBoolean,
  readCurrency,
  readDate,
  readDomain,
  readMoney,
  readPurchaseType,
  readRegistrar,
  readStatus,
  readYears,
} from './import-values';

describe('readDomain', () => {
  it.each([
    ['Example.COM', 'example.com'],
    [' https://example.com/path ', 'example.com'],
    ['example.com.', 'example.com'],
    ['Münich.de', 'xn--mnich-kva.de'],
    ['xn--mnich-kva.de', 'xn--mnich-kva.de'],
    ['example.co.uk', 'example.co.uk'],
    ['', null],
  ])('%j → %j', (raw, key) => {
    expect(readDomain(raw)).toBe(key);
  });

  it('refuses a subdomain, naming the registrable domain', () => {
    expect(() => readDomain('www.example.com')).toThrow(
      'www.example.com is a subdomain. Did you mean example.com?',
    );
  });

  it('refuses what is not a domain', () => {
    expect(() => readDomain('How to use this file:')).toThrow(
      'is not a domain name',
    );
  });
});

describe('readMoney', () => {
  it.each([
    ['1250', '1250', null],
    ['$1,250.50', '1250.50', 'USD'],
    ['$ 18.99', '18.99', 'USD'],
    ['1.250,00 €', '1250.00', 'EUR'],
    ['€500', '500', 'EUR'],
    ['500 EUR', '500', 'EUR'],
    ['usd 99', '99', 'USD'],
    ['1 234,56', '1234.56', null],
    ["1'234.56", '1234.56', null],
    ['1,250', '1250', null],
    ['1.5', '1.5', null],
    ['12,5', '12.5', null],
    ['1,000,000', '1000000', null],
    ['£12', '12', 'GBP'],
    ['C$ 20', '20', 'CAD'],
  ])('%j → %j %j', (raw, value, currency) => {
    expect(readMoney(raw, 'USD')).toEqual({ value, currency });
  });

  it('reads a bare $ as your dollar currency, else USD', () => {
    expect(readMoney('$10', 'CAD')?.currency).toBe('CAD');
    expect(readMoney('$10', 'EUR')?.currency).toBe('USD');
  });

  it('reads zero and blank as no amount', () => {
    expect(readMoney('0.00', 'USD')).toBeNull();
    expect(readMoney('$0', 'USD')).toBeNull();
    expect(readMoney('  ', 'USD')).toBeNull();
  });

  it.each(['-5', '(100)', '$-20', 'abc', '¥500', '€5 USD'])(
    'refuses %j',
    (raw) => {
      expect(() => readMoney(raw, 'USD')).toThrow();
    },
  );
});

describe('fitAmount', () => {
  it('fits the currency, dropping trailing zeros but never rounding', () => {
    expect(fitAmount('12.5', 'USD')).toBe('12.50');
    expect(fitAmount('5000.00', 'JPY')).toBe('5000');
    expect(fitAmount('1.234', 'KWD')).toBe('1.234');
    expect(() => fitAmount('500.50', 'JPY')).toThrow('no decimal places');
    expect(() => fitAmount('1.999', 'USD')).toThrow('2 decimal places');
  });
});

describe('readCurrency', () => {
  it.each([
    ['usd', 'USD'],
    ['€', 'EUR'],
    ['euro', 'EUR'],
    ['Pounds', 'GBP'],
    ['yen', 'JPY'],
  ])('%j → %j', (raw, code) => {
    expect(readCurrency(raw, 'USD')).toBe(code);
  });
  it('refuses an unknown currency', () => {
    expect(() => readCurrency('bitcoin', 'USD')).toThrow('Unknown currency');
  });
});

describe('dates', () => {
  it.each([
    ['2024-03-15', '2024-03-15'],
    ['2021/11/24 11:43 PST', '2021-11-24'],
    ['2021-07-27 16:21:10', '2021-07-27'],
    ['2024-03-15T23:30:00-08:00', '2024-03-15'],
    ['Dec 13 2021', '2021-12-13'],
    ['December 3, 2021', '2021-12-03'],
    ['13 Dec 2021', '2021-12-13'],
    ['06-29-2021', '2021-06-29'],
    ['1637783035000', '2021-11-24'],
    ['', null],
  ])('%j → %j', (raw, day) => {
    expect(readDate(raw)).toBe(day);
  });

  it('reads day/month order as told', () => {
    expect(readDate('03/04/2024', 'mdy')).toBe('2024-03-04');
    expect(readDate('03/04/2024', 'dmy')).toBe('2024-04-03');
    expect(readDate('15.03.2024', 'dmy')).toBe('2024-03-15');
  });

  it('detects the order from a column', () => {
    expect(detectDateOrder(['03/04/2024', '25/12/2023'])).toBe('dmy');
    expect(detectDateOrder(['03/04/2024', '12/25/2023'])).toBe('mdy');
    expect(detectDateOrder(['03/04/2024'])).toBeNull();
    expect(hasAmbiguousDates(['03/04/2024', '2024-01-01'])).toBe(true);
    expect(hasAmbiguousDates(['2024-01-01'])).toBe(false);
  });

  it('refuses impossible and out-of-range dates', () => {
    expect(() => readDate('2024-02-30')).toThrow('not a real calendar day');
    expect(() => readDate('1970-01-01')).toThrow('out of range');
    expect(() => readDate('soon')).toThrow('is not a date');
  });
});

describe('words', () => {
  it('reads yes and no, including registrar renewal words', () => {
    for (const yes of ['Yes', 'TRUE', '1', 'on', 'auto renew', '✓'])
      expect(readBoolean(yes)).toBe(true);
    for (const no of ['no', 'False', '0', 'OFF', 'do not renew'])
      expect(readBoolean(no)).toBe(false);
    expect(readBoolean('')).toBeNull();
    expect(() => readBoolean('maybe')).toThrow();
  });

  it('reads ownership status words', () => {
    expect(readStatus('Owned')).toBe('owned');
    expect(readStatus('portfolio')).toBe('owned');
    expect(readStatus('in_account')).toBe('owned');
    expect(readStatus('SOLD')).toBe('sold');
    expect(readStatus('Expired')).toBe('dropped');
    expect(readStatus('Removed')).toBe('removed');
    expect(() => readStatus('ACTIVE clientTransferProhibited')).toThrow();
  });

  it('reads purchase types and years', () => {
    expect(readPurchaseType('Hand registered')).toBe('registered');
    expect(readPurchaseType('backorder')).toBe('purchased');
    expect(readYears('2')).toBe(2);
    expect(readYears('3 years')).toBe(3);
    expect(() => readYears('0')).toThrow();
  });
});

describe('readRegistrar', () => {
  const known = [
    { id: 'godaddy', displayName: 'GoDaddy' },
    { id: 'dynadot', displayName: 'Dynadot' },
    { id: 'namecom', displayName: 'Name.com' },
    { id: 'namecheap', displayName: 'Namecheap' },
    { id: 'gandi', displayName: 'Gandi.net' },
  ];
  it.each([
    ['GoDaddy.com, LLC', 'godaddy'],
    ['Dynadot LLC', 'dynadot'],
    ['Name.com, Inc.', 'namecom'],
    ['NameCheap, Inc.', 'namecheap'],
    ['gandi', 'gandi'],
    ['Gandi SAS', 'gandi'],
    ['godaddy.com', 'godaddy'],
  ])('%j → %j', (raw, id) => {
    expect(readRegistrar(raw, known)).toEqual({ id });
  });
  it('keeps an unknown registrar as text', () => {
    expect(readRegistrar('Epik', known)).toEqual({ label: 'Epik' });
  });
});
