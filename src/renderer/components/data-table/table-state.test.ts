import { describe, expect, it } from 'vitest';
import { paginate, rangeKeys, sortRows } from './table-state';

describe('sortRows', () => {
  const rows = [{ v: 'b' }, { v: null }, { v: 'a' }, { v: '' }, { v: 'c' }] as {
    v: string | null;
  }[];

  it('sorts either way with blanks last', () => {
    expect(sortRows([...rows], (r) => r.v, 'asc').map((r) => r.v)).toEqual([
      'a',
      'b',
      'c',
      null,
      '',
    ]);
    expect(
      sortRows([...rows], (r) => r.v, 'desc')
        .map((r) => r.v)
        .slice(0, 3),
    ).toEqual(['c', 'b', 'a']);
  });

  it('sorts numbers', () => {
    const nums = [{ n: 10 }, { n: 2 }, { n: 33 }];
    expect(sortRows(nums, (r) => r.n, 'asc').map((r) => r.n)).toEqual([
      2, 10, 33,
    ]);
  });
});

describe('paginate', () => {
  it('pages and clamps', () => {
    expect(paginate(120, 1, 50)).toEqual({
      pageCount: 3,
      page: 1,
      start: 50,
      end: 100,
    });
    expect(paginate(120, 9, 50)).toMatchObject({
      page: 2,
      start: 100,
      end: 120,
    });
    expect(paginate(0, 3, 50)).toEqual({
      pageCount: 1,
      page: 0,
      start: 0,
      end: 0,
    });
  });
});

describe('rangeKeys', () => {
  const keys = ['a', 'b', 'c', 'd'];
  it('spans the anchor to the clicked row in either direction', () => {
    expect(rangeKeys(keys, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeKeys(keys, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });
  it('is null without an anchor in the table', () => {
    expect(rangeKeys(keys, null, 'b')).toBeNull();
    expect(rangeKeys(keys, 'z', 'b')).toBeNull();
  });
});
