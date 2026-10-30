import { describe, expect, it } from 'vitest';
import { domainsLink, parseDomainsLink } from './domains-link';

describe('domainsLink', () => {
  it('is plain / with no filters', () => {
    expect(domainsLink({})).toBe('/');
    expect(domainsLink({ markets: [] })).toBe('/');
  });

  it('round-trips the view and the Markets and Pricing filters', () => {
    const link = domainsLink({
      view: 'listings',
      markets: ['afternic'],
      states: ['none'],
      comparisons: ['below'],
      asking: ['forSale'],
    });
    const params = new URLSearchParams(link.split('?')[1]);
    expect(parseDomainsLink(params)).toEqual({
      view: 'listings',
      markets: ['afternic'],
      states: ['none'],
      comparisons: ['below'],
      asking: ['forSale'],
    });
  });

  it('drops values it does not know', () => {
    const params = new URLSearchParams(
      'view=bogus&states=active,bogus&prices=lower',
    );
    expect(parseDomainsLink(params)).not.toHaveProperty('view');
    expect(parseDomainsLink(params)).toMatchObject({
      states: ['active'],
      comparisons: [],
    });
  });
});
