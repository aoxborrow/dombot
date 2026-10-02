import { describe, expect, it } from 'vitest';
import {
  buildRows,
  guessSetup,
  readTable,
  type ImportContext,
  type ImportSetup,
} from './domain-import';

// Synthetic fixtures: each has its format's real header row with made-up
// example.* names and values. Never copy real exports into the repo.

const ctx: ImportContext = {
  preferredCurrency: 'USD',
  numberFormat: 'us',
  registrars: [
    { id: 'godaddy', displayName: 'GoDaddy' },
    { id: 'dynadot', displayName: 'Dynadot' },
    { id: 'namecheap', displayName: 'Namecheap' },
    { id: 'namecom', displayName: 'Name.com' },
    { id: 'porkbun', displayName: 'Porkbun' },
  ],
  today: '2026-06-15',
};

function run(text: string, change?: (s: ImportSetup) => void) {
  const table = readTable(text);
  const setup = guessSetup(table, ctx);
  change?.(setup);
  return { table, setup, ...buildRows(table, setup, ctx) };
}

const mapped = (r: ReturnType<typeof run>) =>
  Object.fromEntries(
    r.setup.columns
      .map((f, i) => [r.table.headers[i], f] as const)
      .filter(([, f]) => f),
  );

describe('reading a file', () => {
  it('reads a DomBot export back in full', () => {
    const r = run(
      [
        'Domain,IDN,Status,Folder,Registrar,Account,Created,Expires,Auto-renew,Renewal price,Renewal currency,Renewal estimate,Renewal estimate currency,Asking price,Minimum offer,Floor price,Asking currency,Purchase type,Purchase date,Purchase amount,Purchase currency,Purchase years,Sale date,Sale amount,Sale currency,TLD,Days until expiry,Renewal date,Locked,Privacy,Nameservers,Registrar status,Last synced,Notes',
        'xn--mnich-kva.de,münich.de,Owned,Premium,Dynadot,Dynadot,2020-01-01,2027-01-01,Yes,9.00,EUR,9.00,EUR,2500.00,500.00,,EUR,Registered,2024-03-15,1500,JPY,2,,,,de,200,,Yes,No,ns1.example.net,active,2026-06-01,"\'=hand reg, lucky"',
        'example.org,,Sold,,,,,,,,,,,,,,,Purchased,2019-11-02,85.00,USD,,2025-01-02,999.00,EUR,org,,,,,,,,',
      ].join('\r\n'),
    );
    expect(r.setup.format?.id).toBe('dombot');
    expect(r.issues).toEqual([]);
    expect(r.rows).toEqual([
      {
        line: 2,
        domain: 'xn--mnich-kva.de',
        status: 'owned',
        folder: 'Premium',
        notes: '=hand reg, lucky',
        registration: {
          registrar: 'dynadot',
          createdDate: '2020-01-01',
          expirationDate: '2027-01-01',
          autoRenew: true,
        },
        renewal: { amount: '9.00', currency: 'EUR' },
        asking: { amount: '2500.00', minOffer: '500.00', currency: 'EUR' },
        purchase: {
          type: 'registered',
          date: '2024-03-15',
          amount: '1500',
          currency: 'JPY',
          years: 2,
        },
      },
      {
        line: 3,
        domain: 'example.org',
        status: 'sold',
        purchase: {
          type: 'purchased',
          date: '2019-11-02',
          amount: '85.00',
          currency: 'USD',
        },
        sale: { date: '2025-01-02', amount: '999.00', currency: 'EUR' },
      },
    ]);
  });

  it('reads the purchase sample from PR #122, Currency applying to the row', () => {
    const r = run(
      [
        'Domain,Purchase date,Purchase amount,Currency,Notes',
        'example.com,2024-03-15,12.99,USD,"Hand registered, GoDaddy"',
        'shop.example,2019-11-02,5000,JPY,Yen has no decimal places',
        'notes.example,,,,"Date and price unknown"',
      ].join('\n'),
    );
    expect(r.issues).toEqual([]);
    expect(r.rows.map((x) => [x.domain, x.purchase, x.notes])).toEqual([
      [
        'example.com',
        { date: '2024-03-15', amount: '12.99', currency: 'USD' },
        'Hand registered, GoDaddy',
      ],
      [
        'shop.example',
        { date: '2019-11-02', amount: '5000', currency: 'JPY' },
        'Yen has no decimal places',
      ],
      ['notes.example', undefined, 'Date and price unknown'],
    ]);
  });

  it("reads the previous app's template: one Currency for every price", () => {
    const r = run(
      [
        'Domain,Price,Floor Price,Allow Offers,Min Offer,Allow Installments,Max Installments,Currency,Headline,Description,Show in Portfolio,Contact Email,Custom Buy Url,Custom Buy Label,Custom Contact Url,Custom Contact Label,GA Tag,Redirect URL,Purchase Date,Purchase Price,Renewal Price,Sold Date,Sold Price,Sold Net,Notes',
        'example.net,10000,8000,1,5000,1,60,USD,"{domain} is for sale!",Pitch,1,someone@example.com,,,,,,,2014-01-01,8.95,9.95,,,,"Some notes."',
        'example.org,,,,,,,EUR,,,,,,,,,,,2014-01-01,8.95,9.95,2021-09-01,5000,4000.89,"Sold via escrow."',
      ].join('\n'),
    );
    expect(mapped(r)).toEqual({
      Domain: 'domain',
      Price: 'askingPrice',
      'Floor Price': 'floorPrice',
      'Min Offer': 'minOffer',
      Currency: 'currency',
      'Purchase Date': 'purchaseDate',
      'Purchase Price': 'purchaseAmount',
      'Renewal Price': 'renewalPrice',
      'Sold Date': 'saleDate',
      'Sold Price': 'saleAmount',
      Notes: 'notes',
    });
    expect(r.rows[0].asking).toEqual({
      amount: '10000.00',
      minOffer: '5000.00',
      floor: '8000.00',
      currency: 'USD',
    });
    expect(r.rows[1]).toMatchObject({
      renewal: { amount: '9.95', currency: 'EUR' },
      purchase: { amount: '8.95', currency: 'EUR' },
      sale: { date: '2021-09-01', amount: '5000.00', currency: 'EUR' },
    });
  });

  it('reads a GoDaddy export, at GoDaddy, and never reads contact columns', () => {
    const r = run(
      [
        'Domain Name,International Domain Name,TLD,Create Date,Ownership Date,Expiration Date,Lock,Auto-renew,Status,Renewal Price,Nameservers,Forwarding URL,Privacy,Estimated Value,Valuation Wholesale Amount,Profile Name,Cashparking,Expiration Protection,FolderMemberships,ListingStatus,Privacy Level,Protection Plan,Registrant First Name,Registrant Email',
        'example.com,,.COM,2014-01-26,2020-09-07,2022-01-26,Locked,On,Expired,$ 18.99,ns1.example.net,,On,$1200,$300,,,,Brandables;Keep,,,,Pat,pat@example.com',
      ].join('\n'),
    );
    expect(r.setup.format?.id).toBe('godaddy');
    expect(r.setup.defaults.registrar).toBe('godaddy');
    expect(Object.values(mapped(r))).not.toContain('status');
    expect(mapped(r)['Registrant Email']).toBeUndefined();
    expect(r.rows[0]).toMatchObject({
      folder: 'Brandables',
      registration: {
        registrar: 'godaddy',
        createdDate: '2014-01-26',
        expirationDate: '2022-01-26',
        autoRenew: true,
      },
      renewal: { amount: '18.99', currency: 'USD' },
    });
  });

  it('reads a Dynadot export: BOM, local times, a second Registration Date', () => {
    const r = run(
      '﻿' +
        [
          'Domain,Renewal Status,Punycode,Expiration Date,Expiration Date Timestamp,Name Server,Locked,Privacy,Registration Date,Registration Date,Folder,Admin Email,Domain Note',
          'example.io,auto renew,,2021/11/24 11:43 PST,1637783035000,NS: ns1.example.net,yes,full,2020/11/24 11:43 PST,1606247035000,(no folder),privacy@example.com,""',
          'example.dev,do not renew,,2022/05/02 07:31 PST,1651501884000,,yes,full,2021/05/02 07:31 PST,1619965884000,Keepers,privacy@example.com,"Renew in May"',
        ].join('\n'),
    );
    expect(r.setup.format?.id).toBe('dynadot');
    expect(
      r.rows.map((x) => [x.domain, x.registration, x.folder, x.notes]),
    ).toEqual([
      [
        'example.io',
        {
          registrar: 'dynadot',
          createdDate: '2020-11-24',
          expirationDate: '2021-11-24',
          autoRenew: true,
        },
        undefined,
        undefined,
      ],
      [
        'example.dev',
        {
          registrar: 'dynadot',
          createdDate: '2021-05-02',
          expirationDate: '2022-05-02',
          autoRenew: false,
        },
        'Keepers',
        'Renew in May',
      ],
    ]);
  });

  it('reads Namecheap month names and ON/OFF', () => {
    const r = run(
      [
        'Domain Name,Domain privacy protection status,Domain status at NC,Domain auto-renew status,Domain expiration date',
        'example.com,ON,Active,OFF,Dec 13 2021',
      ].join('\n'),
    );
    expect(r.rows[0].registration).toEqual({
      registrar: 'namecheap',
      expirationDate: '2021-12-13',
      autoRenew: false,
    });
  });

  it('reads a semicolon Sedo export with its legal registrar name', () => {
    const r = run(
      [
        'Domain name;Language;Currency;Price;Minimum Offer;Price Option;Master Category;Domain Name (ACE);Inserted;Currency;Registrar;SedoMLS Status',
        '"example.io";;"USD";1850;;"Buy Now (2)";;"example.io";"2020-08-27";"USD";"Name.com, Inc.";"SedoMLS Active"',
      ].join('\n'),
    );
    expect(r.setup.format?.id).toBe('sedo');
    expect(r.rows[0]).toMatchObject({
      asking: { amount: '1850.00', currency: 'USD' },
      registration: { registrar: 'namecom' },
    });
  });

  it('reads park.io orders as purchases, Amount in USD', () => {
    const r = run(
      [
        '"Order ID",Domain,"Created Date","Paid Date","Amount (USD)","Expiration Date","On park.io"',
        '80393,example.io,"2021-07-27 16:21:10","2021-07-29 10:45:10",99,2022-07-29,1',
      ].join('\n'),
      (s) => (s.defaults.currency = 'EUR'),
    );
    expect(r.rows[0]).toMatchObject({
      purchase: {
        type: 'purchased',
        date: '2021-07-29',
        amount: '99.00',
        currency: 'USD',
      },
      registration: { expirationDate: '2022-07-29' },
    });
    expect(r.rows[0].registration?.createdDate).toBeUndefined();
  });

  it('reads Efty, where 0.00 means not set', () => {
    const r = run(
      [
        'Domain,"Purchase price","Purchase date","Renewal fee",Status,"Sold date","Sold price",Category,"Landing Page theme","BIN Price","Payment Platform","Minimum offer",Premium,Description,"Efty market"',
        'example.io,0.00,06-29-2021,0.00,portfolio,,0.00,,fresh,999.99,,0.00,no,"Pitch",yes',
        'example.co,40.00,01-02-2020,0.00,sold,03-04-2022,2500.00,,fresh,0.00,,0.00,no,,no',
      ].join('\n'),
    );
    expect(r.rows[0]).toEqual({
      line: 2,
      domain: 'example.io',
      status: 'owned',
      asking: { amount: '999.99', currency: 'USD' },
      purchase: { date: '2021-06-29' },
    });
    expect(r.rows[1]).toMatchObject({
      status: 'sold',
      purchase: { date: '2020-01-02', amount: '40.00' },
      sale: { date: '2022-03-04', amount: '2500.00' },
    });
  });

  it('reads Afternic listings, a Dan export with a title row, and Uniregistry instructions', () => {
    const afternic = run(
      [
        '*Name (Required),*Minimum Offer (Required),Reserve Price,Floor Price,Buy Now Price,Top Category,Second-Level Category,Leave Blank,Leave Blank,Leave Blank,Listing Status,Listing Page,GROUPNAME',
        'example.io,1000.00,0.00,0.00,18250.00,Reference,Uncategorized,,"",,2,1,DEFAULT',
      ].join('\n'),
    );
    expect(afternic.rows[0].asking).toEqual({
      amount: '18250.00',
      minOffer: '1000.00',
      currency: 'USD',
    });

    const dan = run(
      [
        'example_with_prices,,,,',
        'Domain name,Buy now price,Starting offer,Description,',
        'example.com,100,75,My description,',
      ].join('\n'),
    );
    expect(dan.table.headers).toEqual([
      'Domain name',
      'Buy now price',
      'Starting offer',
      'Description',
    ]);
    expect(dan.rows[0].asking).toMatchObject({
      amount: '100.00',
      minOffer: '75.00',
    });

    const uni = run(
      [
        'domain,price,for_sale',
        'How to use this file:',
        '1) Take note of and delete these instructions.',
        'example.com,5000,true',
      ].join('\n'),
    );
    expect(uni.issues).toEqual([]);
    expect(uni.skipped).toBe(2);
    expect(uni.rows.map((x) => x.domain)).toEqual(['example.com']);
  });

  it('reads a plain list of names with no header', () => {
    const r = run('example.com\nExample.NET\n\nexample.org\n');
    expect(r.table.headerless).toBe(true);
    expect(r.rows.map((x) => x.domain)).toEqual([
      'example.com',
      'example.net',
      'example.org',
    ]);
  });
});

describe('rows', () => {
  it('merges rows for one name cell by cell and says where they disagree', () => {
    const r = run(
      [
        'Domain,Purchase date,Purchase amount,Sale date,Sale amount,Notes',
        'example.com,2020-01-01,100,,,first',
        'EXAMPLE.com,,,2024-05-01,900,second',
      ].join('\n'),
    );
    expect(r.merged).toBe(1);
    expect(r.rows).toEqual([
      {
        line: 2,
        domain: 'example.com',
        notes: 'second',
        purchase: { date: '2020-01-01', amount: '100.00', currency: 'USD' },
        sale: { date: '2024-05-01', amount: '900.00', currency: 'USD' },
      },
    ]);
    expect(r.issues).toEqual([
      {
        line: 3,
        domain: 'example.com',
        level: 'warning',
        message: 'Rows 2 and 3 disagree on notes; using row 3.',
      },
    ]);
  });

  it('reports a bad row and keeps the rest', () => {
    const r = run(
      [
        'Domain,Purchase amount,Currency,Asking price,Minimum offer',
        'www.example.com,10,USD,,',
        'example.com,10.5,JPY,,',
        'example.net,-5,USD,,',
        'example.org,,USD,100,500',
        ',25,USD,,',
        'good.example,10,USD,,',
      ].join('\n'),
    );
    expect(r.rows.map((x) => x.domain)).toEqual(['good.example']);
    expect(r.issues.map((i) => [i.line, i.message])).toEqual([
      [2, 'www.example.com is a subdomain. Did you mean example.com?'],
      [3, 'Purchase amount: JPY 10.5: JPY has no decimal places.'],
      [4, 'Purchase amount: -5 is negative.'],
      [5, 'The minimum offer is above the asking price.'],
      [6, 'The Domain cell is empty.'],
    ]);
  });

  it('refuses an amount whose currency disagrees with its column', () => {
    const r = run(
      ['Domain,Purchase amount,Purchase currency', 'example.com,€5,USD'].join(
        '\n',
      ),
    );
    expect(r.issues[0].message).toBe(
      'Purchase amount: the amount says EUR, the row says USD.',
    );
  });

  it("refuses an amount whose currency disagrees with the row's Currency or the header", () => {
    const row = run(
      ['Domain,Purchase amount,Currency', 'example.com,$10,EUR'].join('\n'),
    );
    expect(row.issues[0].message).toBe(
      'Purchase amount: the amount says USD, the row says EUR.',
    );
    const header = run(
      ['Domain,Purchase amount (USD)', 'example.com,€10'].join('\n'),
    );
    expect(header.issues[0].message).toBe(
      'Purchase amount: the amount says EUR, the row says USD.',
    );
  });

  it("reads a bare $ as the row's dollar currency", () => {
    const r = run(
      ['Domain,Purchase amount,Currency', 'example.com,$10,CAD'].join('\n'),
    );
    expect(r.issues).toEqual([]);
    expect(r.rows[0].purchase).toMatchObject({
      amount: '10.00',
      currency: 'CAD',
    });
  });

  it('reads day-first dates when the column says so, and asks when it cannot tell', () => {
    const told = run(
      [
        'Domain,Purchase date',
        'a.example,25/12/2023',
        'b.example,03/04/2024',
      ].join('\n'),
    );
    expect(told.setup.dateOrder).toBe('dmy');
    expect(told.rows[1].purchase?.date).toBe('2024-04-03');
    const unsure = run(
      ['Domain,Purchase date', 'a.example,03/04/2024'].join('\n'),
    );
    expect(unsure.setup.datesAmbiguous).toBe(true);
    expect(unsure.setup.dateOrder).toBe('mdy');
  });

  it('applies values for every row', () => {
    const r = run('example.com\nexample.net', (s) => {
      s.defaults.registrar = 'Epik';
      s.defaults.folder = 'Imported';
      s.defaults.purchaseType = 'registered';
    });
    expect(r.rows[0]).toEqual({
      line: 1,
      domain: 'example.com',
      folder: 'Imported',
      registration: { registrarLabel: 'Epik' },
    });
  });

  it('warns about a sale before its purchase, and dates in the future', () => {
    const r = run(
      [
        'Domain,Purchase date,Sale date',
        'example.com,2030-01-01,2020-01-01',
      ].join('\n'),
    );
    expect(r.issues.map((i) => i.message)).toEqual([
      'The sale date is before the purchase date.',
      'The purchase date is in the future.',
    ]);
  });
});

describe('the template', () => {
  it('imports cleanly, as DomBot CSV', async () => {
    const { domainsCsvTemplate } = await import('./domain-csv');
    const r = run(domainsCsvTemplate());
    expect(r.issues).toEqual([]);
    expect(r.rows.map((x) => [x.domain, x.status])).toEqual([
      ['example.com', 'owned'],
      ['example.net', 'owned'],
      ['example.org', 'sold'],
    ]);
    expect(r.rows[1].asking).toEqual({
      amount: '4800.00',
      minOffer: '1500.00',
      floor: '2500.00',
      currency: 'USD',
    });
  });
});
