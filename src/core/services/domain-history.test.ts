import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { ownershipByDomain } from '../../shared/ownership';
import { listAccounts, trackedAccountIds } from './accounts';
import { listEvents, nameNote } from './domain-events';
import {
  deleteDomains,
  deleteUserEvent,
  recordSync,
  restoreOwned,
  setAlertsDismissed,
  setDispositions,
} from './domain-history';
import { assignFolder, getFolders } from './folders';
import { clearAll } from './cache';
import { getPurchases, markSold, setPurchase, setSale } from './purchases';

let store: MemoryDocStore;
beforeEach(async () => {
  await flushWrites().catch(() => {});
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
});

const acct = () => listAccounts()[0].id;
const holding = (names: string[], known = true) => [
  { accountId: acct(), names, synced: true, known },
];

describe('domain history', () => {
  it('starts tracking on the first sync, then records what changes', async () => {
    expect(recordSync(holding(['a.com']))).toEqual([]);
    expect(trackedAccountIds().has(acct())).toBe(true);
    const events = recordSync(holding(['b.com']));
    expect(events.map((e) => [e.type, e.domain])).toEqual([
      ['removed', 'a.com'],
      ['added', 'b.com'],
    ]);
    await flushWrites();
    expect(Object.keys(await store.list('domain-events'))).toHaveLength(2);
  });

  it('still sees a change made while the cache was cleared', async () => {
    recordSync(holding(['a.com', 'b.com']));
    clearAll();
    const events = recordSync(holding(['b.com']));
    expect(events.map((e) => [e.type, e.domain])).toEqual([
      ['removed', 'a.com'],
    ]);
    await flushWrites();
    expect(await store.get('registrar-last-sync', acct())).toMatchObject({
      names: ['b.com'],
    });
  });

  it('labels a departure, and Move back to Owned undoes the label', () => {
    recordSync(holding(['a.com']));
    const [left] = recordSync(holding([]));
    const owner = () => ownershipByDomain(listEvents()).get('a.com');
    expect(owner()?.label).toBe('left');
    setDispositions([{ domainName: 'a.com', resolves: left.id }], 'dropped');
    expect(owner()?.label).toBe('dropped');
    restoreOwned(['a.com']);
    expect(owner()?.label).toBe('left');
    // A sync departure has nothing of yours to undo.
    expect(() => restoreOwned(['a.com'])).toThrow(/isn't marked/);
  });

  it('marks a name Sold with no details, dated today, closing its alert', () => {
    recordSync(holding(['a.com']));
    const [left] = recordSync(holding([]));
    setSale({
      domainName: 'a.com',
      saleDate: null,
      amount: null,
      currency: null,
      notes: '',
      mark: true,
      resolves: left.id,
    });
    const sold = listEvents().find((e) => e.type === 'sold')!;
    expect(sold).toMatchObject({ resolves: left.id, source: 'user' });
    expect(sold.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Undoing the sale brings the alert back.
    deleteUserEvent(sold.id);
    expect(ownershipByDomain(listEvents()).get('a.com')?.label).toBe('left');
  });

  it('records an arrival as a new purchase instead of editing the old one', () => {
    setPurchase({
      domainName: 'a.com',
      purchaseDate: '2020-01-01',
      amount: '10',
      currency: 'USD',
      notes: '',
    });
    setSale({
      domainName: 'a.com',
      saleDate: '2022-01-01',
      amount: '50',
      currency: 'USD',
      notes: '',
    });
    recordSync(holding([]));
    const [arrived] = recordSync(holding(['a.com']));
    setPurchase({
      domainName: 'a.com',
      purchaseDate: '2025-01-01',
      amount: '80',
      currency: 'USD',
      notes: '',
      resolves: arrived.id,
    });
    const purchases = listEvents().filter((e) => e.type === 'purchased');
    expect(purchases.map((e) => e.amount)).toEqual(['10.00', '80.00']);
    expect(getPurchases()['a.com']).toMatchObject({
      amount: '80.00',
      saleAmount: null,
    });
  });

  it('dismisses an alert and brings it back', () => {
    recordSync(holding([]));
    const [added] = recordSync(holding(['a.com']));
    setAlertsDismissed([added.id], true);
    expect(listEvents()[0].dismissed).toBe(true);
    setAlertsDismissed([added.id], false);
    expect(listEvents()[0].dismissed).toBe(false);
  });

  it('Delete forgets everything about a name', async () => {
    setPurchase({
      domainName: 'a.com',
      purchaseDate: '2020-01-01',
      amount: '10',
      currency: 'USD',
      notes: 'mine',
    });
    assignFolder('a.com', '__hidden__');
    deleteDomains(['A.com']);
    expect(listEvents()).toEqual([]);
    expect(nameNote('a.com')).toBeUndefined();
    expect(getFolders().assignments['a.com']).toBeUndefined();
    await flushWrites();
    expect(await store.list('domain-notes')).toEqual({});
  });

  it('marks many names at once, on the date you pick', async () => {
    recordSync(holding(['a.com', 'b.com', 'c.com']));
    const left = recordSync(holding(['c.com']));
    const openA = left.find((e) => e.domain === 'a.com')!;
    setDispositions(
      [{ domainName: 'a.com', resolves: openA.id }, { domainName: 'b.com' }],
      'dropped',
      '2026-09-01',
    );
    const owner = ownershipByDomain(listEvents());
    expect(owner.get('a.com')?.label).toBe('dropped');
    expect(owner.get('b.com')?.label).toBe('dropped');
    const dropped = listEvents().filter((e) => e.type === 'dropped');
    expect(dropped.map((e) => e.date)).toEqual(['2026-09-01', '2026-09-01']);
    expect(dropped[0].resolves).toBe(openA.id);
    await flushWrites();
    expect(Object.keys(await store.list('domain-events'))).toHaveLength(4);
  });

  it('marks many names Sold with no price, dated today by default', () => {
    markSold([{ domainName: 'a.com' }, { domainName: 'b.com' }]);
    const sold = listEvents().filter((e) => e.type === 'sold');
    expect(sold).toHaveLength(2);
    expect(
      sold.every((e) => !e.amount && /^\d{4}-\d{2}-\d{2}$/.test(e.date!)),
    ).toBe(true);
    expect(getPurchases()['a.com']).toMatchObject({ saleAmount: null });
  });

  it('moves back to Owned only the names you labeled', () => {
    recordSync(holding(['a.com', 'b.com']));
    recordSync(holding([]));
    setDispositions([{ domainName: 'a.com' }], 'archived');
    // b.com only left on its own: nothing of yours to undo, so it's skipped.
    expect(restoreOwned(['a.com', 'b.com'])).toBe(1);
    const owner = ownershipByDomain(listEvents());
    expect(owner.get('a.com')?.label).toBe('left');
    expect(owner.get('b.com')?.label).toBe('left');
  });
});
