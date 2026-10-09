import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpCircle, History, X } from 'lucide-react';
import { BellIcon } from '@heroicons/react/24/outline';
import { toUnicode } from '../../../shared/domain-name';
import {
  notificationBadge,
  notifications,
  type Notification,
} from '../../../shared/notifications';
import { SEVERITY_COUNT, SEVERITY_DOT } from '../../lib/severity';
import { accountName } from '../../lib/domain-history';
import { syncProblems } from '../../lib/activity';
import { timeAgo } from '../../lib/time';
import { useAppStore } from '../../store/app';
import { useAvailableUpdate, useUpdates } from '../../lib/updates';
import { EventTypeBadge } from './EventTypeBadge';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverArrow,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

/** Rows the dropdown shows before "and N more". */
const SHOWN = 10;

/**
 * The header bell: a compact list of what needs you. Sync errors first, then
 * names removed from a registrar, then names added, newest first. It only
 * tells you; the actions are on the Activity page, which a row opens filtered
 * to that name. The badge counts everything and takes the most severe color.
 * A newer DomBot release sits on top in green and counts toward the badge
 * until it's dismissed here; the next release brings it back.
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
  const available = useAvailableUpdate();
  const dismissed = useUpdates((s) => s.dismissed);
  const dismissUpdate = useUpdates((s) => s.dismiss);
  const update =
    available && available.latest.version !== dismissed ? available : null;
  const badge = notificationBadge(list);
  const count = (badge?.count ?? 0) + (update ? 1 : 0);
  // The worst severity's color, or green when the update is all there is.
  const countColor = badge
    ? SEVERITY_COUNT[badge.severity]
    : 'bg-brand text-white';
  const reviews = list.filter((n) => n.severity !== 'error').length;
  const close = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          // No visible button: the bell brightens on hover, and the 32px box
          // keeps the click area. Nudged down to line up with the tabs, which
          // sit on the header's bottom edge (phones have no tabs).
          className="relative inline-flex size-8 items-center sm:translate-y-[3px] justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:text-foreground"
          aria-label={
            count
              ? `Notifications: ${count} item${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention`
              : 'Notifications'
          }
        >
          <BellIcon className="size-5" />
          {count > 0 && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums',
                countColor,
              )}
            >
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      {/* Centered under the bell; Radix slides it along when the window
          edge is too close, and the arrow keeps pointing at the bell. */}
      <PopoverContent
        align="center"
        sideOffset={6}
        collisionPadding={16}
        className="flex max-h-[70vh] w-[min(420px,calc(100vw-2rem))] flex-col p-0"
      >
        <PopoverArrow />
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
            state={{ fresh: true }}
            onClick={close}
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground dark:hover:bg-accent/50"
          >
            <History className="size-3.5" />
            View activity
          </Link>
        </div>

        {update && (
          // The whole row highlights on hover, under the dismiss button too.
          <div className="flex items-center border-b bg-brand/[0.06] hover:bg-brand/10">
            <Link
              to="/settings?tab=about"
              onClick={close}
              className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-sm"
              title={`You have ${update.current}`}
            >
              <ArrowUpCircle
                className="size-4 shrink-0 text-brand"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-brand">
                  DomBot {update.latest.version}
                </span>{' '}
                <span className="text-muted-foreground">is available</span>
              </span>
              {update.latest.publishedAt && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {timeAgo(Date.parse(update.latest.publishedAt))}
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={() => dismissUpdate(update.latest.version)}
              aria-label={`Dismiss DomBot ${update.latest.version}`}
              title="Dismiss until the next release"
              className="mx-1 shrink-0 rounded p-1.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {list.length === 0 && update ? null : list.length === 0 ? (
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
                  state={{ fresh: true }}
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
 * Activity on that name; a sync error opens Settings → Registrars, where its
 * card has the details (the message is also the row's tooltip).
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
      className={cn('size-2 shrink-0 rounded-full', SEVERITY_DOT[n.severity])}
      aria-hidden
    />
  );
  if (n.kind === 'sync-error') {
    // Opens Settings → Registrars, where the account's card has the error.
    return (
      <Link
        to="/settings?tab=registrars"
        onClick={onNavigate}
        className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-foreground/5 dark:hover:bg-accent/50"
        title={n.message}
      >
        {/* No dot: the solid pill is the signal, set apart from the
            outlined event types below. */}
        <Badge className="border-transparent bg-red-600 text-white dark:bg-red-500">
          Error
        </Badge>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">
            {account ?? n.message.split(':')[0]}
          </span>{' '}
          <span className="text-muted-foreground">sync failed</span>
        </span>
        {n.at !== null && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {timeAgo(n.at)}
          </span>
        )}
      </Link>
    );
  }
  const name = toUnicode(n.domain ?? '');
  return (
    <Link
      to={`/activity?review=1&q=${encodeURIComponent(name)}`}
      // Activity clears its other filters so this name shows.
      state={{ fresh: true }}
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
