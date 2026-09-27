import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, History } from 'lucide-react';
import { toUnicode } from '../../../shared/domain-name';
import {
  notificationBadge,
  notifications,
  type Notification,
  type Severity,
} from '../../../shared/notifications';
import { accountName } from '../../lib/domain-history';
import { syncProblems } from '../../lib/activity';
import { timeAgo } from '../../lib/time';
import { useAppStore } from '../../store/app';
import { EventTypeBadge } from './EventTypeBadge';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

/** Rows the dropdown shows before "and N more". */
const SHOWN = 10;

const BADGE_TONE: Record<Severity, string> = {
  error: 'bg-destructive text-white',
  high: 'bg-amber-500 text-white dark:bg-amber-400 dark:text-black',
  low: 'bg-muted-foreground text-background',
};

const DOT_TONE: Record<Severity, string> = {
  error: 'bg-destructive',
  high: 'bg-amber-500 dark:bg-amber-400',
  low: 'bg-muted-foreground/60',
};

/**
 * The header bell: a compact list of what needs you (docs/activity-redesign.md,
 * "The bell"). Sync errors first, then names removed from a registrar, then
 * names added, newest first. It only tells you; the actions are on the
 * Activity page, which a row opens filtered to that name. The badge counts
 * everything and takes the most severe color.
 */
export function ActivityBell() {
  const events = useAppStore((s) => s.domainEvents);
  const registrars = useAppStore((s) => s.registrars);
  const [open, setOpen] = useState(false);

  const problems = useMemo(() => syncProblems(registrars), [registrars]);
  const list = useMemo(
    () => notifications(events, problems),
    [events, problems],
  );
  const badge = notificationBadge(list);
  const count = badge?.count ?? 0;
  const reviews = list.filter((n) => n.severity !== 'error').length;
  const close = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground dark:hover:bg-accent/50"
          aria-label={
            count
              ? `Notifications: ${count} item${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention`
              : 'Notifications'
          }
        >
          <Bell className="size-4" />
          {badge && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums',
                BADGE_TONE[badge.severity],
              )}
            >
              {badge.count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-[70vh] w-[min(420px,calc(100vw-2rem))] flex-col p-0"
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">
            Notifications
            {reviews > 0 && (
              <span className="font-normal text-muted-foreground">
                {' '}
                · {reviews} need{reviews === 1 ? 's' : ''} review
              </span>
            )}
          </p>
          <Link
            to="/activity?review=1"
            onClick={close}
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground dark:hover:bg-accent/50"
          >
            <History className="size-3.5" />
            View activity
          </Link>
        </div>

        {list.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing needs your attention.
          </p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto py-1">
            {list.slice(0, SHOWN).map((n) => (
              <li key={n.id}>
                <NotificationRow
                  n={n}
                  account={accountName(registrars, n.accountId)}
                  onNavigate={close}
                />
              </li>
            ))}
            {list.length > SHOWN && (
              <li>
                <Link
                  to="/activity?review=1"
                  onClick={close}
                  className="block px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground dark:hover:bg-accent/50"
                >
                  and {list.length - SHOWN} more
                </Link>
              </li>
            )}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * One notification: severity dot, what happened, and when. A domain row opens
 * Activity on that name; a sync error only says which account failed (the
 * details are on its card in Settings → Registrars).
 */
function NotificationRow({
  n,
  account,
  onNavigate,
}: {
  n: Notification;
  account: string | null;
  onNavigate: () => void;
}) {
  const dot = (
    <span
      className={cn('size-2 shrink-0 rounded-full', DOT_TONE[n.severity])}
      aria-hidden
    />
  );
  if (n.kind === 'sync-error') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
        {dot}
        <span className="min-w-0 truncate font-medium">
          {account ?? n.message.split(':')[0]}
        </span>
        <span className="shrink-0 text-muted-foreground">sync failed</span>
      </div>
    );
  }
  const name = toUnicode(n.domain ?? '');
  return (
    <Link
      to={`/activity?review=1&q=${encodeURIComponent(name)}`}
      onClick={onNavigate}
      className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-foreground/5 dark:hover:bg-accent/50"
      title={account ? `${name}, ${account}` : name}
    >
      {dot}
      <EventTypeBadge type={n.kind === 'departure' ? 'removed' : 'added'} />
      <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
      {n.at !== null && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {timeAgo(n.at)}
        </span>
      )}
    </Link>
  );
}
