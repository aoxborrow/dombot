import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { exportBundle, importBundle } from '../storage/bundle';
import { ownershipByDomain } from '../../shared/ownership';
import { isOpenAlert, resolvedIds } from '../../shared/sync-diff';
import { listAccounts } from './accounts';
import { clearAll } from './cache';
import { listEvents } from './domain-events';
import { deleteDomains, recordSync } from './domain-history';
import {
  addManualDomains,
  getManualDomains,
  updateManualDomain,
} from './manual-domains';
import { getPortfolioPricing } from './registrars';
import { setManualPrice } from './pricing';

let store: MemoryDocStore;
beforeEach(async () => {
  await flushWrites().catch(() => {});
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
});

const acct = () => listAccounts()[0].id;
const holding = (names: string[]) => [
  { accountId: acct(), names, synced: true, known: true },
];
const open = () => {
  const events = listEvents();
  const resolved = resolvedIds(events);
  return events.filter((e) => isOpenAlert(e, resolved));
};

describe('manual domains', () => {
  it('adds names with their fields, each waiting for review like an arrival', async () => {
    const added = addManualDomains(
      [
        {
          domainName: 'Münich.DE',
          fields: {
            registrar: 'dynadot',
            expirationDate: '2027-05-01',
            autoRenew: true,
          },
        },
        { domainName: 'epik-name.com', fields: { registrarLabel: ' Epik ' } },
      ],
      { source: 'import', importId: 'imp1' },
    );
    expect(added).toEqual(['xn--mnich-kva.de', 'epik-name.com']);
    expect(getManualDomains()).toMatchObject({
      'xn--mnich-kva.de': {
        registrar: 'dynadot',
        registrarLabel: null,
        expirationDate: '2027-05-01',
        autoRenew: true,
        importId: 'imp1',
      },
      'epik-name.com': { registrar: null, registrarLabel: 'Epik' },
    });
    expect(open().map((e) => [e.type, e.domain, e.source, e.importId])).toEqual(
      [
        ['added', 'xn--mnich-kva.de', 'import', 'imp1'],
        ['added', 'epik-name.com', 'import', 'imp1'],
      ],
    );
    // A second add of the same name changes nothing.
    expect(
      addManualDomains([{ domainName: 'epik-name.com' }], { source: 'user' }),
    ).toEqual([]);
    clearAll();
    await flushWrites();
    expect(Object.keys(await store.list('manual-domains'))).toHaveLength(2);
  });

  it('refuses an unknown registrar id and a bad date', () => {
    expect(() =>
      addManualDomains(
        [{ domainName: 'a.com', fields: { registrar: 'nope' } }],
        { source: 'user' },
      ),
    ).toThrow('Unknown registrar nope.');
    expect(() =>
      addManualDomains(
        [{ domainName: 'a.com', fields: { expirationDate: '2027-02-30' } }],
        { source: 'user' },
      ),
    ).toThrow('Expiration date is not a real calendar day.');
  });

  it('edits the registration fields', () => {
    addManualDomains([{ domainName: 'a.com' }], { source: 'user' });
    const next = updateManualDomain('a.com', {
      registrar: null,
      registrarLabel: 'Sav',
      createdDate: '2020-01-01',
      expirationDate: null,
      autoRenew: false,
    });
    expect(next).toMatchObject({
      registrarLabel: 'Sav',
      createdDate: '2020-01-01',
      autoRenew: false,
      updatedAt: expect.any(Number),
    });
    expect(() => updateManualDomain('b.com', {})).toThrow("isn't a manual");
  });

  it('takes a name that left an account back without a new review', () => {
    recordSync(holding(['a.com']));
    recordSync(holding([]));
    expect(open().map((e) => e.type)).toEqual(['removed']);
    addManualDomains([{ domainName: 'a.com' }], { source: 'import' });
    expect(open()).toEqual([]);
    expect(ownershipByDomain(listEvents()).get('a.com')?.archived).toBe(false);
  });

  it('hands a name to the account that reports it, with no new arrival', () => {
    recordSync(holding(['b.com']));
    addManualDomains([{ domainName: 'a.com' }], { source: 'user' });
    const events = recordSync(holding(['a.com', 'b.com']));
    expect(events.map((e) => [e.type, e.domain, e.fromAccountId])).toEqual([
      ['moved', 'a.com', null],
    ]);
    expect(getManualDomains()).toEqual({});
    expect(ownershipByDomain(listEvents()).get('a.com')?.archived).toBe(false);
  });

  it("hands over on an account's first sync too", () => {
    addManualDomains([{ domainName: 'a.com' }], { source: 'user' });
    const events = recordSync(holding(['a.com']));
    expect(events.map((e) => [e.type, e.toAccountId])).toEqual([
      ['moved', acct()],
    ]);
    expect(getManualDomains()).toEqual({});
  });

  it('is removed by Delete', () => {
    addManualDomains([{ domainName: 'a.com' }], { source: 'user' });
    deleteDomains(['a.com']);
    expect(getManualDomains()).toEqual({});
  });

  it('is priced from your price, or the base rate of a known registrar', () => {
    addManualDomains(
      [
        { domainName: 'a.com', fields: { registrar: 'dynadot' } },
        { domainName: 'b.com', fields: { registrarLabel: 'Epik' } },
      ],
      { source: 'user' },
    );
    setManualPrice('b.com', { amount: '30', currency: 'EUR' });
    const pricing = getPortfolioPricing();
    expect(pricing['dynadot:a.com']).toMatchObject({ source: 'base' });
    expect(pricing[':b.com']).toMatchObject({
      renewal: 30,
      currency: 'EUR',
      source: 'manual',
    });
  });

  it('travels in the data bundle', async () => {
    addManualDomains(
      [{ domainName: 'a.com', fields: { registrar: 'porkbun' } }],
      { source: 'user' },
    );
    const text = exportBundle({ version: 'test', platform: 'test' });
    configureStore(new MemoryDocStore());
    await hydrateStores();
    await importBundle(text);
    expect(getManualDomains()['a.com']).toMatchObject({ registrar: 'porkbun' });
  });
});
