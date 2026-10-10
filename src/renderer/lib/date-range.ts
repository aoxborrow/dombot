// A date filter is one chip with an optional From and an optional To, both
// inclusive calendar days (`YYYY-MM-DD`). Either side blank means unbounded.
// A row with no date stays out once a bound is set.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A stored or typed calendar day, or null when it isn't `YYYY-MM-DD`. */
export function calendarDay(value: string | null | undefined): string | null {
  return value && DAY.test(value) ? value : null;
}

/**
 * The UTC day a registrar date shows as in the Created and Expires cells.
 * Those cells use `toISOString()`, so the filter has to use the same day
 * the table prints.
 */
export function utcDay(date: Date | string | null | undefined): string | null {
  if (date == null || date === '') return null;
  const d = date instanceof Date ? date : new Date(date);
  const t = d.getTime();
  return Number.isNaN(t) ? null : d.toISOString().slice(0, 10);
}

/** Chip text for a date range. Null when neither side is a real day. */
export function dateRangeSummary(from: string, to: string): string | null {
  const lo = calendarDay(from);
  const hi = calendarDay(to);
  if (lo && hi && lo === hi) return `= ${lo}`;
  if (lo && hi) return `${lo}→${hi}`;
  if (lo) return `≥ ${lo}`;
  if (hi) return `≤ ${hi}`;
  return null;
}

/**
 * Whether a row's calendar day sits inside the bounds. An empty filter
 * matches every row, including ones with no date. A set filter skips a
 * blank or unreadable day. Both bounds are inclusive.
 */
export function matchesDateRange(
  day: string | null | undefined,
  from: string,
  to: string,
): boolean {
  const lo = calendarDay(from);
  const hi = calendarDay(to);
  if (!lo && !hi) return true;
  const value = calendarDay(day);
  if (!value) return false;
  if (lo && value < lo) return false;
  if (hi && value > hi) return false;
  return true;
}

/** Jan 1 through Dec 31 of a calendar year, inclusive. */
export function yearBounds(year: number): { from: string; to: string } {
  const y = String(year);
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/**
 * Which year button matches the dates already filled. `today` is this
 * machine's local calendar, the same year a person would name.
 */
export function yearPreset(
  from: string,
  to: string,
  today: Date = new Date(),
): 'this' | 'last' | null {
  const year = today.getFullYear();
  const same = (y: number) => {
    const bounds = yearBounds(y);
    return calendarDay(from) === bounds.from && calendarDay(to) === bounds.to;
  };
  if (same(year)) return 'this';
  if (same(year - 1)) return 'last';
  return null;
}
