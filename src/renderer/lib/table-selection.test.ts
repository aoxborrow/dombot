import { describe, expect, it } from 'vitest';
import {
  reconcileSelection,
  changeSelection,
  type TableSelectionState,
} from './table-selection';

const keys = new Set(Array.from({ length: 120 }, (_, i) => `domain-${i}`));
const state = (
  scope = 'owned',
  picked = ['domain-1', 'domain-75'],
): TableSelectionState => ({ scope, selected: new Set(picked) });

describe('table selection boundaries', () => {
  it('drops the 689 hidden selections before a filtered row can be acted on', () => {
    const old = state(
      'all',
      Array.from({ length: 689 }, (_, i) => `hidden-${i}`),
    );
    const next = reconcileSelection(old, 'filtered', new Set(['one.invalid']));
    expect([...next.selected]).toEqual([]);
    const selected = new Set(next.selected).add('one.invalid');
    expect([...selected]).toEqual(['one.invalid']);
  });

  it.each([
    'search',
    'registrar',
    'folder',
    'auto-renew',
    'pricing',
    'dates',
    'owned/archive',
    'activity type',
  ])(
    'clears selection when the %s scope changes even if rows still match',
    (filter) => {
      expect(reconcileSelection(state(), filter, keys).selected.size).toBe(0);
    },
  );

  it('preserves deliberate cross-page selection and sorting within one result', () => {
    const previous = state();
    expect(reconcileSelection(previous, 'owned', keys)).toBe(previous);
    expect(
      reconcileSelection(previous, 'owned', new Set([...keys].reverse())),
    ).toBe(previous);
    expect([...previous.selected]).toEqual(['domain-1', 'domain-75']);
  });

  it('clears on navigation and does not resurrect when returning', () => {
    const left = reconcileSelection(state(), 'renewals-visit', keys);
    const returned = reconcileSelection(left, 'owned-new-visit', keys);
    expect(returned.selected.size).toBe(0);
  });

  it('prunes removed rows and never restores them after a refresh', () => {
    const pruned = reconcileSelection(state(), 'owned', new Set(['domain-1']));
    expect([...pruned.selected]).toEqual(['domain-1']);
    expect([...reconcileSelection(pruned, 'owned', keys).selected]).toEqual([
      'domain-1',
    ]);
  });
});

it('ignores completion of a bulk request from a previous filter or visit', () => {
  const current = state('new-filter', ['domain-75']);
  expect(
    changeSelection(current, 'old-filter', keys, ['domain-1'], false),
  ).toBe(current);
  expect([...current.selected]).toEqual(['domain-75']);
});
it('adds only matching rows and removes only the requested selection', () => {
  const current = state();
  const added = changeSelection(
    current,
    'owned',
    keys,
    ['domain-5', 'hidden'],
    true,
  );
  expect([...added.selected]).toEqual(['domain-1', 'domain-75', 'domain-5']);
  expect([
    ...changeSelection(added, 'owned', keys, ['domain-1'], false).selected,
  ]).toEqual(['domain-75', 'domain-5']);
});
