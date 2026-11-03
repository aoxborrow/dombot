import { describe, it, expect } from 'vitest';

import {
  marketNameserverPresets,
  nameserverPresets,
  withMarketPresets,
  sameNameservers,
  validateNameservers,
} from './nameserver-input';

describe('validateNameservers', () => {
  it('parses one host per line, trimming, lowercasing, and stripping dots', () => {
    const r = validateNameservers('  NS1.Example.NET.\nns2.example.net\n\n');
    expect(r.nameservers).toEqual(['ns1.example.net', 'ns2.example.net']);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('also splits on commas and spaces (pasted from a dashboard)', () => {
    expect(
      validateNameservers('ns1.a.com, ns2.a.com ns3.a.com').nameservers,
    ).toEqual(['ns1.a.com', 'ns2.a.com', 'ns3.a.com']);
  });

  it('drops duplicates with a warning', () => {
    const r = validateNameservers('ns1.a.com\nNS1.A.COM\nns2.a.com');
    expect(r.nameservers).toEqual(['ns1.a.com', 'ns2.a.com']);
    expect(r.warnings).toEqual(['Duplicate removed: ns1.a.com']);
  });

  it('rejects invalid hostnames', () => {
    const r = validateNameservers('ns1.a.com\nnot a host\n-bad.com\nlocalhost');
    expect(r.nameservers).toEqual(['ns1.a.com']);
    expect(r.errors).toEqual([
      'Not a valid hostname: not',
      'Not a valid hostname: a',
      'Not a valid hostname: host',
      'Not a valid hostname: -bad.com',
      'Not a valid hostname: localhost',
    ]);
  });

  it('warns on a single nameserver and errors on none or too many', () => {
    expect(validateNameservers('ns1.a.com').warnings).toEqual([
      'Most registries require at least two nameservers.',
    ]);
    expect(validateNameservers('  \n ').errors).toEqual([
      'Enter at least one nameserver.',
    ]);
    const many = Array.from({ length: 14 }, (_, i) => `ns${i}.a.com`).join(
      '\n',
    );
    expect(validateNameservers(many).errors).toEqual([
      'At most 13 nameservers.',
    ]);
  });
});

describe('sameNameservers', () => {
  it('ignores order, case, and trailing dots', () => {
    expect(
      sameNameservers(['NS2.a.com.', 'ns1.a.com'], ['ns1.a.com', 'ns2.a.com']),
    ).toBe(true);
    expect(sameNameservers(['ns1.a.com'], ['ns1.a.com', 'ns2.a.com'])).toBe(
      false,
    );
  });
});

describe('nameserverPresets', () => {
  const cf = ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'];
  const dyna = ['ns1.dyna-ns.net', 'ns2.dyna-ns.net'];
  const domains = [
    { nameservers: cf },
    { nameservers: cf },
    { nameservers: dyna },
    { nameservers: [] },
  ];

  it('lists recent sets first, then the most common portfolio sets', () => {
    const presets = nameserverPresets(domains, [dyna]);
    expect(presets.map((p) => p.label)).toEqual([
      'Recent · dyna-ns.net',
      'cloudflare.com · 2 domains',
    ]);
    expect(presets[1].nameservers).toEqual(cf);
  });

  it('dedupes a recent set against the portfolio and caps the portfolio sets', () => {
    const presets = nameserverPresets(domains, [cf], 1);
    expect(presets.map((p) => p.label)).toEqual([
      'Recent · cloudflare.com',
      'dyna-ns.net · 1 domain',
    ]);
    expect(nameserverPresets(domains, [cf], 0).map((p) => p.label)).toEqual([
      'Recent · cloudflare.com',
    ]);
  });
});

describe('marketNameserverPresets', () => {
  const markets = [
    {
      id: 'afternic' as const,
      name: 'Afternic',
      nameservers: [
        {
          key: 'a1',
          label: 'Afternic',
          hosts: ['ns1.afternic.com', 'ns2.afternic.com'],
        },
      ],
    },
    {
      id: 'sedo' as const,
      name: 'Sedo',
      nameservers: [
        {
          key: 's1',
          label: 'Sedo',
          hosts: ['ns1.sedoparking.com', 'ns2.sedoparking.com'],
        },
      ],
    },
  ];
  const acct = (id: string, market: 'afternic' | 'sedo', extra = {}) => ({
    id,
    market,
    label: id,
    enabled: true,
    verificationId: null as string | null,
    ...extra,
  });

  it('lists each enabled market account, with Afternic’s NS3 once its ID is saved', () => {
    const presets = marketNameserverPresets(
      [
        acct('a', 'afternic', { verificationId: 'Abc1' }),
        acct('s', 'sedo'),
        acct('off', 'sedo', { enabled: false }),
      ],
      markets,
    );
    expect(presets.map((p) => [p.label, p.nameservers])).toEqual([
      [
        'Afternic, with your NS3',
        [
          'ns1.afternic.com',
          'ns2.afternic.com',
          'verification-abc1.ns101.verify.hn',
        ],
      ],
      ['Sedo', ['ns1.sedoparking.com', 'ns2.sedoparking.com']],
    ]);
    expect(presets.every((p) => p.market)).toBe(true);
  });

  it('names the account when a market has several', () => {
    const presets = marketNameserverPresets(
      [acct('Main', 'sedo'), acct('Second', 'sedo')],
      markets,
    );
    expect(presets.map((p) => p.label)).toEqual([
      'Sedo (Main)',
      'Sedo (Second)',
    ]);
  });

  it('goes first, and the rest drop the sets it repeats', () => {
    const market = marketNameserverPresets([acct('s', 'sedo')], markets);
    const rest = nameserverPresets(
      [
        { nameservers: ['ns1.sedoparking.com', 'ns2.sedoparking.com'] },
        { nameservers: ['ns1.dyna-ns.net', 'ns2.dyna-ns.net'] },
      ],
      [],
    );
    expect(withMarketPresets(market, rest).map((p) => p.label)).toEqual([
      'Sedo',
      'dyna-ns.net · 1 domain',
    ]);
  });
});
