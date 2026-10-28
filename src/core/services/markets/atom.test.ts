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
    const l = listings.get(name);
    switch (path) {
      case '/domain-details':
        return reply(
          l
            ? {
                data: fx.listingRecord(l.displayName ?? l.name, {
                  listing_type: l.typeRaw,
                  status: l.status,
                  full_price: l.price ?? 0,
                  selling_price: l.price ?? 0,
                  discount: l.discount ?? 0,
                  primary_category: l.primaryCategory,
                  description: l.description,
                }),
              }
            : { message: 'Domain not found' },
        );
      case '/add-domain':
        listings.set(
          name,
          listing({
            name,
            displayName: null,
            type: q.get('domain_type') as AtomListing['type'],
            typeRaw: q.get('domain_type') === 'plus' ? 'Plus' : 'Standard',
            status: 'Seller Approved',
            price: Number(q.get('price')),
            primaryCategory: null,
            description: null,
          }),
        );
        return reply({ message: 'Domain added successfully' });
      case '/update-selling-price':
        l!.price = Number(q.get('selling_price'));
        return reply(fx.ok);
      case '/assign-primary-category':
        l!.primaryCategory = q.get('category_name');
        return reply(fx.ok);
      case '/update-description':
        l!.description = q.get('domain_description');
        return reply(fx.ok);
      case '/add-discount':
        l!.discount = Number(q.get('discount')) || null;
        return reply(fx.ok);
      case '/remove-domain':
        listings.delete(name);
        return reply({ message: 'Domain removed successfully' });
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
      { name: 'a.com', price: null },
      { name: 'a.com', price: '99' },
      { name: 'a.com', price: '150.50' },
      {
        name: 'a.com',
        price: '500',
        extra: { market: 'atom' as const, tier: 'premium' as never },
      },
      { name: 'a.com', extra: { market: 'sedo' as const, language: 'en' } },
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

  it('fails a price Atom says it saved but didn’t', async () => {
    const { atom } = fakeAtom(
      [listing({ price: null })],
      {},
      new Set(['/update-selling-price']),
    );
    const [r] = await atom.writeListings([
      { name: 'brightloom.com', price: '500' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('NOT_APPLIED');
    expect(r.error?.message).toMatch(/still shows Make an Offer/);
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
    expect(listings.has('brightloom.com')).toBe(false);
    expect((await atom.deleteListings(['nothere.com']))[0].ok).toBe(true);
    const [premium] = await atom.deleteListings(['quillnest.com']);
    expect(premium.error?.code).toBe('PREMIUM');
    expect(listings.has('quillnest.com')).toBe(true);
  });

  it('sets and clears a discount', async () => {
    const { atom } = fakeAtom([listing()]);
    const set = await atom.setDiscount('brightloom.com', '200');
    expect(set.saved?.discount).toEqual({ amount: '200', until: '2026-11-02' });
    const cleared = await atom.setDiscount('brightloom.com', null);
    expect(cleared.saved?.discount).toBeNull();
    const tooMuch = await atom.setDiscount('brightloom.com', '2500');
    expect(tooMuch.error?.code).toBe('UNSUPPORTED');
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
