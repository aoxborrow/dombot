import { describe, expect, it } from 'vitest';
import type { MarketListing } from '../../../shared/markets';
import { AFTERNIC_CAPABILITIES } from '../../../core/services/markets/afternic';
import { ATOM_CAPABILITIES } from '../../../core/services/markets/atom';
import { SEDO_CAPABILITIES } from '../../../core/services/markets/sedo';
import { listingChange, type ListingForm } from './market-listing-change';

const listing = (over: Partial<MarketListing> = {}): MarketListing => ({
  market: 'afternic',
  accountId: 'a1',
  name: 'example.com',
  displayName: null,
  status: 'active',
  statusRaw: 'ACTIVE',
  forSale: true,
  price: '5000',
  buyNow: true,
  minOffer: '500',
  floor: null,
  discount: null,
  currency: 'USD',
  leaseToOwn: { enabled: false, maxPayments: null },
  tier: null,
  listedAt: null,
  updatedAt: null,
  extra: null as unknown as MarketListing['extra'],
  ...over,
});

const form = (over: Partial<ListingForm> = {}): ListingForm => ({
  price: '5000',
  minOffer: '500',
  floor: null,
  currency: 'USD',
  leaseToOwn: false,
  ...over,
});

describe('listingChange', () => {
  it('sends nothing when nothing changed', () => {
    expect(
      listingChange('example.com', listing(), AFTERNIC_CAPABILITIES, form()),
    ).toEqual({ name: 'example.com' });
  });

  it('sends only the fields that changed on a listed name', () => {
    expect(
      listingChange(
        'example.com',
        listing(),
        AFTERNIC_CAPABILITIES,
        form({ price: '4000.00', leaseToOwn: true }),
      ),
    ).toEqual({
      name: 'example.com',
      price: '4000.00',
      leaseToOwn: { enabled: true },
    });
  });

  it('treats equal amounts written differently as unchanged', () => {
    expect(
      listingChange(
        'example.com',
        listing(),
        AFTERNIC_CAPABILITIES,
        form({ price: '5000.00', minOffer: '500.0' }),
      ),
    ).toEqual({ name: 'example.com' });
  });

  it('clears a price to take offers only', () => {
    expect(
      listingChange(
        'example.com',
        listing(),
        AFTERNIC_CAPABILITIES,
        form({ price: null }),
      ),
    ).toEqual({ name: 'example.com', price: null });
  });

  it('makes a hidden listing visible, but not one still being verified', () => {
    expect(
      listingChange(
        'example.com',
        listing({ forSale: false }),
        AFTERNIC_CAPABILITIES,
        form(),
      ),
    ).toEqual({ name: 'example.com', forSale: true });
    expect(
      listingChange(
        'example.com',
        listing({ market: 'sedo', forSale: false, status: 'pending' }),
        SEDO_CAPABILITIES,
        form(),
      ),
    ).toEqual({ name: 'example.com' });
  });

  it('never sends what the market lacks (Atom: one price, USD)', () => {
    expect(
      listingChange(
        'example.com',
        null,
        ATOM_CAPABILITIES,
        form({ minOffer: '500', floor: '900', leaseToOwn: true }),
      ),
    ).toEqual({ name: 'example.com', price: '5000' });
  });

  it('sends everything set for a new listing, leasing either way', () => {
    expect(
      listingChange(
        'example.com',
        null,
        AFTERNIC_CAPABILITIES,
        form({ floor: '3000' }),
      ),
    ).toEqual({
      name: 'example.com',
      price: '5000',
      minOffer: '500',
      floor: '3000',
      leaseToOwn: { enabled: false },
    });
  });

  it('sends Sedo’s currency with the price', () => {
    const sedo = listing({ market: 'sedo', currency: 'EUR' });
    expect(
      listingChange(
        'example.com',
        sedo,
        SEDO_CAPABILITIES,
        form({ currency: 'EUR' }),
      ),
    ).toEqual({ name: 'example.com' });
    expect(
      listingChange(
        'example.com',
        sedo,
        SEDO_CAPABILITIES,
        form({ currency: 'USD' }),
      ),
    ).toEqual({ name: 'example.com', price: '5000', currency: 'USD' });
  });
});
