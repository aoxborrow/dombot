// Pure helpers behind DataTable: sorting, paging, and shift-click ranges.
// Kept free of React so they can be tested on their own.

export type SortValue = string | number;
export type SortDir = 'asc' | 'desc';

/**
 * Sorts `rows` in place by `valueOf` and returns them. Nulls and blanks
 * always sort last, whatever the direction.
 */
export function sortRows<T>(
  rows: T[],
  valueOf: (row: T) => SortValue | null,
  dir: SortDir,
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    const aEmpty = av === null || av === '';
    const bEmpty = bv === null || bv === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (av < bv) return -sign;
    if (av > bv) return sign;
    return 0;
  });
}

export interface Page {
  /** At least 1, even with no rows. */
  pageCount: number;
  /** `page` clamped to the last page, so shrinking the rows never strands it. */
  page: number;
  /** Index of the first row on the page. */
  start: number;
  /** Index after the last row on the page. */
  end: number;
}

export function paginate(total: number, page: number, pageSize: number): Page {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safe = Math.min(Math.max(0, page), pageCount - 1);
  const start = safe * pageSize;
  return {
    pageCount,
    page: safe,
    start,
    end: Math.min(start + pageSize, total),
  };
}

/**
 * The keys from `anchor` through `key` (either order) in table order, for a
 * shift-click. Null when either isn't in the table.
 */
export function rangeKeys(
  keys: string[],
  anchor: string | null,
  key: string,
): string[] | null {
  if (anchor === null) return null;
  const from = keys.indexOf(anchor);
  const to = keys.indexOf(key);
  if (from === -1 || to === -1) return null;
  return keys.slice(Math.min(from, to), Math.max(from, to) + 1);
}
