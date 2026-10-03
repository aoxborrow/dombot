import type { DomainEvent } from '../../../shared/domain-events';
import { VERB } from '../../lib/activity';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

// One look for an event type wherever it shows: the Activity Type column and
// Archive's Status column (a name's status there is its latest ownership
// event: Sold, Dropped, Archived, or Removed).

// Colored by group, and calm: urgency is the Activity status column's job
// (lib/severity.ts), so no type uses red, orange, or yellow. Names coming in
// (added, registered, purchased) are blue, sold green, and the changes to a
// name you keep (renewed, moved) indigo. Losing a name is neutral: removed in
// plain text, dropped and archived muted gray.
const IN =
  'border-blue-700/30 text-blue-700 dark:border-blue-300/30 dark:text-blue-300';
const IN_DOT = 'bg-blue-700 dark:bg-blue-300';
const KEPT = 'border-indigo-500/40 text-indigo-600 dark:text-indigo-400';
const KEPT_DOT = 'bg-indigo-500 dark:bg-indigo-400';
const GRAY = 'border-border text-muted-foreground';
const GRAY_DOT = 'bg-muted-foreground/60';

const TYPE_STYLE: Record<DomainEvent['type'], string> = {
  added: IN,
  registered: IN,
  purchased: IN,
  removed: 'border-foreground/25 text-foreground',
  dropped: GRAY,
  archived: GRAY,
  sold: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
  moved: KEPT,
  renewed: KEPT,
};

/** The same colors as a dot, for filter options. */
const TYPE_DOT: Record<DomainEvent['type'], string> = {
  added: IN_DOT,
  registered: IN_DOT,
  purchased: IN_DOT,
  removed: 'bg-foreground/70',
  dropped: GRAY_DOT,
  archived: GRAY_DOT,
  sold: 'bg-emerald-500 dark:bg-emerald-400',
  moved: KEPT_DOT,
  renewed: KEPT_DOT,
};

export function EventTypeBadge({
  type,
  title,
}: {
  type: DomainEvent['type'];
  title?: string;
}) {
  return (
    <Badge variant="outline" className={TYPE_STYLE[type]} title={title}>
      {VERB[type]}
    </Badge>
  );
}

export function EventTypeDot({ type }: { type: DomainEvent['type'] }) {
  return (
    <span
      className={cn('m-1 size-2 shrink-0 rounded-full', TYPE_DOT[type])}
      aria-hidden
    />
  );
}
