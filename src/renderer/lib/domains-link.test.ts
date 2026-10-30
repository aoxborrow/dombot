import { describe, expect, it } from 'vitest';
import { domainsLink, parseDomainsLink } from './domains-link';

describe('domainsLink', () => {
  it('is plain /domains with no filters', () => {
    expect(domainsLink({})).toBe('/domains');
    expect(domainsLink({ markets: [] })).toBe('/domains');
  });

  it('round-trips the Markets and Pricing filters', () => {
    const link = domainsLink({
      markets: ['afternic'],
      states: ['none'],
      comparisons: ['below'],
      asking: ['forSale'],
    });
    const params = new URLSearchParams(link.split('?')[1]);
    expect(parseDomainsLink(params)).toEqual({
      markets: ['afternic'],
      states: ['none'],
      comparisons: ['below'],
      asking: ['forSale'],
    });
  });

  it('drops values it does not know', () => {
    const params = new URLSearchParams('states=active,bogus&prices=lower');
    expect(parseDomainsLink(params)).toMatchObject({
      states: ['active'],
      comparisons: [],
    });
  });
});
