import { describe, expect, it } from 'vitest';
import {
  changeSelection,
  reconcileSelection,
  type TableSelectionState,
} from './table-selection';

const keys = new Set(Array.from({ length: 120 }, (_, i) => `domain-${i}`));
const state = (
  scope = 'owned',
  picked = ['domain-1', 'domain-75'],
): TableSelectionState => ({ scope, selected: new Set(picked) });

describe('reconcileSelection', () => {
  it('starts empty when the scope changes, even if the rows still match', () => {
    const next = reconcileSelection(state('owned'), 'owned+search', keys);
    expect(next.scope).toBe('owned+search');
    expect(next.selected.size).toBe(0);
  });

  it('keeps only names in the current result, so hidden ones are never targets', () => {
    const everything = state('owned', [...keys]);
    const next = reconcileSelection(everything, 'owned', new Set(['domain-3']));
    expect([...next.selected]).toEqual(['domain-3']);
  });

  it('keeps the same object within one scope, across pages and sort orders', () => {
    const previous = state();
    expect(reconcileSelection(previous, 'owned', keys)).toBe(previous);
    expect(
      reconcileSelection(previous, 'owned', new Set([...keys].reverse())),
    ).toBe(previous);
  });

  it('prunes rows that leave the result and does not bring them back', () => {
    const pruned = reconcileSelection(state(), 'owned', new Set(['domain-1']));
    expect([...pruned.selected]).toEqual(['domain-1']);
    expect([...reconcileSelection(pruned, 'owned', keys).selected]).toEqual([
      'domain-1',
    ]);
  });

  it('does not restore a selection after leaving and coming back', () => {
    const left = reconcileSelection(state(), 'visit-2', keys);
    const returned = reconcileSelection(left, 'visit-3', keys);
    expect(returned.selected.size).toBe(0);
  });
});

describe('changeSelection', () => {
  it('ignores a late change from an earlier scope', () => {
    const current = state('new-filter', ['domain-75']);
    expect(
      changeSelection(current, 'old-filter', keys, ['domain-1'], false),
    ).toBe(current);
  });

  it('adds only rows in the result and removes only the named ones', () => {
    const added = changeSelection(
      state(),
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

  it('a late removal with older keys keeps rows selected since', () => {
    // domain-200 joined the result (a sync) and was selected after the
    // folder move began; the move's completion still holds the old keys.
    const current = state('owned', ['domain-1', 'domain-200']);
    const next = changeSelection(current, 'owned', keys, ['domain-1'], false);
    expect([...next.selected]).toEqual(['domain-200']);
  });
});
