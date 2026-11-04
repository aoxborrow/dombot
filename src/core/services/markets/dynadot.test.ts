import { describe, expect, it } from 'vitest';
import {
  DynadotError,
  type DynadotClient,
  type DynadotExternalDomain,
  type DynadotListing,
} from '../../markets/dynadot';
import {
  DynadotAdapter,
  listingFromDynadot,
  listingFromExternal,
} from './dynadot';

const KEY = '0123456789abcdef0123456789abcdef';

const listing = (over: Partial<DynadotListing> = {}): DynadotListing => ({
  listingId: '21185431',
  name: 'lumenpost.com',
  price: '2500',
  type: 'bin',
  typeRaw: 'BIN',
  pendingSale: false,
  ...over,
});

const external = (
  over: Partial<DynadotExternalDomain> = {},
): DynadotExternalDomain => ({
  name: 'domanio.com',
  registrar: '101domain',
  status: 'Registered',
  verified: true,
  verifyStatusRaw: 'Verified',
  listingType: 'bin_make_offer',
  listingTypeRaw: 'Buy Now + Make Offer',
  price: '1500',
  transferStatus: null,
  updatedAt: '2026-11-03T17:53:25Z',
  ...over,
});

/** A stand-in client: names in the account, their listings, and the other-registrar list. */
function fakeClient(opts: {
  held?: { name: string; forSale: boolean }[];
  listings?: Record<string, DynadotListing | Error>;
  external?: DynadotExternalDomain[];
}) {
  const calls: string[] = [];
  const client = {
    accountInfo: async () => ({ username: 'x', priceLevel: 'Bulk Account' }),
    accountDomains: async () => {
      calls.push('accountDomains');
      return { domains: opts.held ?? [], complete: true };
    },
    getListing: async (name: string) => {
      calls.push(`getListing:${name}`);
      const l = opts.listings?.[name];
      if (l instanceof Error) throw l;
      return l ?? null;
    },
    externalDomains: async () => {
      calls.push('externalDomains');
      return { domains: opts.external ?? [], complete: true };
    },
    verification: async (name: string) => {
      calls.push(`verification:${name}`);
      return {
        name,
        verified: false,
        key: KEY,
        txt: KEY,
        nameservers: [],
        cname: null,
      };
    },
  };
  return {
    adapter: new DynadotAdapter('acct', client as unknown as DynadotClient),
    calls,
  };
}

describe('reading listings', () => {
  it('maps a listing of a name in the account', () => {
    const l = listingFromDynadot(
      listing({ type: 'bin_make_offer', typeRaw: 'BIN_MAKE_OFFER' }),
      'acct',
    );
    expect(l).toMatchObject({
      market: 'dynadot',
      accountId: 'acct',
      name: 'lumenpost.com',
      status: 'active',
      forSale: true,
      price: '2500',
      buyNow: true,
      minOffer: null,
      currency: 'USD',
      extra: {
        market: 'dynadot',
        held: 'dynadot',
        listingId: '21185431',
        offers: true,
        pendingSale: false,
        verified: null,
      },
    });
  });

  it('puts a name with a sale under way on hold', () => {
    const l = listingFromDynadot(listing({ pendingSale: true }), 'acct');
    expect(l.status).toBe('on_hold');
    expect(l.statusRaw).toBe('BIN · pending sale');
  });

  it('maps a name held elsewhere: pending until verified', () => {
    expect(
      listingFromExternal(external({ verified: false }), 'acct'),
    ).toMatchObject({
      status: 'pending',
      forSale: false,
      extra: { held: 'elsewhere', verified: false, registrar: '101domain' },
    });
    expect(listingFromExternal(external(), 'acct')).toMatchObject({
      status: 'active',
      forSale: true,
      price: '1500',
      buyNow: true,
      updatedAt: '2026-11-03T17:53:25Z',
      extra: { offers: true },
    });
    expect(
      listingFromExternal(external({ transferStatus: 'Pending' }), 'acct')
        ?.status,
    ).toBe('on_hold');
  });

  it('leaves out a name held elsewhere that isn’t for sale', () => {
    expect(
      listingFromExternal(
        external({ listingType: null, listingTypeRaw: 'Not Set' }),
        'acct',
      ),
    ).toBeNull();
  });
});

describe('the adapter', () => {
  it('reads the names marked for sale, then the names held elsewhere', async () => {
    const { adapter, calls } = fakeClient({
      held: [
        { name: 'lumenpost.com', forSale: true },
        { name: 'quietfern.net', forSale: false },
      ],
      listings: { 'lumenpost.com': listing() },
      external: [
        external(),
        external({
          name: 'brightloom.com',
          listingType: null,
          listingTypeRaw: 'Not Set',
        }),
      ],
    });
    const read = await adapter.allListings();
    expect(read.complete).toBe(true);
    expect(read.listings.map((l) => [l.name, l.extra])).toEqual([
      ['lumenpost.com', expect.objectContaining({ held: 'dynadot' })],
      ['domanio.com', expect.objectContaining({ held: 'elsewhere' })],
    ]);
    // Only the name marked for sale is read on its own.
    expect(calls).toEqual([
      'accountDomains',
      'getListing:lumenpost.com',
      'externalDomains',
    ]);
  });

  it('keeps going when one listing fails, saying the read is incomplete', async () => {
    const { adapter } = fakeClient({
      held: [
        { name: 'lumenpost.com', forSale: true },
        { name: 'quietfern.net', forSale: true },
      ],
      listings: {
        'lumenpost.com': new DynadotError('HTTP_500', 'Server error', 500),
        'quietfern.net': listing({ name: 'quietfern.net' }),
      },
    });
    const read = await adapter.allListings();
    expect(read.complete).toBe(false);
    expect(read.listings.map((l) => l.name)).toEqual(['quietfern.net']);
  });

  it('stops on a refused key', async () => {
    const { adapter } = fakeClient({
      held: [{ name: 'lumenpost.com', forSale: true }],
      listings: { 'lumenpost.com': new DynadotError('AUTH', 'Bad key', 401) },
    });
    await expect(adapter.allListings()).rejects.toThrow('Bad key');
  });

  it('reads given names from the right list', async () => {
    const { adapter, calls } = fakeClient({
      listings: { 'lumenpost.com': listing() },
      external: [external()],
    });
    const got = await adapter.getListings(['domanio.com', 'lumenpost.com']);
    expect(got.map((l) => l.name).sort()).toEqual([
      'domanio.com',
      'lumenpost.com',
    ]);
    expect(calls).toEqual(['externalDomains', 'getListing:lumenpost.com']);
  });

  it('says listing from DomBot isn’t built yet, name by name', async () => {
    const { adapter } = fakeClient({});
    const [result] = await adapter.writeListings([
      { name: 'lumenpost.com', price: '2500' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNSUPPORTED');
    expect((await adapter.deleteListings(['lumenpost.com']))[0].ok).toBe(false);
  });

  it('reads the account’s key through any name held elsewhere', async () => {
    const { adapter, calls } = fakeClient({ external: [external()] });
    await adapter.allListings();
    expect(await adapter.verificationId()).toBe(KEY);
    // The list read during sync is reused.
    expect(calls.filter((c) => c === 'externalDomains')).toHaveLength(1);
    expect(await fakeClient({}).adapter.verificationId()).toBeNull();
  });
});
