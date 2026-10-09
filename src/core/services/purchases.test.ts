import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { clearAll } from './cache';
import { exportBundle, importBundle } from '../storage/bundle';
import { listEvents } from './domain-events';
import { getPurchases, setNotes, setPurchase, setSale } from './purchases';

let store: MemoryDocStore;
beforeEach(async () => {
  // Let the previous test's queued writes land in its own store.
  await flushWrites().catch(() => {});
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
});

describe('purchases', () => {
  it('records what an agent saves as the agent’s', () => {
    setPurchase(
      {
        domainName: 'a.com',
        purchaseDate: '2024-01-02',
        amount: '10',
        currency: 'USD',
        notes: '',
      },
      'agent',
    );
    setSale(
      {
        domainName: 'a.com',
        saleDate: null,
        amount: null,
        currency: null,
        notes: '',
        mark: true,
      },
      'agent',
    );
    expect(listEvents().map((e) => [e.type, e.source])).toEqual([
      ['purchased', 'agent'],
      ['sold', 'agent'],
    ]);
  });

  it('saves by domain name and keeps the record when the cache is cleared', async () => {
    setPurchase({
      domainName: 'Example.COM',
      purchaseDate: '2020-01-02',
      amount: '0',
      currency: 'usd',
      notes: '  hand reg  ',
    });
    expect(getPurchases()['example.com']).toEqual({
      purchaseDate: '2020-01-02',
      amount: '0.00',
      currency: 'USD',
      purchaseType: 'purchased',
      acquisitionId: expect.any(String),
      notes: 'hand reg',
      saleDate: null,
      saleAmount: null,
      saleCurrency: null,
    });
    clearAll();
    expect(getPurchases()['example.com']?.amount).toBe('0.00');
    await flushWrites();
    // Stored as one purchase event plus the name's note.
    const events = Object.values(await store.list('domain-events'));
    expect(events).toEqual([
      expect.objectContaining({
        domain: 'example.com',
        type: 'purchased',
        source: 'user',
        date: '2020-01-02',
        amount: '0.00',
        currency: 'USD',
        updatedAt: null,
      }),
    ]);
    expect(Object.values(await store.list('domain-notes'))).toEqual([
      expect.objectContaining({
        domain: 'example.com',
        eventId: null,
        text: 'hand reg',
      }),
    ]);
  });

  it('saves a note on its own, without recording a purchase', () => {
    expect(setNotes('a.com', 'call the buyer back')).toMatchObject({
      notes: 'call the buyer back',
      purchaseDate: null,
      amount: null,
    });
    expect(listEvents()).toEqual([]);
    setPurchase({
      domainName: 'a.com',
      purchaseDate: '2020-01-02',
      amount: '10',
      currency: 'USD',
      notes: 'call the buyer back',
    });
    // Editing the note leaves the purchase as it was; blank deletes it.
    expect(setNotes('a.com', '')).toMatchObject({
      notes: '',
      purchaseDate: '2020-01-02',
      amount: '10.00',
    });
    expect(setNotes('b.com', '')).toBeNull();
  });

  it('deletes the record when every field is cleared', () => {
    setPurchase({
      domainName: 'a.com',
      purchaseDate: '2020-01-01',
      amount: null,
      currency: null,
      notes: '',
    });
    expect(
      setPurchase({
        domainName: 'a.com',
        purchaseDate: null,
        amount: null,
        currency: null,
        notes: '   ',
      }),
    ).toBeNull();
    expect(getPurchases()['a.com']).toBeUndefined();
  });

  it('keeps a sale when the purchase is saved, and the purchase when the sale is saved', () => {
    setPurchase({
      domainName: 'a.com',
      purchaseDate: '2020-01-01',
      amount: '10',
      currency: 'USD',
      notes: 'hand reg',
    });
    setSale({
      domainName: 'a.com',
      saleDate: '2024-06-01',
      amount: '500',
      currency: 'USD',
      notes: 'sold on Afternic',
    });
    expect(getPurchases()['a.com']).toMatchObject({
      purchaseDate: '2020-01-01',
      amount: '10.00',
      saleDate: '2024-06-01',
      saleAmount: '500.00',
      notes: 'sold on Afternic',
    });
    setPurchase({
      domainName: 'a.com',
      purchaseDate: '2020-01-02',
      amount: '12',
      currency: 'USD',
      notes: 'sold on Afternic',
    });
    expect(getPurchases()['a.com']).toMatchObject({
      purchaseDate: '2020-01-02',
      amount: '12.00',
      saleDate: '2024-06-01',
      saleAmount: '500.00',
    });
  });

  it('rejects a negative amount and yen with a fraction', () => {
    expect(() =>
      setPurchase({
        domainName: 'a.com',
        purchaseDate: null,
        amount: '-1',
        currency: 'USD',
        notes: '',
      }),
    ).toThrow(/negative/);
    expect(() =>
      setPurchase({
        domainName: 'a.com',
        purchaseDate: null,
        amount: '1.5',
        currency: 'JPY',
        notes: '',
      }),
    ).toThrow(/no decimal/);
  });

  it('clearing a purchase keeps the note and the sale', () => {
    setPurchase({
      domainName: 'a.com',
      purchaseDate: '2020-01-01',
      amount: '10',
      currency: 'USD',
      notes: 'keep me',
    });
    setSale({
      domainName: 'a.com',
      saleDate: '2022-01-01',
      amount: '500',
      currency: 'USD',
      notes: 'keep me',
    });
    setPurchase({
      domainName: 'a.com',
      purchaseDate: null,
      amount: null,
      currency: null,
      notes: 'keep me',
    });
    expect(getPurchases()['a.com']).toMatchObject({
      purchaseDate: null,
      amount: null,
      notes: 'keep me',
      saleAmount: '500.00',
    });
    expect(listEvents().map((e) => e.type)).toEqual(['sold']);
  });

  it('edits the purchase in place and records a registration as registered', () => {
    const base = {
      domainName: 'Münich.DE',
      currency: 'EUR',
      notes: '',
    };
    setPurchase({ ...base, purchaseDate: '2024-05-01', amount: '9' });
    setPurchase({
      ...base,
      kind: 'registered',
      purchaseDate: '2024-05-02',
      amount: '9.99',
    });
    const events = listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      domain: 'xn--mnich-kva.de',
      type: 'registered',
      date: '2024-05-02',
      amount: '9.99',
    });
    expect(events[0].updatedAt).toEqual(expect.any(Number));
  });

  it('shows a sale only when it follows the current purchase', () => {
    setSale({
      domainName: 'a.com',
      saleDate: '2021-01-01',
      amount: '100',
      currency: 'USD',
      notes: '',
    });
    setPurchase({
      domainName: 'a.com',
      purchaseDate: '2023-01-01',
      amount: '50',
      currency: 'USD',
      notes: '',
    });
    // A purchase after the sale is a new holding with no sale yet.
    expect(getPurchases()['a.com']).toMatchObject({
      amount: '50.00',
      saleDate: null,
      saleAmount: null,
    });
  });

  it('re-checks events and notes arriving in a data bundle', async () => {
    setPurchase({
      domainName: 'kept.com',
      purchaseDate: '2021-03-04',
      amount: '12',
      currency: 'USD',
      notes: 'x',
    });
    await flushWrites();
    const bundle = JSON.parse(exportBundle({ version: 't', platform: 't' }));
    const good = Object.values(bundle.namespaces['domain-events'])[0] as Record<
      string,
      unknown
    >;
    const bad = (id: string, patch: Record<string, unknown>) => ({
      [id]: { ...good, id, ...patch },
    });
    bundle.namespaces['domain-events'] = {
      ...bundle.namespaces['domain-events'],
      ...bad('A1', { domain: 'Münich.DE' }), // kept, re-keyed
      ...bad('A2', { type: 'teleported' }),
      ...bad('A3', { amount: -3 }),
      ...bad('A4', { currency: 'XYZ' }),
      ...bad('A5', { amount: null }), // currency without an amount
      ...bad('A6', { date: '2021-02-30' }),
      ...bad('A7', { id: 'mismatch' }),
      junk: 'nope',
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await importBundle(JSON.stringify(bundle));
    warn.mockRestore();
    expect(
      listEvents()
        .map((e) => e.domain)
        .sort(),
    ).toEqual(['kept.com', 'xn--mnich-kva.de']);
    expect(getPurchases()['kept.com']).toMatchObject({
      amount: '12.00',
      notes: 'x',
    });
  });
});

describe('domain event storage', () => {
  it('deleting an event deletes the notes attached to it', async () => {
    const { newEvent, putEvents, deleteEvent } =
      await import('./domain-events');
    const e = newEvent({
      domain: 'a.com',
      type: 'sold',
      source: 'user',
      date: '2024-01-01',
    });
    putEvents([e]);
    await flushWrites();
    await store.put('domain-notes', 'N1', {
      id: 'N1',
      domain: 'a.com',
      eventId: e.id,
      text: 'via Afternic',
      createdAt: 1,
      updatedAt: null,
    });
    await hydrateStores();
    deleteEvent(e.id);
    await flushWrites();
    expect(await store.list('domain-events')).toEqual({});
    expect(await store.list('domain-notes')).toEqual({});
  });
});
