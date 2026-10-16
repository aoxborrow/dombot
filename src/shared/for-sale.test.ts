import { expect, it } from 'vitest';
import { matchesSaleFilter } from './for-sale';

it('matches explicit flags and treats missing flags as not for sale', () => {
  const flags = { 'example.com': true, 'other.com': false };
  expect(matchesSaleFilter('EXAMPLE.COM', flags, 'for-sale')).toBe(true);
  expect(matchesSaleFilter('example.com', flags, 'not-for-sale')).toBe(false);
  for (const name of ['other.com', 'new.com']) {
    expect(matchesSaleFilter(name, flags, 'not-for-sale')).toBe(true);
    expect(matchesSaleFilter(name, flags, 'for-sale')).toBe(false);
  }
  expect(matchesSaleFilter('example.com', flags, 'all')).toBe(true);
  expect(matchesSaleFilter('new.com', flags, 'all')).toBe(true);
});
