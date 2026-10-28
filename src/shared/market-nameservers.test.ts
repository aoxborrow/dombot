import { describe, expect, it } from 'vitest';
import {
  MARKET_NAMESERVERS,
  defaultMarketNameservers,
  marketNameserversFor,
} from './market-nameservers';

describe('market nameservers', () => {
  it('finds a set by hostname, exact before assigned', () => {
    expect(marketNameserversFor('ns2.atom.com')?.key).toBe('atom.com');
    expect(marketNameserversFor('abc-ns2.atom.com')?.key).toBe(
      'atom.com#assigned',
    );
    expect(marketNameserversFor('atom.com')).toBeNull();
    expect(marketNameserversFor('ns1.example.com')).toBeNull();
  });

  it('gives each market’s nameservers to point a name at', () => {
    expect(defaultMarketNameservers('afternic')).toEqual([
      'ns1.afternic.com',
      'ns2.afternic.com',
    ]);
    expect(defaultMarketNameservers('atom')).toEqual([
      'ns1.atom.com',
      'ns2.atom.com',
    ]);
    expect(defaultMarketNameservers('sedo')).toEqual([
      'ns1.sedoparking.com',
      'ns2.sedoparking.com',
    ]);
  });

  it('keeps keys unique and hosts lowercase', () => {
    const keys = MARKET_NAMESERVERS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of MARKET_NAMESERVERS) {
      for (const h of s.hosts) expect(h).toBe(h.toLowerCase());
    }
  });
});
