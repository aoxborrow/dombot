import type { Severity } from '../../shared/notifications';

// How urgent something is, in one set of colors wherever it shows: the bell,
// its count, and the Activity page's status dots and Priority filter. Red and
// yellow from the Domains table's expiry ramp (see expiryColor there): a
// removed name is as urgent as a sync error, an added one only needs a look.
// Open rows share one neutral tint; the dot carries the priority, since
// colored tints on the dark table turn muddy.

/** A small status dot. */
export const SEVERITY_DOT: Record<Severity, string> = {
  error: 'bg-red-600 dark:bg-red-500',
  high: 'bg-red-600 dark:bg-red-500',
  low: 'bg-yellow-500 dark:bg-yellow-400',
};

/** The bell's count bubble. */
export const SEVERITY_COUNT: Record<Severity, string> = {
  error: 'bg-red-600 text-white dark:bg-red-500',
  high: 'bg-red-600 text-white dark:bg-red-500',
  low: 'bg-yellow-400 text-black',
};

/** A table row that needs review, whatever its priority. */
export const REVIEW_ROW_TINT =
  'bg-foreground/[0.035] hover:bg-foreground/[0.06] dark:bg-foreground/[0.06] dark:hover:bg-foreground/[0.09]';
