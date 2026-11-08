import { useMemo, useState } from 'react';

export interface TableSelectionState {
  scope: string;
  selected: ReadonlySet<string>;
}

/** Filters/navigation start a new selection; paging and sorting do not.
 * Prune removed rows immediately so hidden targets cannot reach any action. */
export function reconcileSelection(
  state: TableSelectionState,
  scope: string,
  keys: ReadonlySet<string>,
): TableSelectionState {
  if (state.scope !== scope) return { scope, selected: new Set() };
  if ([...state.selected].every((key) => keys.has(key))) return state;
  return {
    scope,
    selected: new Set([...state.selected].filter((key) => keys.has(key))),
  };
}

/** A completion from an earlier result must not change the current selection.
 *  `keys` may be from an earlier render (a late removal), so only adds check
 *  it; rows that left the result are pruned at render, against current keys. */
export function changeSelection(
  previous: TableSelectionState,
  scope: string,
  keys: ReadonlySet<string>,
  targets: string[],
  on: boolean,
): TableSelectionState {
  if (previous.scope !== scope) return previous;
  const selected = new Set(previous.selected);
  for (const key of targets) {
    if (on && keys.has(key)) selected.add(key);
    else selected.delete(key);
  }
  return { scope, selected };
}

/** Page-local selection shared by the checkboxes and every bulk action.
 *  Pass a memoized `rowKeys` so the key set isn't rebuilt every render. */
export function useTableSelection(scope: string, rowKeys: string[]) {
  const keys = useMemo(() => new Set(rowKeys), [rowKeys]);
  const [stored, setStored] = useState<TableSelectionState>(() => ({
    scope,
    selected: new Set(),
  }));
  const current = reconcileSelection(stored, scope, keys);
  // Reset during render, before a menu can capture targets from an old scope.
  if (current !== stored) setStored(current);
  const setMany = (targets: string[], on: boolean) =>
    setStored((previous) =>
      changeSelection(previous, scope, keys, targets, on),
    );
  return {
    scope,
    selected: current.selected,
    toggle: (key: string) => setMany([key], !current.selected.has(key)),
    setMany,
    clear: () =>
      setStored((previous) =>
        previous.scope === scope ? { scope, selected: new Set() } : previous,
      ),
  };
}
