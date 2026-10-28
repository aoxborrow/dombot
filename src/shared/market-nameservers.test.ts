import { describe, expect, it } from 'vitest';
import {
  defaultMarketNameservers,
  marketNameserversFor,
  type MarketInfo,
} from './markets';

const catalog: Pick<MarketInfo, 'id' | 'nameservers'>[] = [
  {
    id: 'afternic',
    nameservers: [
      { key: 'a1', label: 'Afternic (ns1/ns2)', hosts: ['ns1.afternic.com'] },
      // How a market that assigns nameservers per customer would list them.
      {
        key: 'a-assigned',
        label: 'Afternic (yours)',
        hosts: ['*.ns.afternic.com'],
      },
    ],
  },
  {
    id: 'sedo',
    nameservers: [{ key: 's1', label: 'Sedo', hosts: ['ns1.sedoparking.com'] }],
  },
];

describe('market nameservers', () => {
  it('finds a hostname’s market and set, exact before patterns', () => {
    expect(marketNameserversFor(' NS1.Afternic.com. ', catalog)).toEqual({
      market: 'afternic',
      set: catalog[0].nameservers[0],
    });
    expect(marketNameserversFor('x7.ns.afternic.com', catalog)?.set.key).toBe(
      'a-assigned',
    );
    expect(marketNameserversFor('ns.afternic.com', catalog)).toBeNull();
    expect(marketNameserversFor('ns1.sedoparking.com', catalog)?.market).toBe(
      'sedo',
    );
    expect(marketNameserversFor('ns1.example.com', catalog)).toBeNull();
  });

  it('gives a market’s first shared set as the one to point a name at', () => {
    expect(defaultMarketNameservers(catalog[0])).toEqual(['ns1.afternic.com']);
    expect(defaultMarketNameservers({ nameservers: [] })).toEqual([]);
  });
});
