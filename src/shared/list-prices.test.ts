import { describe, expect, it } from 'vitest';
import type { ListPrice } from './ipc';
import { hasAskingKind, matchesAsking, type AskingKind } from './list-prices';

const price = (fields: Partial<ListPrice>): ListPrice => ({
  amount: null,
  currency: 'USD',
  updatedAt: 0,
  ...fields,
});

const bin = price({ amount: '5000' });
const offer = price({ minOffer: '500' });
const both = price({ amount: '5000', minOffer: '1000' });
const floorOnly = price({ floor: '300' });

describe('hasAskingKind', () => {
  const kinds = (p: ListPrice | undefined) =>
    (['forSale', 'bin', 'minOffer', 'none'] as AskingKind[]).filter((k) =>
      hasAskingKind(p, k),
    );

  it('counts a BIN price or a minimum offer as for sale', () => {
    expect(kinds(bin)).toEqual(['forSale', 'bin']);
    expect(kinds(offer)).toEqual(['forSale', 'minOffer']);
    expect(kinds(both)).toEqual(['forSale', 'bin', 'minOffer']);
  });

  it('counts no price, or a floor alone, as not for sale', () => {
    expect(kinds(undefined)).toEqual(['none']);
    expect(kinds(floorOnly)).toEqual(['none']);
  });
});

describe('matchesAsking', () => {
  const all = [undefined, bin, offer, both, floorOnly];
  const match = (filter: Parameters<typeof matchesAsking>[1]) =>
    all.filter((p) => matchesAsking(p, filter));

  it('matches any of the kinds picked', () => {
    expect(match({})).toEqual(all);
    expect(match({ kinds: ['bin', 'minOffer'] })).toEqual([bin, offer, both]);
    expect(match({ kinds: ['none'] })).toEqual([undefined, floorOnly]);
  });

  it('needs the amount a range is on', () => {
    // An offers-only name isn't a $0 BIN price.
    expect(match({ bin: { min: null, max: 10000 } })).toEqual([bin, both]);
    expect(match({ minOffer: { min: 600, max: null } })).toEqual([both]);
  });

  it('needs both amounts when both ranges are set', () => {
    expect(
      match({ bin: { min: 1, max: null }, minOffer: { min: 1, max: null } }),
    ).toEqual([both]);
  });

  it('bounds are inclusive', () => {
    expect(match({ bin: { min: 5000, max: 5000 } })).toEqual([bin, both]);
  });

  it('only ranges a price in the given currency', () => {
    const euros = price({ amount: '5000', currency: 'EUR' });
    const range = { bin: { min: 1000, max: null }, currency: 'USD' };
    expect(matchesAsking(bin, range)).toBe(true);
    expect(matchesAsking(euros, range)).toBe(false);
    // Kinds alone ignore currency.
    expect(matchesAsking(euros, { kinds: ['bin'], currency: 'USD' })).toBe(
      true,
    );
  });
});
