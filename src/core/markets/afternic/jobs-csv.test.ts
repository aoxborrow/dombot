import { describe, expect, it } from 'vitest';
import { JOB_COLUMNS, parseJobResults, toJobCsv } from './jobs-csv';

const HEADER = JOB_COLUMNS.join(',');

describe('toJobCsv', () => {
  it('writes the template header and leaves unset settings blank', () => {
    expect(toJobCsv([{ name: 'example.com', buyNow: 2500 }])).toBe(
      `${HEADER}\r\nexample.com,2500,,,,,,,,,\r\n`,
    );
  });

  it('writes every setting the template carries', () => {
    const csv = toJobCsv([
      {
        name: 'example.com',
        displayName: 'Example.com',
        buyNow: null,
        floor: 900,
        minOffer: 100,
        leasingEnabled: true,
        maxLeasePeriod: 24,
        landingPage: 'SALES_TYPE',
        intakeStyle: 'CUSTOM_LANDER',
        showLanderBuynowOption: true,
        showLanderLeaseToOwnOption: false,
        showLanderMakeOfferOption: true,
        hidden: false,
      },
      { name: 'example.net', landingPage: 'PARKING_TYPE' },
      { name: 'example.org', intakeStyle: 'PRICE_FORM' },
      { name: 'example.io', intakeStyle: 'BUYNOW' },
    ]);
    expect(csv.split('\r\n').slice(1, -1)).toEqual([
      'Example.com,0,900,100,Y,24,Custom Lander,Y,N,Y,N',
      'example.net,,,,,,Cashparking,,,,',
      'example.org,,,,,,Request Price,,,,',
      'example.io,,,,,,Buy It Now,,,,',
    ]);
  });

  it('rejects what the template or the API cannot take', () => {
    expect(() => toJobCsv([{ name: 'example.com', featured: true }])).toThrow(
      /featured/,
    );
    expect(() =>
      toJobCsv([{ name: 'example.com', landingPage: 'SALES_TYPE' }]),
    ).toThrow(/lander style/);
    expect(() =>
      toJobCsv([
        {
          name: 'example.com',
          landingPage: 'PARKING_TYPE',
          intakeStyle: 'BUYNOW',
        },
      ]),
    ).toThrow(/parking page/);
    expect(() =>
      toJobCsv([{ name: 'example.com', displayName: 'Other.com' }]),
    ).toThrow(/same name/);
    expect(() => toJobCsv([{ name: 'example.com', minOffer: 5 }])).toThrow(
      /at least \$20/,
    );
  });
});

describe('parseJobResults', () => {
  it('reads the live format, byte-order mark and all', () => {
    const text =
      'operation,domain,result,errorMessage\n' +
      '\uFEFFUPDATE_OR_ADD,example.com,NO_CHANGE,\n' +
      'UPDATE_OR_ADD,Example.NET,UPDATE_PROCESSED,\n' +
      "UPDATE_OR_ADD,not a domain,FAILED,domain : failed validation on 'domainNameFormat' condition\n" +
      'UPDATE_OR_ADD,example.org,FAILED,failed to parse buynowprice: abc\n';
    expect(parseJobResults(text)).toEqual([
      {
        name: 'example.com',
        operation: 'UPDATE_OR_ADD',
        result: 'NO_CHANGE',
        ok: true,
        error: null,
      },
      {
        name: 'example.net',
        operation: 'UPDATE_OR_ADD',
        result: 'UPDATE_PROCESSED',
        ok: true,
        error: null,
      },
      {
        name: 'not a domain',
        operation: 'UPDATE_OR_ADD',
        result: 'FAILED',
        ok: false,
        error: "domain : failed validation on 'domainNameFormat' condition",
      },
      {
        name: 'example.org',
        operation: 'UPDATE_OR_ADD',
        result: 'FAILED',
        ok: false,
        error: 'failed to parse buynowprice: abc',
      },
    ]);
  });

  it('treats an error message as a failure whatever the result says', () => {
    const [row] = parseJobResults(
      'operation,domain,result,errorMessage\nUPDATE_OR_ADD,example.com,ADDED,price too low\n',
    );
    expect(row.ok).toBe(false);
  });

  it('refuses a file without the columns', () => {
    expect(() => parseJobResults('foo,bar\n1,2\n')).toThrow(/columns/);
    expect(parseJobResults('operation,domain,result,errorMessage\n')).toEqual(
      [],
    );
  });
});
