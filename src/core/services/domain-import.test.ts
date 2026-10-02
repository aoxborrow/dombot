import { beforeEach, describe, expect, it } from 'vitest';
import type { Domain, ImportOptions, ImportRow } from '../../shared/ipc';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { ownershipByDomain } from '../../shared/ownership';
import { isOpenAlert, resolvedIds } from '../../shared/sync-diff';
import { domainsToCsv } from '../../shared/domain-csv';
import { buildRows, guessSetup, readTable } from '../../shared/domain-import';
import { manualRows } from '../../shared/manual-domains';
import { listAccounts } from './accounts';
import { getAskingPrices } from './asking-prices';
import { listEvents, nameNotes } from './domain-events';
import { recordSync, setDispositions } from './domain-history';
import { importDomains, planImport } from './domain-import';
import { getFolders } from './folders';
import { getManualDomains } from './manual-domains';
import { getManualPrices } from './pricing';
import { getPurchases, setPurchase, setSale } from './purchases';
import { getPortfolioPricing } from './registrars';

let store: MemoryDocStore;
beforeEach(async () => {
  await flushWrites().catch(() => {});
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
});

const UPDATE: ImportOptions = { policy: 'update', notInAccounts: 'manual' };
let n = 0;
const apply = (rows: ImportRow[], options: ImportOptions = UPDATE) =>
  importDomains(rows, { ...options, importId: `imp${++n}` });
const row = (domain: string, extra: Partial<ImportRow> = {}): ImportRow => ({
  line: 2,
  domain,
  ...extra,
});
const acct = () => listAccounts()[0].id;
const sync = (names: string[]) =>
  recordSync([{ accountId: acct(), names, synced: true, known: true }]);
const openReviews = () => {
  const events = listEvents();
  const resolved = resolvedIds(events);
  return events
    .filter((e) => isOpenAlert(e, resolved))
    .map((e) => [e.type, e.domain]);
};

describe('importing domains', () => {
  it('adds new names as manual domains, each waiting for review, purchase or not', () => {
    const result = apply([
      row('example.com', {
        registration: { registrar: 'gandi', expirationDate: '2027-01-01' },
        purchase: { date: '2020-01-01', amount: '100.00', currency: 'USD' },
      }),
      row('example.net'),
    ]);
    expect(result.counts).toEqual({
      new: 2,
      update: 0,
      unchanged: 0,
      history: 0,
    });
    expect(getManualDomains()['example.com']).toMatchObject({
      registrar: 'gandi',
      expirationDate: '2027-01-01',
      importId: result.importId,
    });
    expect(openReviews()).toEqual([
      ['added', 'example.com'],
      ['added', 'example.net'],
    ]);
    const purchase = listEvents().find((e) => e.type === 'purchased')!;
    expect(purchase).toMatchObject({
      source: 'import',
      importId: result.importId,
      amount: '100.00',
    });
    expect(purchase.resolves).toBeUndefined();
  });

  it('answers an imported arrival by editing its purchase, not adding one', () => {
    apply([
      row('example.com', {
        purchase: { date: '2020-01-01', amount: '100.00', currency: 'USD' },
      }),
    ]);
    const arrival = listEvents().find((e) => e.type === 'added')!;
    setPurchase({
      domainName: 'example.com',
      resolves: arrival.id,
      purchaseDate: '2020-01-01',
      amount: '120.00',
      currency: 'USD',
      notes: '',
    });
    const purchases = listEvents().filter((e) => e.type === 'purchased');
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({
      amount: '120.00',
      resolves: arrival.id,
    });
    expect(openReviews()).toEqual([]);
  });

  it('changes nothing the second time', async () => {
    const rows = [
      row('example.com', {
        folder: 'Premium',
        notes: 'keep',
        renewal: { amount: '9.00', currency: 'EUR' },
        asking: { amount: '2500.00', currency: 'USD' },
        purchase: { type: 'registered', date: '2020-01-01' },
        sale: { date: '2024-01-01', amount: '900.00', currency: 'USD' },
      }),
    ];
    apply(rows);
    await flushWrites();
    const before = JSON.stringify(await store.loadAll());
    const again = planImport(rows, UPDATE);
    expect(again.counts.unchanged).toBe(1);
    expect(again.outcomes[0].changes).toEqual([]);
    apply(rows);
    await flushWrites();
    expect(JSON.stringify(await store.loadAll())).toBe(before);
  });

  it('adds to a synced name without making it manual or asking about it', () => {
    sync(['example.com']);
    const plan = apply([
      row('example.com', {
        registration: { expirationDate: '2030-01-01' },
        purchase: { date: '2021-05-05', amount: '20.00', currency: 'USD' },
      }),
    ]);
    expect(plan.counts.update).toBe(1);
    expect(plan.outcomes[0].warnings[0]).toMatch(/registrar details come from/);
    expect(getManualDomains()).toEqual({});
    expect(openReviews()).toEqual([]);
    expect(getPurchases()['example.com']).toMatchObject({
      purchaseDate: '2021-05-05',
      amount: '20.00',
    });
  });

  it('fills only blanks under "fill", and replaces under "update"', () => {
    setPurchase({
      domainName: 'example.com',
      purchaseDate: '2019-01-01',
      amount: null,
      currency: null,
      notes: 'mine',
    });
    const rows = [
      row('example.com', {
        notes: 'theirs',
        purchase: { date: '2020-02-02', amount: '50.00', currency: 'USD' },
      }),
    ];
    apply(rows, { policy: 'fill', notInAccounts: 'manual' });
    expect(getPurchases()['example.com']).toMatchObject({
      purchaseDate: '2019-01-01',
      amount: '50.00',
      notes: 'mine',
    });
    apply(rows);
    expect(getPurchases()['example.com']).toMatchObject({
      purchaseDate: '2020-02-02',
      notes: 'theirs',
    });
  });

  it('records a sale in place of your Dropped label, but never replaces Sold', () => {
    sync(['a.com', 'b.com']);
    setDispositions([{ domainName: 'a.com' }], 'dropped');
    setSale({
      domainName: 'b.com',
      saleDate: '2024-01-01',
      amount: null,
      currency: null,
      notes: '',
      mark: true,
    });
    const plan = apply([
      row('a.com', { sale: { amount: '700.00', currency: 'USD' } }),
      row('b.com', { status: 'dropped' }),
    ]);
    const own = ownershipByDomain(listEvents());
    expect(own.get('a.com')?.label).toBe('sold');
    expect(listEvents().filter((e) => e.type === 'dropped')).toEqual([]);
    expect(own.get('b.com')?.label).toBe('sold');
    expect(plan.outcomes[1].warnings).toEqual([
      "It's Sold in DomBot, so it stays Sold.",
    ]);
  });

  it('recreates a Removed review, but not for a name an account holds', () => {
    sync(['held.com']);
    const plan = apply([
      row('gone.com', { status: 'removed' }),
      row('held.com', { status: 'removed' }),
    ]);
    expect(openReviews()).toEqual([['removed', 'gone.com']]);
    expect(getManualDomains()).toEqual({});
    expect(plan.outcomes.map((o) => o.result)).toEqual([
      'history',
      'unchanged',
    ]);
    expect(plan.outcomes[1].warnings[0]).toMatch(/still reports this name/);
  });

  it('records history only when asked, and for names that end up in Archive', () => {
    const plan = apply(
      [
        row('old.com', {
          purchase: { date: '2015-01-01', amount: '10.00', currency: 'USD' },
        }),
        row('sold.com', {
          sale: { date: '2016-01-01', amount: '99.00', currency: 'USD' },
        }),
      ],
      { policy: 'update', notInAccounts: 'history' },
    );
    expect(plan.counts.history).toBe(2);
    expect(getManualDomains()).toEqual({});
    expect(ownershipByDomain(listEvents()).get('sold.com')?.label).toBe('sold');
  });

  it('brings a name back from an open removal without a new review', () => {
    sync(['a.com']);
    sync([]);
    expect(openReviews()).toEqual([['removed', 'a.com']]);
    apply([row('a.com', { registration: { registrarLabel: 'Epik' } })]);
    expect(openReviews()).toEqual([]);
    expect(getManualDomains()['a.com'].registrarLabel).toBe('Epik');
    expect(ownershipByDomain(listEvents()).get('a.com')?.archived).toBe(false);
  });

  it('treats a purchase after the last sale as a buy-back: a new holding, Owned', () => {
    apply([
      row('a.com', {
        purchase: { date: '2018-01-01', amount: '10.00', currency: 'USD' },
        sale: { date: '2019-01-01', amount: '50.00', currency: 'USD' },
      }),
    ]);
    const plan = apply([
      row('a.com', {
        purchase: { date: '2023-01-01', amount: '80.00', currency: 'USD' },
      }),
    ]);
    expect(plan.outcomes[0].result).toBe('new');
    expect(listEvents().filter((e) => e.type === 'purchased')).toHaveLength(2);
    expect(getPurchases()['a.com']).toMatchObject({
      purchaseDate: '2023-01-01',
      saleDate: null,
    });
    expect(ownershipByDomain(listEvents()).get('a.com')?.archived).toBe(false);
  });

  it('creates missing folders once, and knows Hidden', () => {
    const plan = apply([
      row('a.com', { folder: 'Brandables' }),
      row('b.com', { folder: 'brandables' }),
      row('c.com', { folder: 'hidden' }),
    ]);
    expect(plan.newFolders).toEqual(['Brandables']);
    const { folders, assignments } = getFolders();
    expect(folders.map((f) => f.name)).toEqual(['Brandables']);
    expect(assignments['a.com']).toBe(folders[0].id);
    expect(assignments['b.com']).toBe(folders[0].id);
    expect(assignments['c.com']).toBe('__hidden__');
  });

  it('sets renewal and asking prices, merging an asking price in the same currency', () => {
    apply([
      row('a.com', {
        renewal: { amount: '12.00', currency: 'GBP' },
        asking: { amount: '900.00', minOffer: '200.00', currency: 'USD' },
      }),
    ]);
    apply([row('a.com', { asking: { floor: '500.00', currency: 'USD' } })]);
    expect(getManualPrices()['a.com']).toEqual({
      amount: '12.00',
      currency: 'GBP',
    });
    expect(getAskingPrices()['a.com']).toMatchObject({
      amount: '900.00',
      minOffer: '200.00',
      floor: '500.00',
    });
    const plan = planImport(
      [row('a.com', { asking: { amount: '100.00', currency: 'USD' } })],
      UPDATE,
    );
    expect(plan.outcomes[0].warnings[0]).toMatch(/Asking price left as is/);
  });

  it('round trips: export, import into an empty DomBot, export again', async () => {
    apply([
      row('xn--mnich-kva.de', {
        folder: 'Premium',
        notes: 'line one\nline "two", three',
        registration: {
          registrar: 'gandi',
          createdDate: '2019-04-02',
          expirationDate: '2027-01-01',
          autoRenew: true,
        },
        renewal: { amount: '9.00', currency: 'EUR' },
        asking: { amount: '2500.00', floor: '1000.00', currency: 'EUR' },
        purchase: {
          type: 'registered',
          date: '2019-04-02',
          amount: '1500',
          currency: 'JPY',
          years: 2,
        },
      }),
      row('sold.example', {
        purchase: { date: '2018-01-01', amount: '10.00', currency: 'USD' },
        sale: { date: '2019-01-01', amount: '50.00', currency: 'USD' },
      }),
      row('gone.example', { status: 'removed' }),
      row('dropped.example', { status: 'dropped' }),
    ]);
    const exportAll = () => {
      const events = listEvents();
      const own = ownershipByDomain(events);
      const manual = manualRows(getManualDomains(), []);
      const departed: Domain[] = [...own]
        .filter(([name, o]) => o.archived && !getManualDomains()[name])
        .map(([name]) => ({
          ...manualRows(
            { [name]: { registrar: null, addedAt: 0, updatedAt: null } },
            [],
          )[0],
          manual: false,
          departed: true,
        }));
      const { folders, assignments } = getFolders();
      return domainsToCsv(
        [...manual, ...departed].sort((a, b) =>
          a.domainName.localeCompare(b.domainName),
        ),
        {
          registrarLabels: { gandi: 'Gandi.net' },
          folders,
          assignments,
          purchases: getPurchases(),
          askingPrices: getAskingPrices(),
          pricing: getPortfolioPricing(),
          manualPrices: getManualPrices(),
          archiveLabel: (name) => own.get(name)?.label ?? null,
          accountName: () => 'Manual',
          now: Date.parse('2026-06-15T00:00:00Z'),
        },
      );
    };
    const first = exportAll();
    await flushWrites();

    configureStore(new MemoryDocStore());
    await hydrateStores();
    const table = readTable(first);
    const ctx = {
      preferredCurrency: 'USD',
      numberFormat: 'us' as const,
      registrars: [{ id: 'gandi', displayName: 'Gandi.net' }],
      today: '2026-06-15',
    };
    const built = buildRows(table, guessSetup(table, ctx), ctx);
    expect(built.issues).toEqual([]);
    apply(built.rows);
    const second = exportAll();

    // Importable columns match; export-only ones (last synced, account) may not.
    const importable = (csv: string) => {
      const t = readTable(csv);
      const keep = t.headers.map(
        (h) => !['Account', 'Last synced', 'Days until expiry'].includes(h),
      );
      return t.rows.map((r) => r.cells.filter((_, i) => keep[i]));
    };
    expect(importable(second)).toEqual(importable(first));
    expect(nameNotes()['xn--mnich-kva.de']).toBe('line one\nline "two", three');
  });
});

describe('writing an import', () => {
  it('writes once per namespace, so a 2,000-row chunk fits a Worker request', async () => {
    // Count what a D1 store would send: one statement per put or delete, and
    // one batch per 100 entries of a putMany (d1-doc-store.ts).
    let subrequests = 0;
    const counting = new MemoryDocStore();
    const put = counting.put.bind(counting);
    const putMany = counting.putMany.bind(counting);
    const del = counting.delete.bind(counting);
    counting.put = async (...args) => {
      subrequests++;
      return put(...args);
    };
    counting.putMany = async (ns, entries) => {
      subrequests += Math.ceil(entries.length / 100);
      return putMany(ns, entries);
    };
    counting.delete = async (...args) => {
      subrequests++;
      return del(...args);
    };
    configureStore(counting);
    await hydrateStores();

    const rows = Array.from({ length: 2000 }, (_, i) =>
      row(`name${i}.example`, {
        folder: 'Imported',
        notes: `note ${i}`,
        renewal: { amount: '10.00', currency: 'USD' },
        asking: { amount: '500.00', currency: 'USD' },
        purchase: { date: '2020-01-01', amount: '9.00', currency: 'USD' },
      }),
    );
    apply(rows);
    await flushWrites();
    // Manual entries, events (added + purchased), notes, assignments,
    // prices, and asking prices: about 120 batches, plus the folder list.
    expect(subrequests).toBeLessThan(200);
    expect(Object.keys(getManualDomains())).toHaveLength(2000);
  });
});
