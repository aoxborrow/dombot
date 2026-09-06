import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Domain } from '@aoxborrow/registrar-client';
import { HIDDEN_FOLDER_ID, STALE_AFTER_MS } from '../../shared/ipc';
import {
  DEFAULT_LIMIT,
  isStaleAt,
  queryPortfolio,
  type FolderRef,
  type QueryArgs,
  type QueryMeta,
} from './portfolio-query';

const NOW = Date.parse('2026-06-01T00:00:00Z');

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
    syncedAt: new Date(0),
    deleted: false,
    ...partial,
  };
}

const META: QueryMeta = { fetchedAt: NOW, registrars: ['dynadot'], errors: [] };
const run = (
  domains: Domain[],
  args: QueryArgs,
  folders: FolderRef[] = [],
  assignments: Record<string, string> = {},
) => queryPortfolio(domains, folders, assignments, META, args);
const names = (
  domains: Domain[],
  args: QueryArgs,
  folders: FolderRef[] = [],
  assignments: Record<string, string> = {},
) => run(domains, args, folders, assignments).rows.map((r) => r.domainName);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('isStaleAt', () => {
  it('is stale when null', () => expect(isStaleAt(null)).toBe(true));
  it('is fresh just under the threshold', () =>
    expect(isStaleAt(NOW - STALE_AFTER_MS + 1000)).toBe(false));
  it('is stale at/after the threshold', () =>
    expect(isStaleAt(NOW - STALE_AFTER_MS)).toBe(true));
});

describe('filters', () => {
  const domains = [
    domain({ domainName: 'a.com', registrar: 'dynadot' }),
    domain({ domainName: 'b.net', registrar: 'porkbun' }),
    domain({ domainName: 'c.com', registrar: 'dynadot', autoRenew: true }),
  ];

  it('registrar', () => expect(names(domains, { registrar: 'porkbun' })).toEqual(['b.net']));

  it('tld normalizes com and .com to the same suffix', () => {
    for (const tld of ['com', '.com']) {
      expect(names(domains, { tld }).sort()).toEqual(['a.com', 'c.com']);
    }
  });

  it('nameContains is case-insensitive', () =>
    expect(names(domains, { nameContains: 'A.CO' })).toEqual(['a.com']));

  it('nameserverContains matches any host, case-insensitive', () => {
    const d = [
      domain({ domainName: 'x.com', nameservers: ['NS1.CLOUDFLARE.com'] }),
      domain({ domainName: 'y.com', nameservers: ['ns1.dynadot.com'] }),
    ];
    expect(names(d, { nameserverContains: 'cloudflare' })).toEqual(['x.com']);
  });

  it('boolean flags', () => {
    expect(names(domains, { autoRenew: true })).toEqual(['c.com']);
    expect(names(domains, { autoRenew: false }).sort()).toEqual(['a.com', 'b.net']);
  });

  it('status substring, case-insensitive', () => {
    const d = [
      domain({ domainName: 'x.com', status: 'clientHold' }),
      domain({ domainName: 'y.com', status: 'active' }),
    ];
    expect(names(d, { status: 'hold' })).toEqual(['x.com']);
  });

  it('ANDs multiple filters', () =>
    expect(names(domains, { registrar: 'dynadot', autoRenew: true })).toEqual(['c.com']));
});

describe('date filters', () => {
  const domains = [
    domain({ domainName: 'past.com', expirationDate: new Date('2026-03-01') }),
    domain({ domainName: 'soon.com', expirationDate: new Date('2026-06-15') }),
    domain({ domainName: 'far.com', expirationDate: new Date('2027-01-01') }),
    domain({ domainName: 'none.com', expirationDate: null }),
  ];

  it('expiresBefore excludes nulls', () =>
    expect(names(domains, { expiresBefore: '2026-07-01' }).sort()).toEqual([
      'past.com',
      'soon.com',
    ]));

  it('expiresAfter excludes nulls', () =>
    expect(names(domains, { expiresAfter: '2026-06-01' }).sort()).toEqual([
      'far.com',
      'soon.com',
    ]));

  it('expiringWithinDays keeps everything up to now + N days (no lower bound)', () =>
    expect(names(domains, { expiringWithinDays: 30 })).toEqual(['past.com', 'soon.com']));

  it('ignores an invalid expiresBefore date', () =>
    expect(names(domains, { expiresBefore: 'not-a-date' }).length).toBe(4));
});

describe('folder resolution', () => {
  const folders: FolderRef[] = [{ id: 'f1', name: 'Clients' }];
  const domains = [
    domain({ domainName: 'a.com', registrar: 'dynadot' }),
    domain({ domainName: 'b.com', registrar: 'dynadot' }),
    domain({ domainName: 'h.com', registrar: 'dynadot' }),
  ];
  const assignments = {
    'dynadot:a.com': 'f1',
    'dynadot:h.com': HIDDEN_FOLDER_ID,
  };

  it('matches by folder id', () =>
    expect(names(domains, { folder: 'f1' }, folders, assignments)).toEqual(['a.com']));

  it('matches by case-insensitive name', () =>
    expect(names(domains, { folder: 'clients' }, folders, assignments)).toEqual(['a.com']));

  it('matches Hidden by keyword and by id', () => {
    expect(names(domains, { folder: 'Hidden' }, folders, assignments)).toEqual(['h.com']);
    expect(names(domains, { folder: HIDDEN_FOLDER_ID }, folders, assignments)).toEqual(['h.com']);
  });

  it('an unknown folder name returns zero rows', () =>
    expect(names(domains, { folder: 'Nope' }, folders, assignments)).toEqual([]));

  it('resolves the folder name onto the row (incl. Hidden)', () => {
    const rows = run(domains, {}, folders, assignments).rows;
    expect(rows.find((r) => r.domainName === 'a.com')!.folder).toBe('Clients');
    expect(rows.find((r) => r.domainName === 'h.com')!.folder).toBe('Hidden');
    expect(rows.find((r) => r.domainName === 'b.com')!.folder).toBeNull();
  });
});

describe('sorting', () => {
  const domains = [
    domain({ domainName: 'b.com', registrar: 'porkbun', expirationDate: new Date('2026-05-01') }),
    domain({ domainName: 'A.com', registrar: 'dynadot', expirationDate: null }),
    domain({ domainName: 'c.com', registrar: 'dynadot', expirationDate: new Date('2026-01-01') }),
  ];

  it('defaults to expirationDate asc, nulls last', () =>
    expect(names(domains, {})).toEqual(['c.com', 'b.com', 'A.com']));

  it('expirationDate desc keeps nulls last', () =>
    expect(names(domains, { order: 'desc' })).toEqual(['b.com', 'c.com', 'A.com']));

  it('sorts domainName case-insensitively', () =>
    expect(names(domains, { sort: 'domainName' })).toEqual(['A.com', 'b.com', 'c.com']));

  it('sorts by registrar', () =>
    expect(run(domains, { sort: 'registrar' }).rows.map((r) => r.registrar)).toEqual([
      'dynadot',
      'dynadot',
      'porkbun',
    ]));
});

describe('paging and row shape', () => {
  const domains = Array.from({ length: 5 }, (_, i) =>
    domain({ domainName: `d${i}.com`, expirationDate: new Date(2026, i, 1) }),
  );

  it('applies offset and limit; total is the pre-paging count', () => {
    const res = run(domains, { offset: 1, limit: 2 });
    expect(res.total).toBe(5);
    expect(res.rows.map((r) => r.domainName)).toEqual(['d1.com', 'd2.com']);
  });

  it('defaults limit to DEFAULT_LIMIT', () => {
    const many = Array.from({ length: DEFAULT_LIMIT + 10 }, (_, i) =>
      domain({ domainName: `x${i}.com`, expirationDate: new Date(2026, 0, i + 1) }),
    );
    const res = run(many, {});
    expect(res.total).toBe(DEFAULT_LIMIT + 10);
    expect(res.rows).toHaveLength(DEFAULT_LIMIT);
  });

  it('offset beyond the end yields no rows but the real total', () => {
    const res = run(domains, { offset: 99 });
    expect(res.rows).toEqual([]);
    expect(res.total).toBe(5);
  });

  it('drops syncedAt/deleted from rows', () => {
    const row = run(domains, { limit: 1 }).rows[0];
    expect(row).not.toHaveProperty('syncedAt');
    expect(row).not.toHaveProperty('deleted');
  });
});

describe('meta and edge cases', () => {
  it('passes meta through and computes stale from fetchedAt', () => {
    const res = run([], {});
    expect(res.registrars).toEqual(['dynadot']);
    expect(res.errors).toEqual([]);
    expect(res.fetchedAt).toBe(NOW);
    expect(res.stale).toBe(false);
  });

  it('reports stale when the cache is old', () => {
    const stale = queryPortfolio(
      [],
      [],
      {},
      { fetchedAt: NOW - STALE_AFTER_MS, registrars: [], errors: [] },
      {},
    );
    expect(stale.stale).toBe(true);
  });

  it('handles an empty portfolio', () => {
    const res = run([], {});
    expect(res.total).toBe(0);
    expect(res.rows).toEqual([]);
  });
});
