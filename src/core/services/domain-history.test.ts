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
  deleteDomain,
  deleteUserEvent,
  recordSync,
  restoreOwned,
  setAlertDismissed,
  setDisposition,
} from './domain-history';
import { assignFolder, getFolders } from './folders';
import { getPurchases, setPurchase, setSale } from './purchases';

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
    expect(recordSync([], holding(['a.com']))).toEqual([]);
    expect(trackedAccountIds().has(acct())).toBe(true);
    const events = recordSync(holding(['a.com']), holding(['b.com']));
    expect(events.map((e) => [e.type, e.domain])).toEqual([
      ['removed', 'a.com'],
      ['added', 'b.com'],
    ]);
    await flushWrites();
    expect(Object.keys(await store.list('domain-events'))).toHaveLength(2);
  });

  it('labels a departure, and Move back to Owned undoes the label', () => {
    recordSync([], holding(['a.com']));
    const [left] = recordSync(holding(['a.com']), holding([]));
    const owner = () => ownershipByDomain(listEvents()).get('a.com');
    expect(owner()?.label).toBe('left');
    setDisposition('a.com', 'dropped', left.id);
    expect(owner()?.label).toBe('dropped');
    restoreOwned('a.com');
    expect(owner()?.label).toBe('left');
    // A sync departure has nothing of yours to undo.
    expect(() => restoreOwned('a.com')).toThrow(/isn't marked/);
  });

  it('marks a name Sold with no details, dated today, closing its alert', () => {
    recordSync([], holding(['a.com']));
    const [left] = recordSync(holding(['a.com']), holding([]));
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
    recordSync([], holding([]));
    const [arrived] = recordSync(holding([]), holding(['a.com']));
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
    recordSync([], holding([]));
    const [added] = recordSync(holding([]), holding(['a.com']));
    setAlertDismissed(added.id, true);
    expect(listEvents()[0].dismissed).toBe(true);
    setAlertDismissed(added.id, false);
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
    deleteDomain('A.com');
    expect(listEvents()).toEqual([]);
    expect(nameNote('a.com')).toBeUndefined();
    expect(getFolders().assignments['a.com']).toBeUndefined();
    await flushWrites();
    expect(await store.list('domain-notes')).toEqual({});
  });
});
