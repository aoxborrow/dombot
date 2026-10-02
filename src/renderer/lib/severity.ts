import type { Severity } from '../../shared/notifications';

// How urgent something is, in one set of colors wherever it shows: the bell,
// its count, and the Activity page's status dots and Priority filter. Red and
// yellow from the Domains table's expiry ramp (see expiryColor there): a
// removed name is as urgent as a sync error, an added one only needs a look.

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

/** A table row that needs review: a faint tint in its priority's color and
 *  a 3px bar down its left edge (drawn on the first cell). */
export const REVIEW_ROW_TINT: Record<Exclude<Severity, 'error'>, string> = {
  high: 'bg-red-500/[0.06] hover:bg-red-500/[0.1] [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-red-500)]',
  low: 'bg-yellow-400/[0.05] hover:bg-yellow-400/[0.09] [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-yellow-400)]',
};
