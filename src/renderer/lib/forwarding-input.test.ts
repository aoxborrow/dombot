import { describe, it, expect } from 'vitest';

import {
  expandTemplate,
  sameEmailForwards,
  sameUrlForwards,
  validateEmailForwards,
  validateUrlForwards,
} from './forwarding-input';

describe('validateUrlForwards', () => {
  const ok = [
    { host: '@', url: 'https://example.com/', type: 'permanent' as const },
    { host: 'www', url: 'https://example.com/', type: 'temporary' as const },
  ];

  it('accepts apex and subdomain rules with http(s) destinations', () => {
    expect(validateUrlForwards(ok)).toEqual({ errors: [], warnings: [] });
  });

  it('treats an empty host as the apex and lowercases hosts', () => {
    expect(
      validateUrlForwards([
        { host: '', url: 'https://a.com', type: 'permanent' },
        { host: 'WWW', url: 'https://a.com', type: 'permanent' },
      ]).errors,
    ).toEqual([]);
  });

  it('rejects bad hosts, missing or non-http URLs, and duplicate hosts', () => {
    const { errors } = validateUrlForwards([
      { host: '-bad', url: 'https://a.com', type: 'permanent' },
      { host: 'www', url: '', type: 'permanent' },
      { host: 'www', url: 'ftp://a.com', type: 'permanent' },
      { host: 'shop', url: 'not a url', type: 'permanent' },
    ]);
    expect(errors).toEqual([
      'Rule 1: “-bad” isn’t a valid host.',
      'Rule 2: enter a destination URL.',
      'Rule 3: the destination must be an http(s) URL.',
      'Rule 3: “www” is listed twice.',
      'Rule 4: the destination must be an http(s) URL.',
    ]);
  });

  it('allows a {domain} template in the URL', () => {
    expect(
      validateUrlForwards([
        {
          host: '@',
          url: 'https://landing.test/?d={domain}',
          type: 'permanent',
        },
      ]).errors,
    ).toEqual([]);
  });

  it('applies Gandi (no apex) and NameSilo (single apex) constraints', () => {
    expect(validateUrlForwards([ok[0]], 'gandi').errors[0]).toMatch(/Gandi/);
    expect(validateUrlForwards([ok[1]], 'gandi').errors).toEqual([]);
    expect(validateUrlForwards(ok, 'namesilo').errors).toEqual([
      'Rule 2: NameSilo only supports a single apex (“@”) forward.',
      'NameSilo supports one forwarding rule per domain.',
    ]);
    expect(validateUrlForwards([ok[0]], 'namesilo').errors).toEqual([]);
  });

  it('warns that an empty set clears forwarding', () => {
    expect(validateUrlForwards([]).warnings).toEqual([
      'Saving with no rules removes all URL forwarding.',
    ]);
  });
});

describe('validateEmailForwards', () => {
  it('accepts aliases, catch-alls, and real addresses', () => {
    expect(
      validateEmailForwards([
        { alias: 'hello', forwardTo: 'me@example.com' },
        { alias: '@', forwardTo: 'catch@example.com' },
        { alias: '*', forwardTo: 'catch@example.com' },
      ]),
    ).toEqual({ errors: [], warnings: [] });
  });

  it('rejects empty or invalid aliases and destinations', () => {
    expect(
      validateEmailForwards([
        { alias: '', forwardTo: 'me@example.com' },
        { alias: 'a b', forwardTo: 'me@example.com' },
        { alias: 'hi', forwardTo: '' },
        { alias: 'yo', forwardTo: 'nope' },
      ]).errors,
    ).toEqual([
      'Rule 1: enter an alias (the part before @).',
      'Rule 2: “a b” isn’t a valid alias.',
      'Rule 3: enter a destination address.',
      'Rule 4: “nope” isn’t a valid email address.',
    ]);
  });

  it('rejects a repeated alias except at NameSilo (up to five)', () => {
    const twice = [
      { alias: 'hello', forwardTo: 'a@example.com' },
      { alias: 'Hello', forwardTo: 'b@example.com' },
    ];
    expect(validateEmailForwards(twice).errors).toEqual([
      '“hello” is listed 2 times; one destination per alias.',
    ]);
    expect(validateEmailForwards(twice, 'namesilo').errors).toEqual([]);
    const six = Array.from({ length: 6 }, (_, i) => ({
      alias: 'hello',
      forwardTo: `p${i}@example.com`,
    }));
    expect(validateEmailForwards(six, 'namesilo').errors).toEqual([
      '“hello” has 6 destinations; NameSilo allows five.',
    ]);
  });
});

describe('expandTemplate', () => {
  it('replaces every {domain}, any case', () => {
    expect(
      expandTemplate('https://x.test/?d={domain}&D={DOMAIN}', 'a.com'),
    ).toBe('https://x.test/?d=a.com&D=a.com');
  });
});

describe('same*Forwards', () => {
  it('compares normalized sets regardless of order', () => {
    expect(
      sameUrlForwards(
        [
          { host: 'www', url: ' https://a.com ', type: 'permanent' },
          { host: '', url: 'https://a.com', type: 'temporary' },
        ],
        [
          { host: '@', url: 'https://a.com', type: 'temporary' },
          { host: 'WWW', url: 'https://a.com', type: 'permanent' },
        ],
      ),
    ).toBe(true);
    expect(
      sameEmailForwards(
        [{ alias: 'Hi', forwardTo: 'a@b.com' }],
        [{ alias: 'hi', forwardTo: 'a@b.com' }],
      ),
    ).toBe(true);
    expect(sameEmailForwards([{ alias: 'hi', forwardTo: 'a@b.com' }], [])).toBe(
      false,
    );
  });
});
