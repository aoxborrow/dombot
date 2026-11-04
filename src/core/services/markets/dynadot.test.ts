import { describe, expect, it } from 'vitest';
import {
  DynadotError,
  type DynadotClient,
  type DynadotExternalDomain,
  type DynadotListing,
  type DynadotListingInput,
} from '../../markets/dynadot';
import {
  DynadotAdapter,
  listingFromDynadot,
  listingFromExternal,
  listingTypeFor,
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
  /** Names on the other-registrar list, and whether Dynadot verified them. */
  verified?: Record<string, boolean>;
}) {
  const calls: string[] = [];
  const sent: { name: string; input: DynadotListingInput }[] = [];
  const client = {
    holds: async (name: string) => {
      calls.push(`holds:${name}`);
      return (opts.held ?? []).some((d) => d.name === name);
    },
    setForSale: async (name: string, input: DynadotListingInput) => {
      calls.push(`setForSale:${name}`);
      sent.push({ name, input });
      // Dynadot now shows what was sent.
      opts.listings = {
        ...opts.listings,
        [name]: listing({
          name,
          price: input.price,
          type: input.listingType,
          typeRaw: input.listingType.toUpperCase(),
        }),
      };
    },
    listExternal: async (name: string, input: DynadotListingInput) => {
      calls.push(`listExternal:${name}`);
      sent.push({ name, input });
    },
    addExternal: async (names: string[]) => {
      calls.push(`addExternal:${names.join(',')}`);
    },
    verifyExternal: async (names: string[]) => {
      calls.push(`verifyExternal:${names.join(',')}`);
      return {
        verified: names.filter((n) => opts.verified?.[n]),
        failed: names.filter((n) => !opts.verified?.[n]),
      };
    },
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
      if (opts.verified && !(name in opts.verified)) return null;
      return {
        name,
        verified: opts.verified?.[name] ?? false,
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
    sent,
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

describe('listing types', () => {
  it('keeps offers on, starts new listings as Buy Now', () => {
    expect(listingTypeFor('2500', null)).toBe('bin');
    expect(listingTypeFor('2500', 'bin')).toBe('bin');
    expect(listingTypeFor('2500', 'make_offer')).toBe('bin_make_offer');
    expect(listingTypeFor('2500', 'bin_make_offer')).toBe('bin_make_offer');
    expect(listingTypeFor(null, 'bin')).toBe('make_offer');
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

  it('reprices a name in the account, keeping whether it takes offers', async () => {
    const { adapter, sent } = fakeClient({
      held: [{ name: 'lumenpost.com', forSale: true }],
      listings: {
        'lumenpost.com': listing({
          type: 'bin_make_offer',
          typeRaw: 'BIN_MAKE_OFFER',
        }),
      },
    });
    const [r] = await adapter.writeListings([
      { name: 'lumenpost.com', price: '3000' },
    ]);
    expect(r).toMatchObject({ ok: true, error: null, adjusted: [] });
    expect(r.saved).toMatchObject({ price: '3000', extra: { offers: true } });
    expect(sent).toEqual([
      {
        name: 'lumenpost.com',
        input: {
          forSale: true,
          listingType: 'bin_make_offer',
          price: '3000',
          minOffer: null,
          currency: 'USD',
        },
      },
    ]);
  });

  it('leaves a listing with a sale under way alone', async () => {
    const { adapter, sent } = fakeClient({
      held: [{ name: 'lumenpost.com', forSale: true }],
      listings: { 'lumenpost.com': listing({ pendingSale: true }) },
    });
    const [r] = await adapter.writeListings([
      { name: 'lumenpost.com', price: '3000' },
    ]);
    expect(r.error?.code).toBe('ON_HOLD');
    expect(sent).toEqual([]);
  });

  it('adds a name held elsewhere and says it needs verifying first', async () => {
    const { adapter, calls, sent } = fakeClient({ verified: {} });
    const [r] = await adapter.writeListings([
      { name: 'domanio.com', price: '999999' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('NOT_VERIFIED');
    expect(r.error?.message).toMatch(/Added domanio\.com/);
    expect(calls).toContain('addExternal:domanio.com');
    expect(sent).toEqual([]);
  });

  it('won’t list a name held elsewhere until Dynadot has verified it', async () => {
    const { adapter, sent } = fakeClient({
      verified: { 'domanio.com': false },
    });
    const [r] = await adapter.writeListings([
      { name: 'domanio.com', price: '999999' },
    ]);
    expect(r.error?.code).toBe('NOT_VERIFIED');
    expect(sent).toEqual([]);
  });

  it('lists a verified name held elsewhere', async () => {
    const { adapter, sent } = fakeClient({
      verified: { 'domanio.com': true },
    });
    const [r] = await adapter.writeListings([
      { name: 'domanio.com', price: '999999' },
    ]);
    expect(r.ok).toBe(true);
    expect(sent[0].input).toMatchObject({
      forSale: true,
      listingType: 'bin',
      price: '999999',
    });
    expect(r.saved).toMatchObject({
      status: 'active',
      price: '999999',
      extra: { held: 'elsewhere', verified: true },
    });
  });

  it('refuses what DomBot can’t set on Dynadot, sending nothing', async () => {
    const { adapter, calls } = fakeClient({});
    const results = await adapter.writeListings([
      { name: 'lumenpost.com', floor: '100' },
      { name: 'lumenpost.com', minOffer: '100' },
      { name: 'lumenpost.com', currency: 'EUR' },
      { name: 'lumenpost.com', forSale: false },
    ]);
    expect(results.map((r) => r.error?.code)).toEqual([
      'UNSUPPORTED',
      'UNSUPPORTED',
      'UNSUPPORTED',
      'UNSUPPORTED',
    ]);
    expect(calls).toEqual([]);
  });

  it('delists either kind, and counts a name with no listing as delisted', async () => {
    const { adapter, sent } = fakeClient({
      held: [
        { name: 'lumenpost.com', forSale: true },
        { name: 'quietfern.net', forSale: false },
      ],
      listings: { 'lumenpost.com': listing() },
      verified: { 'domanio.com': true },
    });
    const results = await adapter.deleteListings([
      'lumenpost.com',
      'quietfern.net',
      'domanio.com',
      'brightloom.com',
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(sent.map((s) => [s.name, s.input.forSale])).toEqual([
      ['lumenpost.com', false],
      ['domanio.com', false],
    ]);
  });

  it('asks Dynadot to verify a name held elsewhere', async () => {
    const { adapter } = fakeClient({
      verified: { 'domanio.com': true, 'brightloom.com': false },
    });
    expect((await adapter.verifyDns('domanio.com')).ok).toBe(true);
    const r = await adapter.verifyDns('brightloom.com');
    expect(r.error?.code).toBe('NOT_VERIFIED');
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
