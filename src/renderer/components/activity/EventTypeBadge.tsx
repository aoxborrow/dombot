import type { DomainEvent } from '../../../shared/domain-events';
import { VERB } from '../../lib/activity';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

// One look for an event type wherever it shows: the Activity Type column and
// Archive's Status column (a name's status there is its latest ownership
// event: Sold, Dropped, Archived, or Removed).

// Colored by group, not by how urgent: names coming in (added, registered,
// purchased) are green, names going out (removed, sold, dropped) violet,
// moves blue, renewals teal, archiving gray. Red, orange, and yellow are kept
// for priority and errors (lib/severity.ts), so a type never looks urgent.
const IN = 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400';
const OUT = 'border-violet-500/40 text-violet-600 dark:text-violet-400';
const IN_DOT = 'bg-emerald-500 dark:bg-emerald-400';
const OUT_DOT = 'bg-violet-500 dark:bg-violet-400';

const TYPE_STYLE: Record<DomainEvent['type'], string> = {
  added: IN,
  registered: IN,
  purchased: IN,
  removed: OUT,
  sold: OUT,
  dropped: OUT,
  moved: 'border-sky-500/40 text-sky-600 dark:text-sky-400',
  renewed: 'border-teal-500/40 text-teal-600 dark:text-teal-400',
  archived: 'border-border text-muted-foreground',
};

/** The same colors as a dot, for filter options. */
const TYPE_DOT: Record<DomainEvent['type'], string> = {
  added: IN_DOT,
  registered: IN_DOT,
  purchased: IN_DOT,
  removed: OUT_DOT,
  sold: OUT_DOT,
  dropped: OUT_DOT,
  moved: 'bg-sky-500 dark:bg-sky-400',
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
