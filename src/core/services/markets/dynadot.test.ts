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
  listingFor,
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
  /** Names whose TXT record is in place: asking Dynadot verifies them. */
  txtInPlace?: string[];
  /** What Dynadot answers each `set_for_sale` with instead of taking it. */
  refuse?: Error[];
  /** What Dynadot answers locking a name again with. */
  relockError?: Error;
  /** What Dynadot answers unlocking a name with. */
  unlockError?: Error;
  /** DomBot's minimum offers (its asking prices), in USD. */
  minOffers?: Record<string, string>;
  /** DomBot's asking prices, when not in USD. */
  asking?: Record<string, { currency: string; minOffer: string | null }>;
}) {
  const calls: string[] = [];
  const sent: { name: string; input: DynadotListingInput }[] = [];
  /** The currency each listing read asked for. */
  const readIn: string[] = [];
  const client = {
    holds: async (name: string) => {
      calls.push(`holds:${name}`);
      return (opts.held ?? []).some((d) => d.name === name);
    },
    setForSale: async (name: string, input: DynadotListingInput) => {
      calls.push(`setForSale:${name}`);
      const refusal = opts.refuse?.shift();
      if (refusal) throw refusal;
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
    setLock: async (name: string, locked: boolean) => {
      calls.push(`setLock:${name}:${locked}`);
      if (locked && opts.relockError) throw opts.relockError;
      if (!locked && opts.unlockError) throw opts.unlockError;
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
      for (const n of names) {
        if (opts.txtInPlace?.includes(n) && opts.verified && n in opts.verified)
          opts.verified[n] = true;
      }
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
    getListing: async (name: string, currency: string) => {
      calls.push(`getListing:${name}`);
      readIn.push(`${name}:${currency}`);
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
    adapter: new DynadotAdapter(
      'acct',
      client as unknown as DynadotClient,
      (name) =>
        opts.asking?.[name] ??
        (opts.minOffers?.[name]
          ? { currency: 'USD', minOffer: opts.minOffers[name] }
          : null),
    ),
    calls,
    sent,
    readIn,
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

describe('what a change sends', () => {
  type Current = Parameters<typeof listingFor>[1];
  const bin: Current = { type: 'bin', price: '2500' };
  const offers: Current = { type: 'bin_make_offer', price: '2500' };

  it('picks Buy Now, Make Offer or both from the price and minimum offer', () => {
    const at = (change: object, current: Current = null) =>
      listingFor({ name: 'x.com', ...change }, current);
    expect(at({ price: '2500' })).toEqual({
      listingType: 'bin',
      price: '2500',
      minOffer: null,
    });
    expect(at({ price: '2500', minOffer: '500' }).listingType).toBe(
      'bin_make_offer',
    );
    expect(at({ price: null, minOffer: '500' }).listingType).toBe('make_offer');
    // A change that leaves the price keeps it.
    expect(at({ minOffer: '500' }, bin)).toMatchObject({ price: '2500' });
    // Clearing the minimum turns offers off.
    expect(at({ price: '3000', minOffer: null }, offers).listingType).toBe(
      'bin',
    );
  });

  it('sends DomBot’s minimum offer to a listing that takes offers', () => {
    expect(listingFor({ name: 'x.com', price: '3000' }, offers, '600')).toEqual(
      { listingType: 'bin_make_offer', price: '3000', minOffer: '600' },
    );
    // The change's own minimum comes first.
    expect(
      listingFor(
        { name: 'x.com', price: '3000', minOffer: '700' },
        offers,
        '600',
      ).minOffer,
    ).toBe('700');
    // A Buy Now listing stays Buy Now.
    expect(
      listingFor({ name: 'x.com', price: '3000' }, bin, '600').listingType,
    ).toBe('bin');
  });

  it('won’t touch a listing that takes offers without a minimum in DomBot', () => {
    expect(() => listingFor({ name: 'x.com', price: '3000' }, offers)).toThrow(
      /Set one in DomBot’s asking price/,
    );
    expect(() =>
      listingFor({ name: 'x.com', price: '3000' }, offers, '0.50'),
    ).toThrow(/\$1\.00 or more/);
    expect(() =>
      listingFor({ name: 'x.com', price: '3000', minOffer: '0.5' }, bin),
    ).toThrow(/\$1\.00 or more/);
    // Other currencies: Dynadot says.
    expect(
      listingFor(
        { name: 'x.com', price: '3000', minOffer: '500' },
        bin,
        null,
        'KRW',
      ).minOffer,
    ).toBe('500');
  });

  it('needs a price or a minimum offer', () => {
    expect(() => listingFor({ name: 'x.com', price: null }, null)).toThrow(
      /Buy Now price, a minimum offer, or both/,
    );
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

  it('reprices a name in the account, with the minimum offer Dynadot needs', async () => {
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
      { name: 'lumenpost.com', price: '3000', minOffer: '750' },
    ]);
    expect(r).toMatchObject({ ok: true, error: null, adjusted: [] });
    // Dynadot never shows the minimum back, so neither does DomBot.
    expect(r.saved).toMatchObject({
      price: '3000',
      minOffer: null,
      extra: { offers: true },
    });
    expect(sent).toEqual([
      {
        name: 'lumenpost.com',
        input: {
          forSale: true,
          listingType: 'bin_make_offer',
          price: '3000',
          minOffer: '750',
          currency: 'USD',
        },
      },
    ]);
  });

  it('reprices a listing that takes offers with DomBot’s minimum', async () => {
    const { adapter, sent } = fakeClient({
      held: [{ name: 'lumenpost.com', forSale: true }],
      listings: {
        'lumenpost.com': listing({
          type: 'bin_make_offer',
          typeRaw: 'BIN_MAKE_OFFER',
        }),
      },
      minOffers: { 'lumenpost.com': '900' },
    });
    const [r] = await adapter.writeListings([
      { name: 'lumenpost.com', price: '3000' },
    ]);
    expect(r.ok).toBe(true);
    expect(sent[0].input).toMatchObject({
      listingType: 'bin_make_offer',
      price: '3000',
      minOffer: '900',
    });
  });

  it('won’t reprice a listing that takes offers without a minimum in DomBot', async () => {
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
    expect(r.error?.code).toBe('UNSUPPORTED');
    expect(sent).toEqual([]);
  });

  const domainLocked = () =>
    new DynadotError(
      'DOMAIN_LOCKED',
      'Domain is locked. Please unlock domain first.',
      409,
    );
  const accountLocked = () =>
    new DynadotError(
      'ACCOUNT_LOCKED',
      'Please unlock your account firstly.',
      400,
    );

  it('unlocks a locked name to write, then locks it again', async () => {
    const { adapter, calls } = fakeClient({
      held: [{ name: 'testbot.io', forSale: true }],
      listings: { 'testbot.io': listing({ name: 'testbot.io' }) },
      refuse: [domainLocked()],
    });
    const [r] = await adapter.writeListings([
      { name: 'testbot.io', price: '500' },
    ]);
    expect(r).toMatchObject({ ok: true, error: null });
    expect(calls.filter((c) => !c.startsWith('getListing'))).toEqual([
      'holds:testbot.io',
      'setForSale:testbot.io',
      'setLock:testbot.io:false',
      'setForSale:testbot.io',
      'setLock:testbot.io:true',
    ]);
  });

  it('says the account must be unlocked, and locks the name again', async () => {
    const { adapter, calls } = fakeClient({
      held: [{ name: 'testbot.io', forSale: true }],
      listings: { 'testbot.io': listing({ name: 'testbot.io' }) },
      refuse: [domainLocked(), accountLocked()],
    });
    const [r] = await adapter.writeListings([
      { name: 'testbot.io', price: '500' },
    ]);
    expect(r.error?.code).toBe('ACCOUNT_LOCKED');
    expect(r.error?.message).toBe(
      'Dynadot account must be unlocked to change listings.',
    );
    expect(calls.at(-1)).toBe('setLock:testbot.io:true');
  });

  it('says so when it can’t lock a name again', async () => {
    const { adapter } = fakeClient({
      held: [{ name: 'testbot.io', forSale: true }],
      listings: { 'testbot.io': listing({ name: 'testbot.io' }) },
      refuse: [domainLocked()],
      relockError: new DynadotError('HTTP_500', 'Server error', 500),
    });
    const [r] = await adapter.writeListings([
      { name: 'testbot.io', price: '500' },
    ]);
    expect(r.error?.code).toBe('RELOCK_FAILED');
    expect(r.error?.message).toMatch(/couldn’t lock it again \(Server error\)/);
  });

  it('locks a name again when the unlock’s answer is lost', async () => {
    const { adapter, calls } = fakeClient({
      held: [{ name: 'testbot.io', forSale: true }],
      listings: { 'testbot.io': listing({ name: 'testbot.io' }) },
      refuse: [domainLocked()],
      unlockError: new DynadotError(
        'TIMEOUT',
        'Dynadot did not respond in time.',
        0,
      ),
    });
    const [r] = await adapter.writeListings([
      { name: 'testbot.io', price: '500' },
    ]);
    expect(r.error?.code).toBe('TIMEOUT');
    expect(calls.filter((c) => c.startsWith('setLock'))).toEqual([
      'setLock:testbot.io:false',
      'setLock:testbot.io:true',
    ]);
  });

  it('says a name may be unlocked when neither lock call is answered', async () => {
    const { adapter } = fakeClient({
      held: [{ name: 'testbot.io', forSale: true }],
      listings: { 'testbot.io': listing({ name: 'testbot.io' }) },
      refuse: [domainLocked()],
      unlockError: new DynadotError('NETWORK', 'Could not reach Dynadot.', 0),
      relockError: new DynadotError('NETWORK', 'Could not reach Dynadot.', 0),
    });
    const [r] = await adapter.writeListings([
      { name: 'testbot.io', price: '500' },
    ]);
    expect(r.error?.code).toBe('RELOCK_FAILED');
    expect(r.error?.message).toMatch(/^testbot\.io may be unlocked/);
  });

  it('leaves the lock alone when Dynadot refuses the unlock', async () => {
    const { adapter, calls } = fakeClient({
      held: [{ name: 'testbot.io', forSale: true }],
      listings: { 'testbot.io': listing({ name: 'testbot.io' }) },
      refuse: [domainLocked()],
      unlockError: new DynadotError('INVALID', 'Not allowed.', 400),
    });
    const [r] = await adapter.writeListings([
      { name: 'testbot.io', price: '500' },
    ]);
    expect(r.error?.code).toBe('INVALID');
    expect(calls.filter((c) => c.startsWith('setLock'))).toEqual([
      'setLock:testbot.io:false',
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

  it('adds a name held elsewhere, pending until Dynadot verifies it', async () => {
    const { adapter, calls, sent } = fakeClient({ verified: {} });
    const [r] = await adapter.writeListings([
      { name: 'domanio.com', price: '999999', minOffer: '5000' },
    ]);
    expect(r).toMatchObject({ ok: true, pending: true, error: null });
    // What DomBot asked for, held until Dynadot can take it.
    expect(r.saved).toMatchObject({
      status: 'pending',
      forSale: true,
      price: '999999',
      minOffer: '5000',
      extra: { held: 'elsewhere', verified: false },
    });
    expect(calls).toContain('addExternal:domanio.com');
    expect(sent).toEqual([]);
  });

  it('lists a name right away when Dynadot verifies it on asking', async () => {
    const { adapter, calls, sent } = fakeClient({
      verified: { 'domanio.com': false },
      txtInPlace: ['domanio.com'],
    });
    const [r] = await adapter.writeListings([
      { name: 'domanio.com', price: '999999' },
    ]);
    expect(r).toMatchObject({ ok: true, pending: false });
    expect(r.saved?.status).toBe('active');
    expect(calls).toContain('verifyExternal:domanio.com');
    expect(sent[0].input).toMatchObject({ forSale: true, price: '999999' });
  });

  it('holds a listing for a name Dynadot hasn’t verified yet', async () => {
    const { adapter, calls, sent } = fakeClient({
      verified: { 'domanio.com': false },
    });
    const [r] = await adapter.writeListings([
      { name: 'domanio.com', price: '999999' },
    ]);
    expect(r).toMatchObject({ ok: true, pending: true });
    expect(r.saved?.status).toBe('pending');
    expect(calls).not.toContain('addExternal:domanio.com');
    expect(sent).toEqual([]);
  });

  it('lists a pending name once Dynadot has verified it', async () => {
    const verified: Record<string, boolean> = {
      'domanio.com': false,
      'domainio.com': false,
    };
    const { adapter, sent } = fakeClient({ verified });
    const [held] = await adapter.writeListings([
      { name: 'domanio.com', price: '999999', minOffer: '5000' },
    ]);
    const [other] = await adapter.writeListings([
      { name: 'domainio.com', price: '888888' },
    ]);
    verified['domanio.com'] = true;
    const results = await adapter.listVerified([held.saved!, other.saved!]);
    expect(sent).toEqual([
      {
        name: 'domanio.com',
        input: {
          forSale: true,
          listingType: 'bin_make_offer',
          price: '999999',
          minOffer: '5000',
          currency: 'USD',
        },
      },
    ]);
    expect(results[0]).toMatchObject({
      ok: true,
      pending: false,
      saved: { status: 'active', price: '999999', minOffer: null },
    });
    // Still waiting: the row as it was.
    expect(results[1]).toMatchObject({ ok: true, pending: true });
    expect(results[1].saved).toBe(other.saved);
  });

  it('fails a pending name that left Dynadot’s list', async () => {
    const { adapter, sent } = fakeClient({ verified: {} });
    const [held] = await adapter.writeListings([
      { name: 'domanio.com', price: '999999' },
    ]);
    const [r] = await adapter.listVerified([held.saved!]);
    expect(r.error?.code).toBe('NOT_FOUND');
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

  it('keeps the seller’s price for a name held elsewhere, not the buyer’s', async () => {
    const { adapter, sent } = fakeClient({
      verified: { 'domanio.com': true },
      // The listing read adds Dynadot's transfer fee (observed).
      listings: {
        'domanio.com': listing({ name: 'domanio.com', price: '1000008.62' }),
      },
      external: [
        external({
          listingType: 'bin',
          listingTypeRaw: 'Buy Now',
          price: '999997',
        }),
      ],
    });
    const [r] = await adapter.writeListings([
      { name: 'domanio.com', minOffer: '500' },
    ]);
    expect(r.ok).toBe(true);
    expect(sent[0].input).toMatchObject({
      listingType: 'bin_make_offer',
      price: '999997',
      minOffer: '500',
    });
    expect(r.adjusted).toEqual([]);
  });

  it('fails a write to a name held elsewhere when its listing can’t be read', async () => {
    const { adapter, sent } = fakeClient({
      verified: { 'domanio.com': true },
      listings: {
        'domanio.com': new DynadotError('HTTP_500', 'Server error', 500),
      },
    });
    const [r] = await adapter.writeListings([
      { name: 'domanio.com', price: '999999' },
    ]);
    expect(r.error?.code).toBe('HTTP_500');
    expect(sent).toEqual([]);
  });

  it('leaves a name held elsewhere alone while a sale is under way', async () => {
    const { adapter, sent } = fakeClient({
      verified: { 'domanio.com': true },
      listings: {
        'domanio.com': listing({ name: 'domanio.com', pendingSale: true }),
      },
    });
    const [r] = await adapter.writeListings([
      { name: 'domanio.com', price: '999999' },
    ]);
    expect(r.error?.code).toBe('ON_HOLD');
    expect(sent).toEqual([]);
  });

  it('won’t delist either kind while a sale is under way', async () => {
    const { adapter, sent } = fakeClient({
      held: [{ name: 'lumenpost.com', forSale: true }],
      listings: {
        'lumenpost.com': listing({ pendingSale: true }),
        'domanio.com': listing({ name: 'domanio.com', pendingSale: true }),
      },
      verified: { 'domanio.com': true },
    });
    const results = await adapter.deleteListings([
      'lumenpost.com',
      'domanio.com',
    ]);
    expect(results.map((r) => r.error?.code)).toEqual(['ON_HOLD', 'ON_HOLD']);
    expect(sent).toEqual([]);
  });

  it('matches an IDN on the other-registrar list by its punycode', async () => {
    const { adapter, calls } = fakeClient({
      external: [external({ name: 'xn--bcher-kva.com' })],
    });
    const got = await adapter.getListings(['bücher.com']);
    expect(got.map((l) => [l.name, l.extra])).toEqual([
      ['xn--bcher-kva.com', expect.objectContaining({ held: 'elsewhere' })],
    ]);
    expect(calls).toEqual(['externalDomains']);
  });

  it('refuses what DomBot can’t set on Dynadot, sending nothing', async () => {
    const { adapter, calls } = fakeClient({});
    const results = await adapter.writeListings([
      { name: 'lumenpost.com', floor: '100' },
      // Not one Dynadot lists in.
      { name: 'lumenpost.com', currency: 'SEK' },
      { name: 'lumenpost.com', forSale: false },
    ]);
    expect(results.map((r) => r.error?.code)).toEqual([
      'UNSUPPORTED',
      'UNSUPPORTED',
      'UNSUPPORTED',
    ]);
    expect(results[1].error?.message).toBe('Dynadot doesn’t list in SEK.');
    expect(calls).toEqual([]);
  });

  it('lists a name in the account in the currency asked for, and reads it back in it', async () => {
    const { adapter, sent, readIn } = fakeClient({
      held: [{ name: 'lumenpost.com', forSale: false }],
    });
    const [r] = await adapter.writeListings([
      { name: 'lumenpost.com', price: '2500', currency: 'EUR' },
    ]);
    expect(r.ok).toBe(true);
    expect(sent[0].input).toMatchObject({ price: '2500', currency: 'EUR' });
    expect(readIn).toEqual(['lumenpost.com:EUR', 'lumenpost.com:EUR']);
    expect(r.saved).toMatchObject({ price: '2500', currency: 'EUR' });
  });

  it('reads a name in the account in its DomBot currency, when Dynadot takes it', async () => {
    const { adapter, readIn } = fakeClient({
      held: [
        { name: 'lumenpost.com', forSale: true },
        { name: 'quietfern.net', forSale: true },
        { name: 'harborlane.com', forSale: true },
      ],
      listings: {
        'lumenpost.com': listing(),
        'quietfern.net': listing({ name: 'quietfern.net' }),
        'harborlane.com': listing({ name: 'harborlane.com' }),
      },
      asking: {
        'lumenpost.com': { currency: 'EUR', minOffer: null },
        'quietfern.net': { currency: 'SEK', minOffer: null },
      },
    });
    const { listings } = await adapter.allListings();
    expect(readIn).toEqual([
      'lumenpost.com:EUR',
      'quietfern.net:USD',
      'harborlane.com:USD',
    ]);
    expect(listings.map((l) => l.currency)).toEqual(['EUR', 'USD', 'USD']);
  });

  it('sends DomBot’s minimum offer only in the currency it’s in', async () => {
    const { adapter, sent } = fakeClient({
      held: [{ name: 'lumenpost.com', forSale: true }],
      listings: {
        'lumenpost.com': listing({
          type: 'bin_make_offer',
          typeRaw: 'BIN_MAKE_OFFER',
        }),
      },
      asking: { 'lumenpost.com': { currency: 'EUR', minOffer: '400' } },
    });
    const [usd] = await adapter.writeListings([
      { name: 'lumenpost.com', price: '3000', currency: 'USD' },
    ]);
    expect(usd.error?.code).toBe('UNSUPPORTED');
    const [eur] = await adapter.writeListings([
      { name: 'lumenpost.com', price: '3000', currency: 'EUR' },
    ]);
    expect(eur.ok).toBe(true);
    expect(sent[0].input).toMatchObject({ minOffer: '400', currency: 'EUR' });
  });

  it('says so when Dynadot refuses a currency it documents', async () => {
    const { adapter } = fakeClient({
      held: [{ name: 'lumenpost.com', forSale: false }],
      // One account took 14 of the 32 (observed).
      refuse: [
        new DynadotError(
          'INVALID',
          'The value for parameter currency is invalid.',
          400,
        ),
      ],
    });
    const [r] = await adapter.writeListings([
      { name: 'lumenpost.com', price: '250000', currency: 'JPY' },
    ]);
    expect(r.error).toEqual({
      code: 'CURRENCY',
      message: 'Dynadot didn’t accept JPY for this listing.',
    });
  });

  it('counts a name held elsewhere that Dynadot hasn’t verified as delisted', async () => {
    const { adapter, sent } = fakeClient({
      verified: { 'domainio.com': false },
    });
    const [r] = await adapter.deleteListings(['domainio.com']);
    expect(r).toMatchObject({ ok: true, error: null });
    expect(sent).toEqual([]);
  });

  it('lists a name held elsewhere in the currency asked for', async () => {
    const { adapter, sent } = fakeClient({
      verified: { 'domanio.com': true },
    });
    const [r] = await adapter.writeListings([
      { name: 'domanio.com', price: '999999', currency: 'EUR' },
    ]);
    expect(sent[0].input).toMatchObject({ price: '999999', currency: 'EUR' });
    // As sent, until a sync reads the list's USD.
    expect(r.saved).toMatchObject({ price: '999999', currency: 'EUR' });
  });

  it('keeps a listed name held elsewhere at its price in USD, the only one the list shows', async () => {
    const { adapter, sent } = fakeClient({
      verified: { 'domanio.com': true },
      listings: {
        'domanio.com': listing({
          name: 'domanio.com',
          price: '1115081.50',
          type: 'bin',
        }),
      },
      external: [external({ price: '1115069.88' })],
    });
    const [kept] = await adapter.writeListings([
      { name: 'domanio.com', minOffer: '5000' },
    ]);
    expect(kept.ok).toBe(true);
    expect(sent[0].input).toMatchObject({
      price: '1115069.88',
      minOffer: '5000',
      currency: 'USD',
    });
    const [refused] = await adapter.writeListings([
      { name: 'domanio.com', minOffer: '5000', currency: 'EUR' },
    ]);
    expect(refused.error?.message).toMatch(/Give a price in EUR too/);
  });

  it('holds a pending name in its currency and lists it in that one', async () => {
    const verified: Record<string, boolean> = { 'domanio.com': false };
    const { adapter, sent } = fakeClient({ verified });
    const [held] = await adapter.writeListings([
      { name: 'domanio.com', price: '999999', currency: 'GBP' },
    ]);
    expect(held.saved).toMatchObject({ status: 'pending', currency: 'GBP' });
    verified['domanio.com'] = true;
    await adapter.listVerified([held.saved!]);
    expect(sent[0].input).toMatchObject({ price: '999999', currency: 'GBP' });
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
