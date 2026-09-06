import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HIDDEN_FOLDER_ID, type Domain, type Folder } from '../../shared/ipc';
import { csvFilename, domainsToCsv } from './csv';

const NOW = new Date('2026-06-15T12:00:00Z');

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
    ...partial,
  };
}

const folder = (id: string, name: string): Folder =>
  ({ id, name, color: 'blue' }) as Folder;

// The CSV is CRLF-joined; split back into logical rows, then split a row into
// fields with a tiny RFC-4180-aware parser (enough for these fixtures).
const rows = (csv: string) => csv.split('\r\n');
function fields(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQ) {
      if (ch === '"' && row[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const col = (csv: string, rowIdx: number, header: string) => {
  const headers = fields(rows(csv)[0]);
  return fields(rows(csv)[rowIdx])[headers.indexOf(header)];
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('domainsToCsv', () => {
  it('emits the header row first, in column order', () => {
    const csv = domainsToCsv([], {}, [], {});
    expect(fields(rows(csv)[0])).toEqual([
      'Domain', 'TLD', 'Registrar', 'Folder', 'Status', 'Created', 'Expires',
      'Days Until Expiry', 'Renewal Date', 'Auto Renew', 'Locked', 'Privacy',
      'Nameservers', 'Last Synced',
    ]);
  });

  it('formats a fully-populated row', () => {
    const d = domain({
      domainName: 'example.com',
      status: 'active',
      createdDate: new Date('2020-01-01'),
      expirationDate: new Date(NOW.getTime() + 30 * 86_400_000),
      renewalDate: new Date('2027-01-01'),
      autoRenew: true,
      locked: true,
      privacy: false,
      nameservers: ['ns1.example.net', 'ns2.example.net'],
    });
    const csv = domainsToCsv([d], { dynadot: 'Dynadot' }, [], {});

    expect(col(csv, 1, 'TLD')).toBe('com');
    expect(col(csv, 1, 'Registrar')).toBe('Dynadot');
    expect(col(csv, 1, 'Days Until Expiry')).toBe('30');
    expect(col(csv, 1, 'Auto Renew')).toBe('Yes');
    expect(col(csv, 1, 'Locked')).toBe('Yes');
    expect(col(csv, 1, 'Privacy')).toBe('No');
    expect(col(csv, 1, 'Nameservers')).toBe('ns1.example.net; ns2.example.net');
    expect(col(csv, 1, 'Created')).toBe('2020-01-01');
  });

  it('leaves date columns blank for null dates', () => {
    const d = domain({ domainName: 'x.com', createdDate: null, expirationDate: null });
    const csv = domainsToCsv([d], {}, [], {});
    expect(col(csv, 1, 'Created')).toBe('');
    expect(col(csv, 1, 'Expires')).toBe('');
    expect(col(csv, 1, 'Days Until Expiry')).toBe('');
  });

  it('falls back to the raw registrar id when there is no label', () => {
    const d = domain({ domainName: 'x.com', registrar: 'porkbun' });
    expect(col(domainsToCsv([d], {}, [], {}), 1, 'Registrar')).toBe('porkbun');
  });

  it('resolves folder names, Hidden, and blanks for unassigned/missing', () => {
    const a = domain({ domainName: 'a.com' });
    const h = domain({ domainName: 'h.com' });
    const g = domain({ domainName: 'g.com' }); // assigned to a gone folder
    const u = domain({ domainName: 'u.com' }); // unassigned
    const folders = [folder('f1', 'Clients')];
    const assignments = {
      'dynadot:a.com': 'f1',
      'dynadot:h.com': HIDDEN_FOLDER_ID,
      'dynadot:g.com': 'gone',
    };
    const csv = domainsToCsv([a, h, g, u], {}, folders, assignments);
    expect(col(csv, 1, 'Folder')).toBe('Clients');
    expect(col(csv, 2, 'Folder')).toBe('Hidden');
    expect(col(csv, 3, 'Folder')).toBe('');
    expect(col(csv, 4, 'Folder')).toBe('');
  });

  it('quotes fields containing commas, quotes, or newlines (RFC 4180)', () => {
    const d = domain({ domainName: 'x.com', status: 'a,"b"\nc' });
    const csv = domainsToCsv([d], {}, [], {});
    // Round-trips back to the original value through the parser.
    expect(col(csv, 1, 'Status')).toBe('a,"b"\nc');
    // And the raw line actually contains the escaped form.
    expect(csv).toContain('"a,""b""\nc"');
  });
});

describe('csvFilename', () => {
  it('is dombot-domains-<today>.csv', () => {
    expect(csvFilename()).toBe('dombot-domains-2026-06-15.csv');
  });
});
