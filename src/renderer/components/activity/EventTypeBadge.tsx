import type { DomainEvent } from '../../../shared/domain-events';
import { VERB } from '../../lib/activity';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

// One look for an event type wherever it shows: the Activity Type column and
// Archive's Status column (a name's status there is its latest ownership
// event: Sold, Dropped, Archived, or Removed).

/** Badge colors: added green, removed amber, moves blue, … */
const TYPE_STYLE: Record<DomainEvent['type'], string> = {
  added: 'border-brand/40 text-brand-600 dark:text-brand',
  removed: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
  moved: 'border-sky-500/40 text-sky-600 dark:text-sky-400',
  registered: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
  purchased: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
  sold: 'border-violet-500/40 text-violet-600 dark:text-violet-400',
  dropped: 'border-red-500/40 text-red-600 dark:text-red-400',
  archived: 'border-border text-muted-foreground',
  renewed: 'border-teal-500/40 text-teal-600 dark:text-teal-400',
};

/** The same colors as a dot, for filter options. */
const TYPE_DOT: Record<DomainEvent['type'], string> = {
  added: 'bg-brand-600 dark:bg-brand',
  removed: 'bg-amber-500 dark:bg-amber-400',
  moved: 'bg-sky-500 dark:bg-sky-400',
  registered: 'bg-emerald-500 dark:bg-emerald-400',
  purchased: 'bg-emerald-500 dark:bg-emerald-400',
  sold: 'bg-violet-500 dark:bg-violet-400',
  dropped: 'bg-red-500 dark:bg-red-400',
  archived: 'bg-muted-foreground/60',
  renewed: 'bg-teal-500 dark:bg-teal-400',
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
