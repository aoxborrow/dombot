import { describe, expect, it } from 'vitest';
import * as fx from './fixtures';
import {
  amount,
  currencyFromCode,
  encodeForm,
  insertedAt,
  items,
  parseXml,
  readBatchResult,
  readListing,
} from './wire';

describe('encodeForm', () => {
  it('spells nested arrays the way PHP’s http_build_query does', () => {
    const form = new URLSearchParams(
      encodeForm({
        partnerid: 1234,
        output_method: 'xml',
        domainentry: [
          { domain: 'example.com', category: [1, 2], forsale: 1 },
          { domain: 'example.net', category: undefined, forsale: 0 },
        ],
        skipped: null,
        flag: true,
      }),
    );
    expect([...form]).toEqual([
      ['partnerid', '1234'],
      ['output_method', 'xml'],
      ['domainentry[0][domain]', 'example.com'],
      ['domainentry[0][category][0]', '1'],
      ['domainentry[0][category][1]', '2'],
      ['domainentry[0][forsale]', '1'],
      ['domainentry[1][domain]', 'example.net'],
      ['domainentry[1][forsale]', '0'],
      ['flag', '1'],
    ]);
  });
});

describe('values', () => {
  it('reads amounts as canonical decimals, 0 as no price', () => {
    expect(amount('99.99')).toBe('99.99');
    expect(amount('500')).toBe('500');
    expect(amount('500.00')).toBe('500');
    expect(amount('0.94')).toBe('0.94');
    expect(amount('0.00')).toBeNull();
    expect(amount('0')).toBeNull();
    expect(amount('')).toBeNull();
    expect(amount('abc')).toBeNull();
  });

  it('reads currencies as codes or names', () => {
    expect(currencyFromCode('0')).toBe('EUR');
    expect(currencyFromCode('1')).toBe('USD');
    expect(currencyFromCode('2')).toBe('GBP');
    expect(currencyFromCode('EUR')).toBe('EUR');
    expect(() => currencyFromCode('3')).toThrow(/Unknown/);
    expect(() => currencyFromCode('')).toThrow(/Unknown/);
  });

  it('reads insert dates in either documented form', () => {
    expect(insertedAt('989704800')).toBe('2001-05-12T22:00:00Z');
    expect(insertedAt('2012-12-04 15:16:27')).toBe('2012-12-04T15:16:27Z');
    expect(insertedAt('')).toBeNull();
  });
});

describe('parsing the docs’ examples', () => {
  it('reads DomainList items', () => {
    const res = parseXml(fx.domainList);
    expect(res.root).toBe('SEDODOMAINLIST');
    const rows = items(res).map(readListing);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      domain: 'example.com',
      category: [1, 2, 3],
      forsale: true,
      price: '99.99',
      minprice: null,
      fixedprice: true,
      currency: 'USD',
      domainlanguage: 'en',
    });
  });

  it('reads DomainListExtended’s keywords, insert date and earnings', () => {
    const [row] = items(parseXml(fx.domainListExtended)).map(readListing);
    expect(row.inserted).toBe('2001-05-12T22:00:00Z');
    expect(row.earningscomplete).toBe('0.94');
    expect(row.keywords).toEqual([
      {
        keyword: 'Keyword',
        market: 'xyz',
        views: 0,
        clicks: 0,
        earnings: null,
        rpm: null,
        inserted: '2012-12-04T15:16:27Z',
      },
    ]);
  });

  it('reads a single item as a list of one', () => {
    expect(items(parseXml(fx.parkingPayments))).toHaveLength(1);
  });

  it('tolerates the parking example’s mismatched closing tag', () => {
    const [row] = items(parseXml(fx.parkingStats));
    expect(row).toMatchObject({ date: { '#text': '2017-01-01' } });
  });

  it('reads batch results', () => {
    expect(items(parseXml(fx.insertResult)).map(readBatchResult)).toEqual([
      { domain: 'example.com', status: 'ok', message: '' },
      { domain: 'example.net', status: 'ok', message: '' },
    ]);
  });

  it('finds the fault document', () => {
    const res = parseXml(fx.faultOf('E6', 'Wrong password for this username'));
    expect(res.root).toBe('SEDOFAULT');
  });
});
