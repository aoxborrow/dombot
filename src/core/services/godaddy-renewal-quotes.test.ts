import { describe, expect, it } from 'vitest';
import {
  dummyNameForTld,
  planGoDaddyRenewalFetches,
  renewalFromGodaddyPricing,
  tldsNeedingPremiumFlags,
} from './godaddy-renewal-quotes';

describe('planGoDaddyRenewalFetches', () => {
  it('samples one name per traditional TLD and never treats them as premium', () => {
    const plan = planGoDaddyRenewalFetches(
      [
        { domainName: 'a.com' },
        { domainName: 'b.com' },
        { domainName: 'c.net' },
        { domainName: 'd.org' },
      ],
      new Map([['a.com', true]]),
    );
    expect(plan.premiums).toEqual([]);
    expect(plan.tldSamples).toEqual([
      { tld: 'com', domain: 'a.com' },
      { tld: 'net', domain: 'c.net' },
      { tld: 'org', domain: 'd.org' },
    ]);
  });

  it('quotes premiums per-name and samples one standard name on other TLDs', () => {
    const plan = planGoDaddyRenewalFetches(
      [
        { domainName: 'cheap.io' },
        { domainName: 'also.io' },
        { domainName: 'fancy.io' },
        { domainName: 'x.app' },
      ],
      new Map([
        ['fancy.io', true],
        ['cheap.io', false],
        ['also.io', false],
        ['x.app', undefined],
      ]),
    );
    expect(plan.premiums).toEqual(['fancy.io']);
    expect(plan.tldSamples).toEqual([
      { tld: 'io', domain: 'cheap.io' },
      { tld: 'app', domain: 'x.app' },
    ]);
  });

  it('skips a TLD sample when every name on that TLD is premium', () => {
    const plan = planGoDaddyRenewalFetches(
      [{ domainName: 'one.io' }, { domainName: 'two.io' }],
      new Map([
        ['one.io', true],
        ['two.io', true],
      ]),
    );
    expect(plan.premiums).toEqual(['one.io', 'two.io']);
    expect(plan.tldSamples).toEqual([]);
  });
});

describe('dummyNameForTld', () => {
  it('is a long random label on the TLD', () => {
    expect(dummyNameForTld('.COM')).toMatch(/^db[a-f0-9]{12}\.com$/);
    expect(dummyNameForTld('com')).not.toBe(dummyNameForTld('com'));
  });
});

describe('renewalFromGodaddyPricing', () => {
  it('takes the renewal figure over the register price', () => {
    expect(
      renewalFromGodaddyPricing({ renewal: 8.99, registration: 11.99 }),
    ).toBe(8.99);
  });

  it('reads a missing renewal as "same as register"', () => {
    // v3 omits renewalPrice when it is identical to price.
    expect(renewalFromGodaddyPricing({ registration: 21.99 })).toBe(21.99);
  });

  it('is null when the term carries no prices at all', () => {
    expect(renewalFromGodaddyPricing({})).toBeNull();
  });
});

describe('tldsNeedingPremiumFlags', () => {
  it('skips com/net/org and includes the rest', () => {
    expect(
      tldsNeedingPremiumFlags([
        { domainName: 'a.com' },
        { domainName: 'b.io' },
        { domainName: 'c.app' },
      ]),
    ).toEqual(['io', 'app']);
  });
});
