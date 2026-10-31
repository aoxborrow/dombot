// How a table page's toolbar lays out (see FilterToolbar and FilterBar):
// the view switch, the search, the default filter chips and the add button,
// worked out from their widths in the toolbar's starting state, before any
// filter has a value. Setting filters later never changes it: chips that
// grow just wrap onto another line.

/** A default chip: its width with no value, and whether it shows only if
 *  there's room. */
export interface ToolbarChip {
  key: string;
  width: number;
  ifRoom: boolean;
}

export interface ToolbarWidths {
  /** The row's width inside its padding, and the gap between its items. */
  width: number;
  gap: number;
  /** The switch's own width, or 0 for none. */
  switch: number;
  /** The search box's width as the row wraps it (its flex basis: it
   *  shrinks only once its line is settled), or null when it has a line of
   *  its own (a phone's), leaving the chips to share theirs with just the
   *  add button. */
  search: number | null;
  /** The default chips, in order. */
  chips: ToolbarChip[];
  /** The add button, square: it shows its label only if there's room after
   *  this is settled. */
  add: number;
}

export interface ToolbarLayout {
  /** The switch on a line of its own, above the search and chips. */
  switchAbove: boolean;
  /** The if-room chips left out. */
  hidden: Set<string>;
}

/**
 * In order: everything on one line if it fits; else the same without the
 * if-room chips, the last ones going first; else the switch on a line of
 * its own, and the if-room chips back beside the search, in order, while
 * they fit. So the earlier an if-room chip is listed, the longer it stays.
 */
export function toolbarLayout(w: ToolbarWidths): ToolbarLayout {
  const fits = (chips: ToolbarChip[], withSwitch: boolean) => {
    const items = [
      ...(withSwitch ? [w.switch] : []),
      ...(w.search === null ? [] : [w.search]),
      ...chips.map((c) => c.width),
      w.add,
    ];
    const total =
      items.reduce((sum, x) => sum + x, 0) + w.gap * (items.length - 1);
    return total <= w.width + 0.5;
  };
  const leftOut = (shown: ToolbarChip[]) =>
    new Set(w.chips.filter((c) => !shown.includes(c)).map((c) => c.key));
  // With the search on a line of its own, so is the switch (a phone).
  const ownLine = w.switch > 0 && w.search === null;
  const withSwitch = w.switch > 0 && !ownLine;

  let shown = w.chips;
  for (;;) {
    if (fits(shown, withSwitch))
      return { switchAbove: ownLine, hidden: leftOut(shown) };
    const last = shown.findLast((c) => c.ifRoom);
    if (!last) break;
    shown = shown.filter((c) => c !== last);
  }
  // No switch to move: the chips that still don't fit wrap.
  if (!withSwitch) return { switchAbove: ownLine, hidden: leftOut(shown) };

  for (const chip of w.chips) {
    if (!chip.ifRoom) continue;
    const next = w.chips.filter((c) => shown.includes(c) || c === chip);
    if (!fits(next, false)) break;
    shown = next;
  }
  return { switchAbove: true, hidden: leftOut(shown) };
}
