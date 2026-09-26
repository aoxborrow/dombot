import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CircleAlert } from 'lucide-react';
import { toUnicode } from '../../../shared/domain-name';
import { DEFAULT_CURRENCY, DEFAULT_NUMBER_FORMAT } from '../../../shared/money';
import { useAppStore } from '../../store/app';
import type { DomainEvent } from '../../../shared/domain-events';
import type { RegistrarMeta } from '../../../shared/ipc';
import type { NumberFormatId } from '../../../shared/money';
import {
  bellBadge,
  describeEvent,
  recentMoves,
  reviewQueues,
  syncProblems,
  type BadgeTone,
} from '../../lib/activity';
import { AlertActions } from './AlertActions';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const DEPARTURES_SHOWN = 5;
const ARRIVALS_SHOWN = 3;

const TONE: Record<BadgeTone, string> = {
  error: 'bg-destructive text-white',
  review: 'bg-amber-500 text-white dark:bg-amber-400 dark:text-black',
  quiet: 'bg-muted-foreground text-background',
};

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * The header bell. Always there, and always opens the same dropdown, grouped
 * by severity: sync errors, then names that left (with their actions), then
 * new names (the lowest-priority alert: they only ask what you paid), then
 * recent moves between your accounts. The badge counts everything waiting and
 * takes the color of the most severe; new names alone leave it gray. "View
 * all activity" opens the Activity page, where nothing is ever lost.
 */
export function ActivityBell() {
  const events = useAppStore((s) => s.domainEvents);
  const registrars = useAppStore((s) => s.registrars);
  const settings = useAppStore((s) => s.settings);
  const [open, setOpen] = useState(false);
  // "Recent" is measured from when the header mounted; fine for a week window.
  const [mountedAt] = useState(() => Date.now());
  const numberFormat = settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;

  const { departures, arrivals } = useMemo(
    () => reviewQueues(events),
    [events],
  );
  const problems = useMemo(() => syncProblems(registrars), [registrars]);
  const moves = useMemo(
    () => recentMoves(events, mountedAt - WEEK).slice(0, 3),
    [events, mountedAt],
  );
  const badge = bellBadge(problems.length, departures.length, arrivals.length);
  const count = badge?.count ?? 0;
  const close = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground dark:hover:bg-accent/50"
          aria-label={
            count
              ? `Activity: ${count} item${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention`
              : 'Activity'
          }
        >
          <Bell className="size-4" />
          {badge && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium tabular-nums',
                TONE[badge.tone],
              )}
            >
              {badge.count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-[70vh] w-96 flex-col p-0"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {problems.length > 0 && (
            <Section title="Sync errors">
              {problems.map((p) => (
                <div key={p.accountId} className="flex gap-2 text-sm">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <div className="min-w-0">
                    <p className="font-medium">{p.account}</p>
                    <p className="break-words text-xs text-muted-foreground">
                      {p.message}
                    </p>
                    <Link
                      to="/settings?tab=registrars"
                      className="text-xs underline underline-offset-4"
                      onClick={close}
                    >
                      Open Settings
                    </Link>
                  </div>
                </div>
              ))}
            </Section>
          )}
          {departures.length > 0 && (
            <Section title="Needs review">
              <AlertList
                items={departures}
                shown={DEPARTURES_SHOWN}
                registrars={registrars}
                numberFormat={numberFormat}
                preferred={preferred}
                onNavigate={close}
              />
            </Section>
          )}
          {arrivals.length > 0 && (
            <Section title="New names">
              <AlertList
                items={arrivals}
                shown={ARRIVALS_SHOWN}
                registrars={registrars}
                numberFormat={numberFormat}
                preferred={preferred}
                onNavigate={close}
              />
            </Section>
          )}
          {moves.length > 0 && (
            <Section title="Recent moves">
              {moves.map((e) => (
                <p key={e.id} className="text-sm">
                  <span className="font-mono font-medium">
                    {toUnicode(e.domain)}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    {describeEvent(
                      e,
                      registrars,
                      numberFormat,
                      preferred,
                    ).replace(/^Moved/, 'moved')}
                  </span>
                </p>
              ))}
            </Section>
          )}
          {count === 0 && moves.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing needs your attention.
            </p>
          )}
        </div>
        <div className="border-t px-4 py-2.5">
          <Link
            to="/activity"
            className="text-sm underline underline-offset-4"
            onClick={close}
          >
            View all activity
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Open alerts with their actions, and a link to the rest. */
function AlertList({
  items,
  shown,
  registrars,
  numberFormat,
  preferred,
  onNavigate,
}: {
  items: DomainEvent[];
  shown: number;
  registrars: RegistrarMeta[] | null;
  numberFormat: NumberFormatId;
  preferred: string;
  onNavigate: () => void;
}) {
  return (
    <>
      {items.slice(0, shown).map((e) => (
        <div key={e.id} className="flex flex-col gap-1.5">
          <p className="text-sm">
            <span className="font-mono font-medium">{toUnicode(e.domain)}</span>{' '}
            <span className="text-muted-foreground">
              {describeEvent(e, registrars, numberFormat, preferred)
                .replace(/^Arrived/, 'arrived')
                .replace(/^Left/, 'left')}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">{when(e.createdAt)}</p>
          <AlertActions event={e} size="xs" />
        </div>
      ))}
      {items.length > shown && (
        <Link
          to="/activity?review=1"
          className="text-sm underline underline-offset-4"
          onClick={onNavigate}
        >
          {items.length - shown} more to review
        </Link>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b px-4 py-3 last:border-b-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}
