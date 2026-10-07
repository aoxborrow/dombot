import { describe, expect, it } from 'vitest';
import { parseCsv, unguardCell } from './csv';
import {
  DOMAIN_CSV_HEADERS,
  domainsToCsv,
  domainsCsvFilename,
  domainsCsvTemplate,
  type DomainCsvContext,
} from './domain-csv';
import { HIDDEN_FOLDER_ID, type Domain, type Folder } from './ipc';

const NOW = new Date('2026-06-15T12:00:00Z').getTime();

function domain(partial: Partial<Domain> & { domainName: string }): Domain {
  return {
    registrar: 'dynadot',
    status: 'active',
    createdDate: null,
    expirationDate: null,
    renewalDate: null,
    autoRenew: false,
    locked: false,
    privacy: false,
    nameservers: [],
    syncedAt: new Date('2026-06-01T00:00:00Z'),
    deleted: false,
    source: 'registrar',
    ...partial,
  };
}

function ctx(partial: Partial<DomainCsvContext> = {}): DomainCsvContext {
  return {
    registrarLabels: { dynadot: 'Dynadot', godaddy: 'GoDaddy' },
    folders: [],
    assignments: {},
    purchases: {},
    listPrices: {},
    pricing: {},
    manualPrices: {},
    archiveLabel: () => null,
    accountName: (d) => (d.registrar === 'godaddy' ? 'GoDaddy #2' : 'Dynadot'),
    now: NOW,
    ...partial,
  };
}

/** The file as header → value maps, one per data row. */
function read(csv: string): Record<string, string>[] {
  const [headers, ...rows] = parseCsv(csv);
  return rows.map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, unguardCell(r[i])])),
  );
}

describe('domainsToCsv', () => {
  it('writes the canonical headers, in order', () => {
    expect(parseCsv(domainsToCsv([], ctx()))[0]).toEqual(DOMAIN_CSV_HEADERS);
    expect(DOMAIN_CSV_HEADERS[0]).toBe('Domain');
    expect(DOMAIN_CSV_HEADERS.at(-1)).toBe('Notes');
  });

  it('writes registrar data for a synced name', () => {
    const [row] = read(
      domainsToCsv(
        [
          domain({
            domainName: 'Example.COM',
            createdDate: new Date('2020-01-01'),
            expirationDate: new Date(NOW + 30 * 86_400_000),
            renewalDate: new Date('2027-01-01'),
            autoRenew: true,
            locked: true,
            nameservers: ['ns1.example.net', 'ns2.example.net'],
          }),
        ],
        ctx({
          pricing: {
            'dynadot:Example.COM': {
              domain: 'example.com',
              registrar: 'dynadot',
              renewal: 12.5,
              currency: 'USD',
              source: 'base',
            },
          },
        }),
      ),
    );
    expect(row).toMatchObject({
      Domain: 'example.com',
      IDN: '',
      Status: 'Owned',
      Registrar: 'Dynadot',
      Account: 'Dynadot',
      Created: '2020-01-01',
      'Auto-renew': 'Yes',
      'Renewal price': '',
      'Renewal estimate': '12.50',
      'Renewal estimate currency': 'USD',
      TLD: 'com',
      'Days until expiry': '30',
      Locked: 'Yes',
      Privacy: 'No',
      Nameservers: 'ns1.example.net; ns2.example.net',
      'Registrar status': 'active',
      'Last synced': '2026-06-01',
    });
  });

  it("writes the money: your prices, the latest holding, and the name's note", () => {
    const [row] = read(
      domainsToCsv(
        [domain({ domainName: 'münich.de' })],
        ctx({
          purchases: {
            'xn--mnich-kva.de': {
              purchaseDate: '2024-03-15',
              amount: '1500',
              currency: 'JPY',
              purchaseType: 'registered',
              purchaseYears: 2,
              notes: '=not a formula',
              saleDate: '2025-01-02',
              saleAmount: '999.00',
              saleCurrency: 'EUR',
            },
          },
          listPrices: {
            'xn--mnich-kva.de': {
              amount: '2500',
              minOffer: '500',
              currency: 'EUR',
              updatedAt: 1,
            },
          },
          manualPrices: {
            'xn--mnich-kva.de': { amount: '9.00', currency: 'EUR' },
          },
        }),
      ),
    );
    expect(row).toMatchObject({
      Domain: 'xn--mnich-kva.de',
      IDN: 'münich.de',
      'Renewal price': '9.00',
      'Renewal currency': 'EUR',
      Price: '2500',
      'Min offer': '500',
      'Floor price': '',
      'Price currency': 'EUR',
      'Purchase type': 'Registered',
      'Purchase date': '2024-03-15',
      'Purchase amount': '1500',
      'Purchase currency': 'JPY',
      'Purchase years': '2',
      'Sale date': '2025-01-02',
      'Sale amount': '999.00',
      'Sale currency': 'EUR',
      Notes: '=not a formula',
    });
  });

  it('writes the ownership status and the folder by name', () => {
    const folders = [{ id: 'f1', name: 'Premium' } as Folder];
    const rows = read(
      domainsToCsv(
        [
          domain({ domainName: 'a.com' }),
          domain({ domainName: 'b.com' }),
          domain({ domainName: 'c.com', departed: true }),
        ],
        ctx({
          folders,
          assignments: { 'a.com': 'f1', 'b.com': HIDDEN_FOLDER_ID },
          archiveLabel: (name) => (name === 'c.com' ? 'sold' : null),
          manualPrices: { 'c.com': { amount: '12.00', currency: 'USD' } },
        }),
      ),
    );
    expect(rows.map((r) => [r.Status, r.Folder])).toEqual([
      ['Owned', 'Premium'],
      ['Owned', 'Hidden'],
      ['Sold', ''],
    ]);
    // A name no account holds has no registrar-reported values.
    // Your renewal price is kept, so the file imports back the same.
    expect(rows[2]).toMatchObject({
      'Renewal price': '12.00',
      'Renewal currency': 'USD',
      Account: '',
      'Auto-renew': '',
      Locked: '',
      'Last synced': '',
    });
  });

  it('writes one row for a name two accounts hold, from the latest sync', () => {
    const rows = read(
      domainsToCsv(
        [
          domain({ domainName: 'a.com', status: 'old' }),
          domain({
            domainName: 'A.com',
            registrar: 'godaddy',
            status: 'new',
            syncedAt: new Date('2026-06-10T00:00:00Z'),
          }),
        ],
        ctx(),
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      Registrar: 'GoDaddy',
      'Registrar status': 'new',
      Account: 'Dynadot; GoDaddy #2',
    });
  });

  it("leaves privacy blank where the registrar doesn't report it", () => {
    const [row] = read(
      domainsToCsv(
        [domain({ domainName: 'a.com', registrar: '101domain' })],
        ctx(),
      ),
    );
    expect(row).toMatchObject({ Locked: 'No', Privacy: '' });
  });

  it('writes a manual name: its own registrar, "Manual", no registrar-only values', () => {
    const [row] = read(
      domainsToCsv(
        [
          {
            ...domain({ domainName: 'example.net', registrar: '' }),
            source: 'manual',
            manualRegistrarLabel: 'Epik',
            autoRenewUnknown: true,
            expirationDate: new Date(NOW + 10 * 86_400_000),
          },
        ],
        ctx(),
      ),
    );
    expect(row).toMatchObject({
      Registrar: 'Epik',
      Account: 'Manual',
      'Auto-renew': '',
      'Days until expiry': '10',
      Locked: '',
      Privacy: '',
      'Registrar status': '',
      'Last synced': '',
    });
  });

  it('names the file by day', () => {
    expect(domainsCsvFilename(new Date(NOW))).toBe(
      'dombot-domains-2026-06-15.csv',
    );
  });
});

describe('domainsCsvTemplate', () => {
  it('has the importable columns and three example rows', () => {
    const [headers, ...rows] = parseCsv(domainsCsvTemplate());
    expect(headers).toContain('Price');
    expect(headers).not.toContain('Renewal estimate');
    expect(headers).not.toContain('Last synced');
    expect(rows.map((r) => r[0])).toEqual([
      'example.com',
      'example.net',
      'example.org',
    ]);
  });
});
