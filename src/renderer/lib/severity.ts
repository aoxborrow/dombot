import type { Severity } from '../../shared/notifications';

// How urgent something is, in one set of colors wherever it shows: the bell,
// its count, and the Activity page's status dots, row tints, and Priority
// filter. Red, orange, and yellow from the Domains table's expiry ramp (see
// expiryColor there). Red is kept for sync errors; event types use other hues.

/** A small status dot. */
export const SEVERITY_DOT: Record<Severity, string> = {
  error: 'bg-red-600 dark:bg-red-500',
  high: 'bg-orange-500 dark:bg-orange-375',
  low: 'bg-yellow-500 dark:bg-yellow-400',
};

/** The bell's count bubble. */
export const SEVERITY_COUNT: Record<Severity, string> = {
  error: 'bg-red-600 text-white dark:bg-red-500',
  high: 'bg-orange-500 text-white dark:bg-orange-375 dark:text-black',
  low: 'bg-yellow-400 text-black',
};

/** A table row that needs review. */
export const SEVERITY_ROW_TINT: Record<Exclude<Severity, 'error'>, string> = {
  high: 'bg-orange-500/[0.07] hover:bg-orange-500/[0.11] dark:bg-orange-375/[0.07] dark:hover:bg-orange-375/[0.11]',
  low: 'bg-yellow-500/[0.07] hover:bg-yellow-500/[0.11] dark:bg-yellow-400/[0.05] dark:hover:bg-yellow-400/[0.09]',
};
