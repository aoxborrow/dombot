// Which of a table's columns show, and in what order. Any DataTable can take a
// layout; the page lists every column it could show, in its default order, and
// the layout picks and orders them. Kept free of React so it can be tested on
// its own.

export interface ColumnLayout {
  /** Left to right. Hidden columns keep their place, so turning one on puts it back there. */
  order: string[];
  hidden: string[];
}

/** What the layout needs to know about a column. DataColumn has these fields. */
export interface LayoutColumn {
  key: string;
  /** Always shown and never moved: it stays at the front, ahead of the rest. */
  locked?: boolean;
  /** Off until the picker turns it on. */
  defaultHidden?: boolean;
}

export function defaultColumnLayout(columns: LayoutColumn[]): ColumnLayout {
  const { locked, rest } = split(columns);
  return {
    order: [...locked, ...rest].map((c) => c.key),
    hidden: rest.filter((c) => c.defaultHidden).map((c) => c.key),
  };
}

/**
 * A saved layout made to fit `columns`: unknown and repeated keys are dropped,
 * locked columns go first and are shown, and a column the save never mentioned
 * goes in after the column it follows by default, shown or not as its default
 * says.
 */
export function normalizeColumnLayout(
  raw: unknown,
  columns: LayoutColumn[],
): ColumnLayout {
  const defaults = defaultColumnLayout(columns);
  const rec =
    raw && typeof raw === 'object' ? (raw as Partial<ColumnLayout>) : {};
  const savedOrder = Array.isArray(rec.order) ? rec.order : null;
  const savedHidden = Array.isArray(rec.hidden) ? rec.hidden : null;
  if (!savedOrder) return defaults;

  const { locked } = split(columns);
  const lockedKeys = new Set(locked.map((c) => c.key));
  const known = new Set(defaults.order);
  const order: string[] = locked.map((c) => c.key);
  for (const key of savedOrder) {
    if (typeof key !== 'string' || !known.has(key) || order.includes(key))
      continue;
    order.push(key);
  }

  // Columns added since the save: after their default neighbour on the left.
  const added = defaults.order.filter((key) => !order.includes(key));
  for (const key of added) {
    const before = defaults.order.slice(0, defaults.order.indexOf(key));
    const anchor = before.reverse().find((k) => order.includes(k));
    order.splice(anchor ? order.indexOf(anchor) + 1 : order.length, 0, key);
  }

  const hidden = new Set<string>();
  for (const key of savedHidden ?? []) {
    if (typeof key === 'string' && known.has(key) && !lockedKeys.has(key))
      hidden.add(key);
  }
  for (const key of added) {
    if (defaults.hidden.includes(key)) hidden.add(key);
  }
  return { order, hidden: order.filter((key) => hidden.has(key)) };
}

export function columnLayoutsEqual(a: ColumnLayout, b: ColumnLayout): boolean {
  if (a.order.length !== b.order.length) return false;
  if (a.order.some((key, i) => key !== b.order[i])) return false;
  if (a.hidden.length !== b.hidden.length) return false;
  const hidden = new Set(a.hidden);
  return b.hidden.every((key) => hidden.has(key));
}

/**
 * `order` with `key` moved to `toIndex` (an index into `order`). Locked keys
 * don't move, and nothing moves in front of them.
 */
export function moveColumnTo(
  order: string[],
  key: string,
  toIndex: number,
  columns: LayoutColumn[],
): string[] {
  const lockedKeys = new Set(split(columns).locked.map((c) => c.key));
  if (lockedKeys.has(key)) return order;
  const from = order.indexOf(key);
  if (from < 0) return order;
  const first = order.filter((k) => lockedKeys.has(k)).length;
  const to = Math.max(first, Math.min(toIndex, order.length - 1));
  if (to === from) return order;
  const next = order.slice();
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}

/**
 * The columns to draw, in layout order. `forceVisible` columns show in their
 * place even while hidden, e.g. a column a filter is narrowing. The layout
 * is fitted to `columns` first, so a stale one still draws every column.
 */
export function applyColumnLayout<C extends LayoutColumn>(
  columns: C[],
  layout: ColumnLayout,
  forceVisible: readonly string[] = [],
): C[] {
  const fit = normalizeColumnLayout(layout, columns);
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const hidden = new Set(fit.hidden);
  return fit.order
    .filter((key) => !hidden.has(key) || forceVisible.includes(key))
    .map((key) => byKey.get(key)!);
}

function split<C extends LayoutColumn>(columns: C[]) {
  return {
    locked: columns.filter((c) => c.locked),
    rest: columns.filter((c) => !c.locked),
  };
}
