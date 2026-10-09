import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HIDDEN_FOLDER_ID,
  STALE_AFTER_MS,
  type Domain,
} from '../../shared/ipc';
import { importedRow } from '../../shared/imported-domains';
import { archiveRows, type Ownership } from '../../shared/ownership';
import {
  DEFAULT_LIMIT,
  isStaleAt,
  queryPortfolio,
  type FolderRef,
  type QueryArgs,
  type QueryMeta,
  type RowExtras,
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
    source: 'registrar',
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

  it('registrar', () =>
    expect(names(domains, { registrar: 'porkbun' })).toEqual(['b.net']));

  it("privacy is null, and never matches, where the registrar doesn't report it", () => {
    const mixed = [
      ...domains,
      domain({ domainName: 'd.io', registrar: '101domain' }),
    ];
    expect(names(mixed, { privacy: false }).sort()).toEqual([
      'a.com',
      'b.net',
      'c.com',
    ]);
    const row = run(mixed, { nameContains: 'd.io' }).rows[0];
    expect(row.privacy).toBeNull();
  });

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
    expect(names(domains, { autoRenew: false }).sort()).toEqual([
      'a.com',
      'b.net',
    ]);
  });

  it('status substring, case-insensitive', () => {
    const d = [
      domain({ domainName: 'x.com', status: 'clientHold' }),
      domain({ domainName: 'y.com', status: 'active' }),
    ];
    expect(names(d, { status: 'hold' })).toEqual(['x.com']);
  });

  it('ANDs multiple filters', () =>
    expect(names(domains, { registrar: 'dynadot', autoRenew: true })).toEqual([
      'c.com',
    ]));
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
    expect(names(domains, { expiringWithinDays: 30 })).toEqual([
      'past.com',
      'soon.com',
    ]));

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
    'a.com': 'f1',
    'h.com': HIDDEN_FOLDER_ID,
  };

  it('matches by folder id', () =>
    expect(names(domains, { folder: 'f1' }, folders, assignments)).toEqual([
      'a.com',
    ]));

  it('matches by case-insensitive name', () =>
    expect(names(domains, { folder: 'clients' }, folders, assignments)).toEqual(
      ['a.com'],
    ));

  it('matches Hidden by keyword and by id', () => {
    expect(names(domains, { folder: 'Hidden' }, folders, assignments)).toEqual([
      'h.com',
    ]);
    expect(
      names(domains, { folder: HIDDEN_FOLDER_ID }, folders, assignments),
    ).toEqual(['h.com']);
  });

  it('an unknown folder name returns zero rows', () =>
    expect(names(domains, { folder: 'Nope' }, folders, assignments)).toEqual(
      [],
    ));

  it('resolves the folder name onto the row (incl. Hidden)', () => {
    const rows = run(domains, {}, folders, assignments).rows;
    expect(rows.find((r) => r.domainName === 'a.com')!.folder).toBe('Clients');
    expect(rows.find((r) => r.domainName === 'h.com')!.folder).toBe('Hidden');
    expect(rows.find((r) => r.domainName === 'b.com')!.folder).toBeNull();
  });
});

describe('sorting', () => {
  const domains = [
    domain({
      domainName: 'b.com',
      registrar: 'porkbun',
      expirationDate: new Date('2026-05-01'),
    }),
    domain({ domainName: 'A.com', registrar: 'dynadot', expirationDate: null }),
    domain({
      domainName: 'c.com',
      registrar: 'dynadot',
      expirationDate: new Date('2026-01-01'),
    }),
  ];

  it('defaults to expirationDate asc, nulls last', () =>
    expect(names(domains, {})).toEqual(['c.com', 'b.com', 'A.com']));

  it('expirationDate desc keeps nulls last', () =>
    expect(names(domains, { order: 'desc' })).toEqual([
      'b.com',
      'c.com',
      'A.com',
    ]));

  it('sorts domainName case-insensitively', () =>
    expect(names(domains, { sort: 'domainName' })).toEqual([
      'A.com',
      'b.com',
      'c.com',
    ]));

  it('sorts by registrar', () =>
    expect(
      run(domains, { sort: 'registrar' }).rows.map((r) => r.registrar),
    ).toEqual(['dynadot', 'dynadot', 'porkbun']));
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
      domain({
        domainName: `x${i}.com`,
        expirationDate: new Date(2026, 0, i + 1),
      }),
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

describe('ownership', () => {
  const sold: Ownership = {
    archived: true,
    label: 'sold',
    event: null,
    lastAccountId: 'dynadot',
  };
  const ownership = new Map<string, Ownership>([
    ['escrow.com', sold],
    ['gone.com', { ...sold, label: 'dropped', lastAccountId: 'old-account' }],
  ]);
  const live = [
    domain({ domainName: 'kept.com', autoRenew: true }),
    domain({ domainName: 'hidden.com' }),
    domain({ domainName: 'escrow.com', autoRenew: true }),
  ];
  // gone.com's last account was removed, so its Archive row has no registrar.
  const domains = [...live, ...archiveRows(ownership, live, null)];
  const assignments = { 'hidden.com': HIDDEN_FOLDER_ID };
  const query = (args: QueryArgs) =>
    queryPortfolio(domains, [], assignments, META, args, ownership);

  it('covers Owned by default, Hidden names included', () => {
    const res = query({ sort: 'domainName' });
    expect(res.rows.map((r) => [r.domainName, r.hidden])).toEqual([
      ['hidden.com', true],
      ['kept.com', false],
    ]);
    expect(res.rows.every((r) => r.ownership === 'owned')).toBe(true);
  });

  it('covers Archive, held or not', () => {
    const res = query({ ownership: 'archive', sort: 'domainName' });
    expect(res.rows).toMatchObject([
      {
        domainName: 'escrow.com',
        ownership: 'archive',
        archiveLabel: 'sold',
        inAccount: true,
        registrar: 'dynadot',
        autoRenew: true,
      },
      {
        domainName: 'gone.com',
        ownership: 'archive',
        archiveLabel: 'dropped',
        inAccount: false,
        registrar: null,
        accountId: 'old-account',
        accountLabel: null,
        autoRenew: null,
        locked: null,
        privacy: null,
      },
    ]);
    expect(query({ ownership: 'all' }).total).toBe(4);
  });

  it('never matches a setting filter on a name no account reports', () => {
    const names = (args: QueryArgs) =>
      query({ ownership: 'archive', ...args }).rows.map((r) => r.domainName);
    expect(names({ autoRenew: false })).toEqual([]);
    expect(names({ locked: false })).toEqual(['escrow.com']);
    expect(names({ privacy: false })).toEqual(['escrow.com']);
  });
});

describe('imported names', () => {
  const synced = domain({ domainName: 'synced.com', autoRenew: true });
  const epik = importedRow('epik.com', {
    registrar: null,
    registrarLabel: 'Epik',
    expirationDate: '2027-01-02',
    autoRenew: true,
    addedAt: 1,
    updatedAt: null,
  });
  const gandi = importedRow('gandi.net', {
    registrar: 'gandi',
    addedAt: 1,
    updatedAt: null,
  });
  const domains = [synced, epik, gandi];
  const rows = (args: QueryArgs) =>
    queryPortfolio(domains, [], {}, META, { sort: 'domainName', ...args }).rows;

  it('lists them with no account, their typed registrar, and source', () => {
    expect(rows({ source: 'imported' })).toMatchObject([
      {
        domainName: 'epik.com',
        source: 'imported',
        registrar: null,
        registrarLabel: 'Epik',
        accountId: null,
        accountLabel: null,
        inAccount: false,
        autoRenew: true,
        locked: null,
        privacy: null,
      },
      {
        domainName: 'gandi.net',
        registrar: 'gandi',
        registrarLabel: null,
        accountId: null,
        // Never set, so unknown rather than false.
        autoRenew: null,
      },
    ]);
    expect(rows({ source: 'registrar' }).map((r) => r.domainName)).toEqual([
      'synced.com',
    ]);
  });

  it('matches auto-renew only where you set it, and never lock or privacy', () => {
    const names = (args: QueryArgs) => rows(args).map((r) => r.domainName);
    expect(names({ autoRenew: true })).toEqual(['epik.com', 'synced.com']);
    expect(names({ autoRenew: false })).toEqual([]);
    expect(names({ locked: false })).toEqual(['synced.com']);
    expect(names({ privacy: false })).toEqual(['synced.com']);
  });

  it('never matches an account filter, even on a shared registrar id', () => {
    const names = (args: QueryArgs) => rows(args).map((r) => r.domainName);
    // A legacy account's id is its registrar id; gandi.net is imported at gandi.
    expect(names({ accountId: 'gandi' })).toEqual([]);
    expect(names({ accountId: 'dynadot' })).toEqual(['synced.com']);
  });
});

describe('money, notes and prices on rows', () => {
  const a = domain({ domainName: 'a.com', accountId: 'acct' });
  const b = domain({ domainName: 'b.com', accountId: 'acct' });
  const c = domain({ domainName: 'c.com', accountId: 'acct' });
  const extras: RowExtras = {
    purchases: {
      'a.com': {
        purchaseDate: '2024-01-02',
        amount: '1200.00',
        currency: 'USD',
        purchaseType: 'purchased',
        notes: 'From a drop',
        saleDate: '2026-05-01',
        saleAmount: '5000.00',
        saleCurrency: 'USD',
      },
      // A note on its own: no purchase or sale.
      'b.com': {
        purchaseDate: null,
        amount: null,
        currency: null,
        notes: 'Brandable',
      },
    },
    listPrices: {
      'a.com': {
        amount: '9000',
        minOffer: '2000',
        floor: '1500',
        currency: 'USD',
        updatedAt: 1,
      },
    },
    pricing: {
      'acct:a.com': {
        domain: 'a.com',
        registrar: 'dynadot',
        renewal: 12.5,
        currency: 'USD',
        source: 'api',
      },
      'acct:b.com': {
        domain: 'b.com',
        registrar: 'dynadot',
        renewal: 80,
        currency: 'USD',
        source: 'manual',
      },
      'acct:c.com': {
        domain: 'c.com',
        registrar: 'dynadot',
        renewal: null,
        currency: 'USD',
        source: 'unavailable',
      },
    },
  };
  const query = (args: QueryArgs) =>
    queryPortfolio([a, b, c], [], {}, META, args, new Map(), extras);

  it('carries paid, sold, notes, asking and renewal prices', () => {
    const [ra, rb, rc] = query({ sort: 'domainName' }).rows;
    expect(ra).toMatchObject({
      paid: {
        date: '2024-01-02',
        amount: '1200.00',
        currency: 'USD',
        kind: 'purchased',
      },
      sold: { date: '2026-05-01', amount: '5000.00', currency: 'USD' },
      notes: 'From a drop',
      askingPrice: {
        amount: '9000',
        minOffer: '2000',
        floor: '1500',
        currency: 'USD',
      },
      renewalPrice: { amount: 12.5, currency: 'USD', source: 'api' },
    });
    expect(rb).toMatchObject({
      paid: null,
      sold: null,
      notes: 'Brandable',
      askingPrice: null,
      renewalPrice: { amount: 80, source: 'manual' },
    });
    expect(rc).toMatchObject({ notes: null, renewalPrice: null });
  });

  it('sorts by renewal price, names with no estimate last', () => {
    const order = (args: QueryArgs) =>
      query({ sort: 'renewalPrice', ...args }).rows.map((r) => r.domainName);
    expect(order({})).toEqual(['a.com', 'b.com', 'c.com']);
    expect(order({ order: 'desc' })).toEqual(['b.com', 'a.com', 'c.com']);
  });
});
