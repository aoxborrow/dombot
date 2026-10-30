// A date filter is one chip with an optional From and an optional To, both
// inclusive calendar days (`YYYY-MM-DD`). Either side blank means unbounded.
// A row with no date stays out once a bound is set. A shortcut (Next 30
// days, Last 12 months, …) is kept by name and counted from today each time,
// so it doesn't go stale while the app stays open.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The date filter shortcuts. A field offers the ones that suit it. */
export type DatePresetId =
  | 'expired'
  | 'grace'
  | 'redemption'
  | 'next30'
  | 'next60'
  | 'next90'
  | 'last30'
  | 'last90'
  | 'last12m';

/**
 * One date filter's bounds, each `YYYY-MM-DD` or "" for unbounded. With a
 * `preset`, the bounds come from it (see resolveDateRange) and `from`/`to`
 * are only what the boxes showed when it was picked.
 */
export interface DateRange {
  from: string;
  to: string;
  preset?: DatePresetId;
}

/** A date filter with neither side set. */
export const NO_DATE_RANGE: DateRange = { from: '', to: '' };

/** Shortcuts for a date that's ahead: renewals and expiry. */
export const FUTURE_DATE_PRESETS: DatePresetId[] = [
  'expired',
  'next30',
  'next60',
  'next90',
];

/**
 * The Expiration filter's shortcuts, furthest out first down to the most
 * overdue: FUTURE_DATE_PRESETS reversed, then Expired with the registrar's
 * Grace and Redemption under it. Those two match a status, not a day, so the
 * page that offers them checks the row's status too.
 */
export const EXPIRATION_PRESETS: DatePresetId[] = [
  'next90',
  'next60',
  'next30',
  'expired',
  'grace',
  'redemption',
];

/** Shortcuts for a date that's behind: created, bought, sold. */
export const PAST_DATE_PRESETS: DatePresetId[] = [
  'last30',
  'last90',
  'last12m',
];

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

/** `today` moved by whole days (and years), as a local `YYYY-MM-DD`. */
function shiftDay(today: Date, days: number, years = 0): string {
  const d = new Date(
    today.getFullYear() + years,
    today.getMonth(),
    today.getDate() + days,
  );
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Each shortcut's name and bounds. "Today" is this machine's calendar, the
 * day a person would name. Both ends count, and today is in every window
 * but Expired.
 */
export const DATE_PRESETS: Record<
  DatePresetId,
  {
    label: string;
    bounds: (today: Date) => DateRange;
    /** A narrower pick inside this shortcut, listed indented under it. */
    within?: DatePresetId;
  }
> = {
  expired: {
    label: 'Expired',
    bounds: (t) => ({ from: '', to: shiftDay(t, -1) }),
  },
  // No bounds: the registrar's status decides (see EXPIRATION_PRESETS).
  grace: {
    label: 'Grace',
    bounds: () => ({ from: '', to: '' }),
    within: 'expired',
  },
  redemption: {
    label: 'Redemption',
    bounds: () => ({ from: '', to: '' }),
    within: 'expired',
  },
  next30: {
    label: 'Next 30 days',
    bounds: (t) => ({ from: shiftDay(t, 0), to: shiftDay(t, 30) }),
  },
  next60: {
    label: 'Next 60 days',
    bounds: (t) => ({ from: shiftDay(t, 0), to: shiftDay(t, 60) }),
  },
  next90: {
    label: 'Next 90 days',
    bounds: (t) => ({ from: shiftDay(t, 0), to: shiftDay(t, 90) }),
  },
  last30: {
    label: 'Last 30 days',
    bounds: (t) => ({ from: shiftDay(t, -30), to: shiftDay(t, 0) }),
  },
  last90: {
    label: 'Last 90 days',
    bounds: (t) => ({ from: shiftDay(t, -90), to: shiftDay(t, 0) }),
  },
  last12m: {
    label: 'Last 12 months',
    bounds: (t) => ({ from: shiftDay(t, 0, -1), to: shiftDay(t, 0) }),
  },
};

/** A shortcut, filled in for `today` and tagged so it stays a shortcut. */
export function presetRange(
  preset: DatePresetId,
  today: Date = new Date(),
): DateRange {
  return { ...DATE_PRESETS[preset].bounds(today), preset };
}

/** The bounds in force: a shortcut's as of `today`, else the typed days. */
export function resolveDateRange(
  range: DateRange,
  today: Date = new Date(),
): DateRange {
  return range.preset ? presetRange(range.preset, today) : range;
}

/** Whether either side holds a real day, so the filter is in force. */
export function isDateRangeSet(range: DateRange): boolean {
  if (range.preset) return true;
  return calendarDay(range.from) !== null || calendarDay(range.to) !== null;
}

/**
 * Chip text: a shortcut's name, else the days. Null when neither side is a
 * real day.
 */
export function dateRangeSummary(range: DateRange): string | null {
  if (range.preset) return DATE_PRESETS[range.preset].label;
  const lo = calendarDay(range.from);
  const hi = calendarDay(range.to);
  if (lo && hi && lo === hi) return `= ${lo}`;
  if (lo && hi) return `${lo} – ${hi}`;
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
  range: DateRange,
  today: Date = new Date(),
): boolean {
  const bounds = resolveDateRange(range, today);
  const lo = calendarDay(bounds.from);
  const hi = calendarDay(bounds.to);
  if (!lo && !hi) return true;
  const value = calendarDay(day);
  if (!value) return false;
  if (lo && value < lo) return false;
  if (hi && value > hi) return false;
  return true;
}
