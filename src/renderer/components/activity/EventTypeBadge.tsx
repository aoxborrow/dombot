import type { DomainEvent } from '../../../shared/domain-events';
import { VERB } from '../../lib/activity';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

// One look for an event type wherever it shows: the Activity Type column and
// Archive's Status column (a name's status there is its latest ownership
// event: Sold, Dropped, Archived, or Removed).

// Colored by group, not by how urgent (that's the priority dot, see
// lib/severity.ts): names coming in (added, registered, purchased) blue,
// names lost (removed, dropped) rose, sold green, moves purple, renewals
// teal, archiving gray.
const IN = 'border-sky-500/40 text-sky-600 dark:text-sky-400';
const LOST = 'border-rose-500/40 text-rose-600 dark:text-rose-400';
const IN_DOT = 'bg-sky-500 dark:bg-sky-400';
const LOST_DOT = 'bg-rose-500 dark:bg-rose-400';

const TYPE_STYLE: Record<DomainEvent['type'], string> = {
  added: IN,
  registered: IN,
  purchased: IN,
  removed: LOST,
  dropped: LOST,
  sold: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
  moved: 'border-purple-500/40 text-purple-600 dark:text-purple-400',
  renewed: 'border-teal-500/40 text-teal-600 dark:text-teal-400',
  archived: 'border-border text-muted-foreground',
};

/** The same colors as a dot, for filter options. */
const TYPE_DOT: Record<DomainEvent['type'], string> = {
  added: IN_DOT,
  registered: IN_DOT,
  purchased: IN_DOT,
  removed: LOST_DOT,
  dropped: LOST_DOT,
  sold: 'bg-emerald-500 dark:bg-emerald-400',
  moved: 'bg-purple-500 dark:bg-purple-400',
  renewed: 'bg-teal-500 dark:bg-teal-400',
  archived: 'bg-muted-foreground/60',
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
