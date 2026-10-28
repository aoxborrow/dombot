import { describe, expect, it } from 'vitest';
import { AtomClient, AtomError } from '../../markets/atom';
import type { AtomListing } from '../../markets/atom';
import { RateLimiter, type Clock } from '../../markets/rate-limit';
import * as fx from '../../markets/atom/fixtures';
import {
  AtomAdapter,
  checkAtomChange,
  discountUntil,
  estimatedCommission,
  listingFromAtom,
  saleFromAtom,
  statusFromAtom,
} from './atom';

const NOW = Date.parse('2026-10-28T12:00:00Z'); // a Wednesday

function listing(overrides: Partial<AtomListing> = {}): AtomListing {
  return {
    name: 'brightloom.com',
    displayName: 'BrightLoom.com',
    id: '77',
    type: 'standard',
    typeRaw: 'Standard',
    status: 'Seller Approved',
    price: 2500,
    discount: null,
    primaryCategory: 'Technology',
    description: 'A bright name',
    listedAt: null,
    ...overrides,
  };
}

/** An adapter over a fake Atom that keeps one account's listings in memory. */
function fakeAtom(
  initial: AtomListing[] = [],
  fail: Record<string, string> = {},
  /** Paths that answer success but change nothing, as Atom's price update
   *  does for a Make an Offer listing (observed). */
  ignored: ReadonlySet<string> = new Set(),
) {
  const listings = new Map(initial.map((l) => [l.name, { ...l }]));
  const calls: string[] = [];
  const clock: Clock = { now: () => NOW, sleep: async () => undefined };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/api/marketplace', '');
    const q = url.searchParams;
    const name = q.get('domain_name') ?? '';
    calls.push(path);
    const reply = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200 });
    if (fail[path]) return reply({ message: fail[path] });
    if (ignored.has(path)) {
      return reply({ message: 'Successfully updated selling price' });
    }
    // The fake follows what Atom did live (docs/atom-api.md, "Observed").
    const l = listings.get(name);
    const price = (v: string | null) => Number(v) || null;
    switch (path) {
      case '/domain-details':
        return reply(
          l
            ? fx.listingRecord(l.displayName ?? l.name, {
                listing_type: l.typeRaw,
                status: l.status,
                full_price: l.price ?? 0,
                selling_price: (l.price ?? 0) - (l.discount ?? 0),
                discount: l.discount ?? 0,
                primary_category: l.primaryCategory,
                description: l.description,
              })
            : fx.notListed,
        );
      case '/add-domain': {
        // Adds, or updates in place: the price changes, the tier doesn't.
        const tier = q.get('domain_type') === 'plus' ? 'plus' : 'standard';
        if (l) {
          l.price = price(q.get('price'));
          l.status = 'Seller Approved';
          return reply({ message: 'Successfully uploaded' });
        }
        listings.set(
          name,
          listing({
            name,
            displayName: null,
            type: tier,
            typeRaw: tier === 'plus' ? 'Plus' : 'Standard',
            status: 'Seller Approved',
            price: price(q.get('price')),
            primaryCategory: null,
            description: null,
          }),
        );
        return reply({
          message: `Successfully uploaded${tier === 'plus' ? ' as Plus' : ''}`,
        });
      }
      case '/update-selling-price':
        // Ignored on a Make an Offer listing; clears any discount.
        if (l!.price !== null) l!.price = price(q.get('selling_price'));
        l!.discount = null;
        return reply({ message: 'Successfully updated selling price' });
      case '/assign-primary-category':
        l!.primaryCategory = q.get('category_name');
        return reply({ message: 'Assigned primary category' });
      case '/update-description':
        if (!q.get('domain_description')) {
          return reply({ message: 'Domain description is empty' });
        }
        l!.description = q.get('domain_description');
        return reply({ message: 'Successfully updated Domain description' });
      case '/add-discount':
        if (!Number(q.get('discount'))) {
          return reply({ message: 'Discount Price should not be empty' });
        }
        l!.discount = Number(q.get('discount'));
        return reply({ message: 'Successfully updated Discount price' });
      case '/remove-domain':
        // Still has details afterwards, as "Delisted".
        if (l) l.status = 'Delisted';
        return reply({ message: 'Successfully removed the domain' });
      default:
        return reply({ message: `unexpected ${path}` });
    }
  }) as typeof fetch;
  const client = new AtomClient({
    apiToken: 'tok',
    userId: '1',
    fetch: fetchImpl,
    clock,
    limiter: new RateLimiter(clock, 6000),
  });
  return {
    atom: new AtomAdapter('acct-1', client, () => NOW),
    listings,
    calls,
  };
}

describe('reading', () => {
  it('maps statuses', () => {
    expect(statusFromAtom('Approved')).toBe('active');
    expect(statusFromAtom('Seller Approved')).toBe('active');
    expect(statusFromAtom('Pending Review')).toBe('pending');
    expect(statusFromAtom('DNS Unverified')).toBe('inactive');
    expect(statusFromAtom('Rejected')).toBe('rejected');
    expect(statusFromAtom('Sold')).toBe('sold');
    // Observed: sold names stay listed with this status.
    expect(statusFromAtom('Transfer Complete')).toBe('sold');
    expect(statusFromAtom('')).toBe('unknown');
  });

  it('maps a listing into the shared shape', () => {
    const l = listingFromAtom(listing({ discount: 200 }), 'acct-1', {
      now: NOW,
    });
    expect(l).toMatchObject({
      market: 'atom',
      name: 'brightloom.com',
      displayName: 'BrightLoom.com',
      status: 'active',
      forSale: true,
      price: '2500',
      buyNow: true,
      minOffer: null,
      floor: null,
      discount: { amount: '200', until: '2026-11-02' },
      currency: 'USD',
      tier: 'standard',
      extra: {
        market: 'atom',
        category: 'Technology',
        syndicationAuthorized: null,
      },
    });
  });

  it('marks Premium names Atom lets you list elsewhere', () => {
    const syndicated = new Set(['quillnest.com']);
    const premium = (name: string) =>
      listingFromAtom(listing({ name, type: 'premium' }), 'a', { syndicated });
    expect(premium('quillnest.com').extra).toMatchObject({
      syndicationAuthorized: true,
    });
    expect(premium('otherone.com').extra).toMatchObject({
      syndicationAuthorized: false,
    });
  });

  it('lasts a discount until the next Monday', () => {
    expect(discountUntil(Date.parse('2026-11-02T08:00:00Z'))).toBe(
      '2026-11-09',
    );
    expect(discountUntil(Date.parse('2026-11-01T23:00:00Z'))).toBe(
      '2026-11-02',
    );
  });

  it('estimates commission from the tier when Atom gives none', () => {
    expect(estimatedCommission('standard', 1000)).toBe(75);
    expect(estimatedCommission('plus', 1000)).toBe(150);
    expect(estimatedCommission('premium', 4200)).toBeCloseTo(1260);
    expect(estimatedCommission('premium', 60_000)).toBe(12_000);
    expect(estimatedCommission(null, 1000)).toBeNull();
    const sale = saleFromAtom(
      {
        id: '9001',
        name: 'quillnest.com',
        type: 'premium',
        soldOn: '2026-05-02',
        terms: 'Outright',
        transferStatus: 'AuthCode Sent',
        price: 4200,
        commission: null,
        net: null,
        paidOutOn: null,
        listedOn: '2020-12-03',
        installments: null,
      },
      'acct-1',
    );
    expect(sale).toMatchObject({
      status: 'completed',
      price: '4200',
      commission: '1260',
      commissionEstimated: true,
      net: '2940',
      currency: 'USD',
    });
  });
});

describe('checkAtomChange', () => {
  it('rejects what Atom can’t do', () => {
    const bad = [
      { name: 'a.com', minOffer: '500' },
      { name: 'a.com', floor: '500' },
      { name: 'a.com', currency: 'EUR' as const },
      { name: 'a.com', forSale: false },
      { name: 'a.com', buyNow: false },
      { name: 'a.com', price: '99' },
      { name: 'a.com', price: '150.50' },
      {
        name: 'a.com',
        price: '500',
        extra: { market: 'atom' as const, tier: 'premium' as never },
      },
      { name: 'a.com', extra: { market: 'sedo' as const, language: 'en' } },
      {
        name: 'a.com',
        extra: { market: 'atom' as const, category: 'Fitness & Gym' },
      },
    ];
    for (const change of bad) expect(() => checkAtomChange(change)).toThrow();
    expect(() =>
      checkAtomChange({ name: 'a.com', price: '2500.00' }),
    ).not.toThrow();
  });
});

describe('writing', () => {
  it('lists a new name as Standard and reads it back', async () => {
    const { atom, calls } = fakeAtom();
    const [r] = await atom.writeListings([
      {
        name: 'brightloom.com',
        price: '2500',
        extra: {
          market: 'atom',
          category: 'Technology',
          description: 'Bright',
        },
      },
    ]);
    expect(r).toMatchObject({
      ok: true,
      pending: false,
      error: null,
      adjusted: [],
    });
    expect(r.saved).toMatchObject({ price: '2500', tier: 'standard' });
    expect(calls).toEqual([
      '/domain-details',
      '/add-domain',
      '/assign-primary-category',
      '/update-description',
      '/domain-details',
    ]);
  });

  it('reprices only what changed, and sends nothing for a no-op', async () => {
    const { atom, calls } = fakeAtom([listing()]);
    await atom.writeListings([{ name: 'brightloom.com', price: '2500' }]);
    expect(calls).toEqual(['/domain-details']);
    calls.length = 0;
    const [r] = await atom.writeListings([
      { name: 'brightloom.com', price: '3000' },
    ]);
    expect(r.saved?.price).toBe('3000');
    expect(calls).toEqual([
      '/domain-details',
      '/update-selling-price',
      '/domain-details',
    ]);
  });

  it('prices a Make an Offer listing by adding it again', async () => {
    const { atom, calls } = fakeAtom([
      listing({ price: null, typeRaw: 'Plus', type: 'plus' }),
    ]);
    const [r] = await atom.writeListings([
      { name: 'brightloom.com', price: '500' },
    ]);
    expect(r).toMatchObject({ ok: true, error: null });
    expect(r.saved).toMatchObject({ price: '500', tier: 'plus' });
    expect(calls).toEqual([
      '/domain-details',
      '/add-domain',
      '/domain-details',
    ]);
  });

  it('turns a priced listing into Make an Offer with a price of 0', async () => {
    const { atom } = fakeAtom([listing()]);
    const [r] = await atom.writeListings([
      { name: 'brightloom.com', price: null },
    ]);
    expect(r.saved).toMatchObject({ price: null, buyNow: false });
  });

  it('fails a price Atom says it saved but didn’t', async () => {
    const { atom } = fakeAtom(
      [listing()],
      {},
      new Set(['/update-selling-price']),
    );
    const [r] = await atom.writeListings([
      { name: 'brightloom.com', price: '500' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('NOT_APPLIED');
    expect(r.error?.message).toMatch(/still shows \$2500/);
  });

  it('says which steps were saved when a later one fails', async () => {
    const { atom } = fakeAtom([listing()], {
      '/update-description': 'Description must be at least 20 characters',
    });
    const [r] = await atom.writeListings([
      {
        name: 'brightloom.com',
        price: '3000',
        extra: { market: 'atom', description: 'Hi' },
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('REJECTED');
    expect(r.error?.message).toMatch(/already saved: price/);
  });

  it('fails a new name without a price, and an unsupported field, without writing', async () => {
    const { atom, calls } = fakeAtom();
    const [noPrice] = await atom.writeListings([
      {
        name: 'brightloom.com',
        extra: { market: 'atom', category: 'Technology' },
      },
    ]);
    expect(noPrice.error?.code).toBe('NO_PRICE');
    const [floor] = await atom.writeListings([
      { name: 'brightloom.com', floor: '100' },
    ]);
    expect(floor.error?.code).toBe('UNSUPPORTED');
    expect(calls).toEqual(['/domain-details']);
  });

  it('takes one name per call', async () => {
    const { atom } = fakeAtom();
    await expect(
      atom.writeListings([{ name: 'a.com' }, { name: 'b.com' }]),
    ).rejects.toThrow(/one name/);
  });

  it('delists Standard names, counts unlisted ones as done, refuses Premium', async () => {
    const { atom, listings } = fakeAtom([
      listing(),
      listing({ name: 'quillnest.com', type: 'premium', typeRaw: 'Premium' }),
    ]);
    expect((await atom.deleteListings(['brightloom.com']))[0].ok).toBe(true);
    expect(listings.get('brightloom.com')?.status).toBe('Delisted');
    // Delisted reads as not listed, so listing it again adds it back.
    expect(await atom.getListings(['brightloom.com'])).toEqual([]);
    const [again] = await atom.writeListings([
      { name: 'brightloom.com', price: '900' },
    ]);
    expect(again.saved).toMatchObject({ price: '900', status: 'active' });
    expect((await atom.deleteListings(['nothere.com']))[0].ok).toBe(true);
    const [premium] = await atom.deleteListings(['quillnest.com']);
    expect(premium.error?.code).toBe('PREMIUM');
    expect(listings.get('quillnest.com')?.status).not.toBe('Delisted');
  });

  it('sets and clears a discount', async () => {
    const { atom } = fakeAtom([listing()]);
    const set = await atom.setDiscount('brightloom.com', '200');
    expect(set.saved?.discount).toEqual({ amount: '200', until: '2026-11-02' });
    const cleared = await atom.setDiscount('brightloom.com', null);
    expect(cleared.saved?.discount).toBeNull();
    const tooMuch = await atom.setDiscount('brightloom.com', '800');
    expect(tooMuch.error?.code).toBe('UNSUPPORTED');
    expect(tooMuch.error?.message).toMatch(/30%.*\$750/);
  });
});

describe('errors', () => {
  it('keeps AtomError codes on results', async () => {
    const { atom } = fakeAtom([], {
      '/domain-details': fx.invalidToken.message,
    });
    const [r] = await atom.writeListings([
      { name: 'brightloom.com', price: '2500' },
    ]);
    expect(r.error?.code).toBe('AUTH');
    expect(new AtomError('AUTH', 'x').retryable).toBe(false);
  });
});
