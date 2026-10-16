import { beforeEach, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
  clearCacheNamespaces,
} from '../storage/namespace';
import { newEvent, putEvents, deleteEvent } from './domain-events';
import { getSalesDetails, setSalesDetails } from './sales-details';
import { exportBundle, importBundle, parseBundle } from '../storage/bundle';
import {
  salesDetailsSchema,
  type SalesDetails,
} from '../../shared/sales-details';

const details: SalesDetails = {
  currency: 'USD',
  marketplace: 'Atom',
  payment: 'installments',
  received: '100',
  fees: '0',
  renewalCost: null,
};
beforeEach(async () => {
  await flushWrites();
  configureStore(new MemoryDocStore());
  await hydrateStores();
});
it('persists sale details across cache clearing and backup restore, and deletes them with the sale', async () => {
  const sale = newEvent({
    domain: 'example.com',
    type: 'sold',
    source: 'user',
    date: '2026-01-01',
    amount: '1000',
    currency: 'USD',
  });
  putEvents([sale]);
  setSalesDetails(sale.id, details);
  clearCacheNamespaces();
  const backup = exportBundle({ version: 'test', platform: 'test' });
  expect(JSON.parse(backup).version).toBe(9);
  deleteEvent(sale.id);
  expect(getSalesDetails()).toEqual({});
  await importBundle(backup);
  expect(getSalesDetails()[sale.id]).toEqual(details);
  await flushWrites();
  await hydrateStores();
  expect(getSalesDetails()[sale.id]).toEqual(details);
});
it('rejects non-sale events, unknown events, mismatched currencies and malformed amounts', () => {
  const purchase = newEvent({
    domain: 'example.com',
    type: 'purchased',
    source: 'user',
    date: null,
  });
  putEvents([purchase]);
  expect(() => setSalesDetails(purchase.id, details)).toThrow(
    'Sale no longer exists',
  );
  expect(() => setSalesDetails('missing', details)).toThrow();
  const sale = { ...purchase, type: 'sold' as const, currency: 'EUR' as const };
  putEvents([sale]);
  expect(() => setSalesDetails(sale.id, details)).toThrow('sale currency');
  for (const received of ['-1', 'NaN', 'Infinity', '1.123', ''])
    expect(salesDetailsSchema.safeParse({ ...details, received }).success).toBe(
      false,
    );
  expect(salesDetailsSchema.safeParse({ ...details, fees: '0' }).success).toBe(
    true,
  );
});
it('imports older backups and discards malformed sale details', () => {
  const b = JSON.parse(exportBundle({ version: 'test', platform: 'test' }));
  b.version = 8;
  b.namespaces['sale-details'] = {
    bad: { ...details, fees: '-10' },
    good: details,
  };
  expect(parseBundle(JSON.stringify(b)).namespaces['sale-details']).toEqual({
    good: details,
  });
});
