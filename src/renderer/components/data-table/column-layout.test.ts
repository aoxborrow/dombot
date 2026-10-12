import { describe, expect, it } from 'vitest';
import {
  applyColumnLayout,
  columnLayoutsEqual,
  defaultColumnLayout,
  moveColumnTo,
  normalizeColumnLayout,
  type LayoutColumn,
} from './column-layout';

const COLUMNS: LayoutColumn[] = [
  { key: 'name', locked: true },
  { key: 'a' },
  { key: 'b', defaultHidden: true },
  { key: 'c' },
  { key: 'd', defaultHidden: true },
];

const keys = (cols: LayoutColumn[]) => cols.map((c) => c.key);

describe('defaultColumnLayout', () => {
  it('is the columns in order, with the default-hidden ones off', () => {
    expect(defaultColumnLayout(COLUMNS)).toEqual({
      order: ['name', 'a', 'b', 'c', 'd'],
      hidden: ['b', 'd'],
    });
  });

  it('puts locked columns first', () => {
    const cols = [{ key: 'a' }, { key: 'name', locked: true }];
    expect(defaultColumnLayout(cols).order).toEqual(['name', 'a']);
  });
});

describe('normalizeColumnLayout', () => {
  it('uses the defaults for nothing saved or a bad shape', () => {
    const defaults = defaultColumnLayout(COLUMNS);
    expect(normalizeColumnLayout(undefined, COLUMNS)).toEqual(defaults);
    expect(normalizeColumnLayout('x', COLUMNS)).toEqual(defaults);
    expect(normalizeColumnLayout({ order: 'x' }, COLUMNS)).toEqual(defaults);
  });

  it('keeps locked columns first and shown', () => {
    const layout = normalizeColumnLayout(
      { order: ['c', 'name', 'a', 'b', 'd'], hidden: ['name', 'a'] },
      COLUMNS,
    );
    expect(layout.order).toEqual(['name', 'c', 'a', 'b', 'd']);
    expect(layout.hidden).toEqual(['a']);
  });

  it('drops unknown and repeated keys', () => {
    const layout = normalizeColumnLayout(
      { order: ['name', 'gone', 'c', 'c', 'a', 'b', 'd'], hidden: ['gone'] },
      COLUMNS,
    );
    expect(layout).toEqual({ order: ['name', 'c', 'a', 'b', 'd'], hidden: [] });
  });

  it('puts a column the save predates after its default neighbour', () => {
    const layout = normalizeColumnLayout(
      { order: ['name', 'c', 'a', 'd'], hidden: [] },
      COLUMNS,
    );
    expect(layout.order).toEqual(['name', 'c', 'a', 'b', 'd']);
    // New columns take their default visibility.
    expect(layout.hidden).toEqual(['b']);
  });

  it('keeps a saved hidden column hidden and a shown one shown', () => {
    const layout = normalizeColumnLayout(
      { order: ['name', 'a', 'b', 'c', 'd'], hidden: ['a'] },
      COLUMNS,
    );
    expect(layout.hidden).toEqual(['a']);
  });
});

describe('moveColumnTo', () => {
  const order = ['name', 'a', 'b', 'c'];

  it('moves a column to an index', () => {
    expect(moveColumnTo(order, 'c', 1, COLUMNS)).toEqual([
      'name',
      'c',
      'a',
      'b',
    ]);
    expect(moveColumnTo(order, 'a', 3, COLUMNS)).toEqual([
      'name',
      'b',
      'c',
      'a',
    ]);
  });

  it('never moves a locked column or anything in front of one', () => {
    expect(moveColumnTo(order, 'name', 2, COLUMNS)).toBe(order);
    expect(moveColumnTo(order, 'b', 0, COLUMNS)).toEqual([
      'name',
      'b',
      'a',
      'c',
    ]);
  });

  it('clamps past the end and ignores an unknown key', () => {
    expect(moveColumnTo(order, 'a', 99, COLUMNS)).toEqual([
      'name',
      'b',
      'c',
      'a',
    ]);
    expect(moveColumnTo(order, 'zz', 1, COLUMNS)).toBe(order);
  });
});

describe('applyColumnLayout', () => {
  it('returns the shown columns in layout order', () => {
    const layout = { order: ['name', 'c', 'a', 'b', 'd'], hidden: ['a', 'b'] };
    expect(keys(applyColumnLayout(COLUMNS, layout))).toEqual([
      'name',
      'c',
      'd',
    ]);
  });

  it('shows a forced column in its place while hidden', () => {
    const layout = { order: ['name', 'c', 'b', 'a', 'd'], hidden: ['b', 'd'] };
    expect(keys(applyColumnLayout(COLUMNS, layout, ['b']))).toEqual([
      'name',
      'c',
      'b',
      'a',
    ]);
  });

  it('fits a stale layout to the columns', () => {
    const layout = { order: ['gone', 'a'], hidden: ['name'] };
    expect(keys(applyColumnLayout(COLUMNS, layout))).toEqual([
      'name',
      'a',
      'c',
    ]);
  });
});

describe('columnLayoutsEqual', () => {
  it('compares order exactly and hidden as a set', () => {
    const a = { order: ['name', 'a', 'b'], hidden: ['a', 'b'] };
    expect(columnLayoutsEqual(a, { ...a, hidden: ['b', 'a'] })).toBe(true);
    expect(columnLayoutsEqual(a, { ...a, order: ['name', 'b', 'a'] })).toBe(
      false,
    );
    expect(columnLayoutsEqual(a, { ...a, hidden: ['a'] })).toBe(false);
  });
});
