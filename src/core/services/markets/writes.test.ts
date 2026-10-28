import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MarketListing,
  MarketListingChange,
  MarketSale,
  MarketWriteResult,
} from '../../../shared/markets';
import { MemoryDocStore } from '../../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../../storage/namespace';
import { AFTERNIC_CAPABILITIES } from './afternic';

// A fake market that records what it was asked to write.
const fake = {
  written: [] as MarketListingChange[][],
  deleted: [] as string[][],
  relisted: [] as string[][],
  relistModes: [] as (string | undefined)[],
  relistFails: new Set<string>(),
  authCodes: [] as [string, string][],
  sales: [] as MarketSale[],
  batch: 500,
  asyncInsert: false,
  savedForSale: true,
};
const listingOf = (name: string, accountId: string): MarketListing => ({
  market: 'afternic',
  accountId,
  name,
  displayName: null,
  status: 'pending',
  statusRaw: 'PENDING',
  forSale: true,
  price: '100',
  buyNow: true,
  minOffer: '20',
  floor: null,
  discount: null,
  currency: 'USD',
  leaseToOwn: null,
  tier: null,
  listedAt: null,
  updatedAt: null,
  extra: {} as MarketListing['extra'],
});
const ok = (name: string, saved: MarketListing | null = null) =>
  ({
    name,
    ok: true,
    pending: false,
    saved,
    adjusted: [],
    error: null,
  }) as MarketWriteResult;

vi.mock('./registry', async () => {
  const { AFTERNIC_CONFIG_FIELDS } = await import('./afternic');
  return {
    isMarketId: () => true,
    marketInfo: () => ({
      id: 'afternic',
      name: 'Afternic',
      configFields: AFTERNIC_CONFIG_FIELDS,
    }),
    buildAdapter: (_m: string, accountId: string) => ({
      market: 'afternic',
      accountId,
      get capabilities() {
        return {
          ...AFTERNIC_CAPABILITIES,
          writeBatch: fake.batch,
          asyncInsert: fake.asyncInsert,
        };
      },
      test: async () => ({ listings: 0, notes: [] }),
      allListings: async () => ({ listings: [], complete: true }),
      allSales: async () => fake.sales.map((s) => ({ ...s, accountId })),
      accountStats: async () => [],
      writeListings: async (changes: MarketListingChange[]) => {
        fake.written.push(changes);
        return changes.map((c) =>
          ok(c.name, {
            ...listingOf(c.name, accountId),
            status: 'active',
            forSale: c.forSale ?? fake.savedForSale,
          }),
        );
      },
      deleteListings: async (names: string[]) => {
        fake.deleted.push(names);
        return names.map((n) => ok(n));
      },
      relist: async (names: string[], mode?: string) => {
        fake.relisted.push(names);
        fake.relistModes.push(mode);
        return names.map((n) =>
          fake.relistFails.has(n)
            ? {
                ...ok(n),
                ok: false,
                error: { code: 'HTTP_422', message: 'on hold' },
              }
            : ok(n),
        );
      },
      getListings: async (names: string[]) =>
        names.map((n) => ({ ...listingOf(n, accountId), status: 'active' })),
      setSaleAuthCode: async (saleId: string, code: string) => {
        fake.authCodes.push([saleId, code]);
      },
    }),
  };
});
const held = new Map<string, string>();
vi.mock('../registrars', () => ({
  getCachedPortfolio: () => ({ domains: [] }),
  findRegistrarsForDomain: (name: string) =>
    held.has(name) ? [held.get(name)] : [],
  resolveDomainAccount: (registrar: string) => ({ id: `${registrar}-1` }),
}));
const applyDomainOp = vi.fn();
vi.mock('../domain-ops', () => ({
  applyDomainOp: (...a: unknown[]) => applyDomainOp(...a),
}));

const { connectMarketAccount } = await import('./accounts');
const { marketListings, putMarketListings, syncMarketAccount } =
  await import('./sync');
const { setListPrices } = await import('../list-prices');
const writes = await import('./writes');

const ID = '00000000-0000-4000-8000-0000000000c1';
const price = (domainName: string, amount: string | null, extra = {}) => ({
  domainName,
  amount,
  minOffer: null,
  floor: null,
  currency: 'USD',
  ...extra,
});

beforeEach(async () => {
  await flushWrites().catch(() => {});
  configureStore(new MemoryDocStore());
  await hydrateStores();
  Object.assign(fake, {
    written: [],
    deleted: [],
    relisted: [],
    relistModes: [],
    relistFails: new Set(),
    authCodes: [],
    sales: [],
    batch: 500,
    asyncInsert: false,
    savedForSale: true,
  });
  held.clear();
  applyDomainOp.mockReset();
  await connectMarketAccount(
    'afternic',
    { apiKey: 'k', apiSecret: 's' },
    '',
    ID,
  );
});

describe('pushAskingPrices', () => {
  it('sends DomBot’s asking prices and skips names it can’t send', async () => {
    setListPrices([
      price('priced.com', '2500', { minOffer: '100', floor: '1000' }),
      price('offers.com', null, { minOffer: '50' }),
      price('euro.com', '900', { currency: 'EUR' }),
    ]);
    const results = await writes.pushAskingPrices(ID, [
      'priced.com',
      'offers.com',
      'euro.com',
      'none.com',
    ]);
    expect(results.map((r) => [r.name, r.ok, r.error?.code])).toEqual([
      ['priced.com', true, undefined],
      ['offers.com', true, undefined],
      ['euro.com', false, 'CURRENCY'],
      ['none.com', false, 'NO_PRICE'],
    ]);
    expect(fake.written).toEqual([
      [
        {
          name: 'priced.com',
          price: '2500',
          minOffer: '100',
          floor: '1000',
          currency: 'USD',
        },
        // No BIN in DomBot: offers only, and Afternic keeps its own floor
        // cleared to match.
        {
          name: 'offers.com',
          price: null,
          minOffer: '50',
          floor: null,
          currency: 'USD',
        },
      ],
    ]);
    // What was saved shows in the table before the next sync.
    expect(
      marketListings()
        .map((l) => l.name)
        .sort(),
    ).toEqual(['offers.com', 'priced.com']);
  });

  it('re-runs the market’s checks on listings that were stuck', async () => {
    putMarketListings(ID, [
      { ...listingOf('inactive.com', ID), status: 'inactive' },
      { ...listingOf('rejected.com', ID), status: 'rejected' },
      { ...listingOf('stuck.com', ID), status: 'pending' },
      { ...listingOf('fine.com', ID), status: 'active' },
      { ...listingOf('held.com', ID), status: 'rejected' },
    ]);
    fake.relistFails.add('held.com');
    const names = [
      'inactive.com',
      'rejected.com',
      'stuck.com',
      'fine.com',
      'held.com',
      'new.com',
    ];
    setListPrices(names.map((n) => price(n, '500')));
    const results = await writes.pushAskingPrices(ID, names);

    // Inactive ones are reactivated, the other stuck ones resynced; listings
    // that were fine, and names listed for the first time, are left alone.
    expect(fake.relisted).toEqual([
      ['inactive.com'],
      ['rejected.com', 'stuck.com', 'held.com'],
    ]);
    expect(fake.relistModes).toEqual(['REACTIVATE', 'RESYNC']);
    const by = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(by['inactive.com'].relisted).toEqual({ ok: true, message: null });
    expect(by['inactive.com'].saved?.status).toBe('active');
    expect(by['held.com']).toMatchObject({
      ok: true,
      relisted: { ok: false, message: 'on hold' },
    });
    expect(by['fine.com'].relisted).toBeUndefined();
    expect(by['new.com'].relisted).toBeUndefined();
  });

  it('writes in the market’s batch size', async () => {
    fake.batch = 2;
    setListPrices(['a.com', 'b.com', 'c.com'].map((n) => price(n, '100')));
    await writes.pushAskingPrices(ID, ['a.com', 'b.com', 'c.com']);
    expect(fake.written.map((b) => b.length)).toEqual([2, 1]);
  });
});

describe('delist and relist', () => {
  it('drops delisted names from the stored listings', async () => {
    await writes.writeMarketListings(ID, [{ name: 'a.com', price: '100' }]);
    await writes.deleteMarketListings(ID, ['a.com']);
    expect(fake.deleted).toEqual([['a.com']]);
    expect(marketListings()).toEqual([]);
  });

  it('reads relisted names back for their new status', async () => {
    await writes.relistMarketListings(ID, ['a.com'], 'RESYNC');
    expect(fake.relisted).toEqual([['a.com']]);
    expect(marketListings()[0]).toMatchObject({
      name: 'a.com',
      status: 'active',
    });
  });
});

describe('setSaleAuthCode', () => {
  const sale = {
    market: 'afternic',
    accountId: ID,
    id: 'tx-1',
    name: 'sold.com',
    soldOn: '2026-10-20',
    status: 'in_progress',
    statusRaw: 'AWAITING_AUTH_CODE',
    kind: 'buy_now',
    price: '499',
    commission: null,
    commissionEstimated: false,
    net: null,
    currency: 'USD',
    installments: null,
    paidOutOn: null,
    action: 'auth_code',
  } as MarketSale;

  beforeEach(async () => {
    fake.sales = [sale];
    await syncMarketAccount(ID);
  });

  it('gets the code from the registrar holding the name', async () => {
    held.set('sold.com', 'dynadot');
    applyDomainOp.mockResolvedValue({
      status: 'ok',
      message: '',
      data: { authCode: ' secret-1 ' },
    });
    expect(await writes.setSaleAuthCode(ID, 'tx-1')).toEqual({
      name: 'sold.com',
      fetched: true,
    });
    expect(applyDomainOp).toHaveBeenCalledWith(
      { registrar: 'dynadot', domainName: 'sold.com', accountId: 'dynadot-1' },
      { kind: 'authCode' },
    );
    expect(fake.authCodes).toEqual([['tx-1', 'secret-1']]);
  });

  it('uses a code you give it without asking the registrar', async () => {
    await writes.setSaleAuthCode(ID, 'tx-1', 'typed');
    expect(applyDomainOp).not.toHaveBeenCalled();
    expect(fake.authCodes).toEqual([['tx-1', 'typed']]);
  });

  it('says why when no account holds the name', async () => {
    await expect(writes.setSaleAuthCode(ID, 'tx-1')).rejects.toThrow(
      /None of your registrar accounts holds sold\.com/,
    );
    expect(fake.authCodes).toEqual([]);
  });

  it('refuses an unknown sale', async () => {
    await expect(writes.setSaleAuthCode(ID, 'nope', 'x')).rejects.toThrow(
      /No such sale/,
    );
  });
});

describe('listingAccount', () => {
  it('picks the account a name is listed in, or the only one', async () => {
    expect(writes.listingAccount('new.com')).toBe(ID);
    await writes.writeMarketListings(ID, [{ name: 'a.com', price: '1' }]);
    expect(writes.listingAccount('A.com')).toBe(ID);
  });
});

describe('names in the market’s ownership check', () => {
  it('stay pending through a price edit, unless taken off sale', async () => {
    fake.asyncInsert = true;
    // The market saves the edit but still has the name off sale.
    fake.savedForSale = false;
    putMarketListings(ID, [
      { ...listingOf('verifying.com', ID), status: 'pending', forSale: true },
      { ...listingOf('parked.com', ID), status: 'pending', forSale: true },
    ]);
    const results = await writes.writeMarketListings(ID, [
      { name: 'verifying.com', price: '900' },
      { name: 'parked.com', forSale: false },
    ]);
    expect(results.map((r) => [r.name, r.pending])).toEqual([
      ['verifying.com', true],
      ['parked.com', false],
    ]);
    const stored = Object.fromEntries(
      marketListings().map((l) => [l.name, [l.status, l.forSale]]),
    );
    expect(stored).toEqual({
      'verifying.com': ['pending', true],
      'parked.com': ['active', false],
    });
  });
});
