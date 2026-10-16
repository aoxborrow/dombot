import { beforeEach, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  clearCacheNamespaces,
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { exportBundle, importBundle, parseBundle } from '../storage/bundle';
import { getForSale, setForSale } from './for-sale';
import { importDomains, planImport } from './domain-import';
import { deleteDomains, recordSync } from './domain-history';
import { listAccounts } from './accounts';

beforeEach(async () => {
  await flushWrites();
  configureStore(new MemoryDocStore());
  await hydrateStores();
});

it('normalizes names and rejects an invalid bulk request without partial changes', () => {
  setForSale(['EXAMPLE.COM'], true);
  expect(getForSale()).toEqual({ 'example.com': true });
  expect(() => setForSale(['other.com', 'not a domain'], true)).toThrow();
  expect(getForSale()).toEqual({ 'example.com': true });
});

it('survives cache clearing, sync and backup restore, but is deleted with the domain', async () => {
  setForSale(['example.com'], true);
  const id = listAccounts()[0].id;
  recordSync([
    { accountId: id, names: ['example.com'], synced: true, known: true },
  ]);
  clearCacheNamespaces();
  expect(getForSale()['example.com']).toBe(true);
  const backup = exportBundle({ version: 'test', platform: 'test' });
  setForSale(['example.com'], false);
  await importBundle(backup);
  expect(getForSale()['example.com']).toBe(true);
  deleteDomains(['example.com']);
  expect(getForSale()).toEqual({});
});

it('imports explicit No, preserves omitted flags, and previews changes without writing', () => {
  setForSale(['example.com'], true);
  const rows = [{ line: 2, domain: 'example.com', forSale: false }];
  expect(planImport(rows).outcomes[0].changes).toContainEqual({
    field: 'For sale',
    from: 'Yes',
    to: 'No',
  });
  expect(getForSale()['example.com']).toBe(true);
  importDomains(rows, { importId: 'test' });
  expect(getForSale()['example.com']).toBe(false);
  importDomains([{ line: 2, domain: 'example.com' }], { importId: 'next' });
  expect(getForSale()['example.com']).toBe(false);
  expect(planImport(rows).outcomes[0].changes).toEqual([]);
});

it('discards malformed flags in backups', () => {
  const backup = JSON.parse(
    exportBundle({ version: 'test', platform: 'test' }),
  );
  backup.namespaces['domain-for-sale'] = { 'example.com': 'true' };
  expect(
    parseBundle(JSON.stringify(backup)).namespaces['domain-for-sale'],
  ).toEqual({});
});
