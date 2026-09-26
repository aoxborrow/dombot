import { describe, expect, it } from 'vitest';
import { parsePurchaseCsv } from './purchase-csv';

describe('parsePurchaseCsv', () => {
  it('reads the export columns and skips rows with nothing filled in', () => {
    const text = [
      'Domain,Purchase date,Purchase amount,Currency,Notes',
      'example.com,2020-01-02,1000000.00,USD,"bought, early"',
      'empty.com,,,,',
      'notes-only.com,,,,"just a note"',
    ].join('\n');
    const parsed = parsePurchaseCsv(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.skipped).toBe(1);
    expect(parsed.rows).toEqual([
      {
        domainName: 'example.com',
        purchaseDate: '2020-01-02',
        amount: '1000000.00',
        currency: 'USD',
        notes: 'bought, early',
      },
      {
        domainName: 'notes-only.com',
        purchaseDate: null,
        amount: null,
        currency: null,
        notes: 'just a note',
      },
    ]);
  });

  it('uses the preferred currency when the amount has no code', () => {
    const parsed = parsePurchaseCsv(
      'Domain,Purchase amount\nshop.co.uk,12.50\n',
      'GBP',
    );
    expect(parsed.rows[0]).toMatchObject({
      domainName: 'shop.co.uk',
      amount: '12.50',
      currency: 'GBP',
    });
  });

  it('reports a bad row and still keeps the good ones', () => {
    const parsed = parsePurchaseCsv(
      'Domain,Purchase amount,Currency\nbad.com,-5,USD\nok.com,0,EUR\n',
    );
    expect(parsed.rows.map((r) => r.domainName)).toEqual(['ok.com']);
    expect(parsed.errors[0]).toMatch(/bad.com/);
  });

  it('ignores the other columns of a full domain export', () => {
    const parsed = parsePurchaseCsv(
      'Domain,Registrar,Purchase date,Purchase amount,Currency,Notes\na.com,Dynadot,2019-05-01,10.00,USD,\n',
    );
    expect(parsed.rows[0].purchaseDate).toBe('2019-05-01');
    expect(parsed.errors).toEqual([]);
  });
});
