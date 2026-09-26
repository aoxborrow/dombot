import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { toUnicode } from '../../shared/domain-name';
import { DEFAULT_CURRENCY, DEFAULT_NUMBER_FORMAT } from '../../shared/money';
import { AlertActions } from '../components/activity/AlertActions';
import {
  SOURCE_LABEL,
  alertStatus,
  describeEvent,
  resolutions,
  reviewItems,
  trackingSince,
} from '../lib/activity';
import { useAppStore } from '../store/app';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE = 100;

/**
 * Every domain event, newest first: what you recorded (purchases, sales,
 * labels) and what sync saw (arrivals, departures, moves). Alerts that need
 * review carry their actions inline; answered or dismissed ones keep their
 * outcome and can be undone, so nothing disappears.
 */
export default function Activity() {
  const events = useAppStore((s) => s.domainEvents);
  const registrars = useAppStore((s) => s.registrars);
  const settings = useAppStore((s) => s.settings);
  const setAlertsDismissed = useAppStore((s) => s.setAlertsDismissed);
  const deleteUserEvent = useAppStore((s) => s.deleteUserEvent);
  const [params, setParams] = useSearchParams();
  const reviewOnly = params.get('review') === '1';
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const numberFormat = settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;

  const closedBy = useMemo(() => resolutions(events), [events]);
  const reviewCount = useMemo(() => reviewItems(events).length, [events]);
  const since = trackingSince(registrars);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const newest = [...events].reverse();
    return newest.filter((e) => {
      if (q && !toUnicode(e.domain).includes(q) && !e.domain.includes(q))
        return false;
      if (reviewOnly) return alertStatus(e, closedBy.get(e.id))?.open === true;
      return true;
    });
  }, [events, search, reviewOnly, closedBy]);

  const setTab = (review: boolean) => {
    const next = new URLSearchParams(params);
    if (review) next.set('review', '1');
    else next.delete('review');
    setParams(next, { replace: true });
    setLimit(PAGE);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-[13px]">
      <div>
        <h1 className="text-2xl font-bold leading-none sm:text-[32px]">
          Activity
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {since
            ? `Tracking changes since ${new Date(since).toLocaleDateString(undefined, { dateStyle: 'medium' })}. `
            : 'Changes are tracked from each account’s first sync. '}
          Purchases, sales, and what sync saw arrive, leave, or move.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-label="Which activity to show"
          className="inline-flex items-center gap-1 rounded-lg border p-1 text-sm"
        >
          {(
            [
              [false, 'All', events.length],
              [true, 'Needs review', reviewCount],
            ] as const
          ).map(([review, label, count]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={reviewOnly === review}
              onClick={() => setTab(review)}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-md px-3 font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground dark:hover:bg-accent/50',
                reviewOnly === review &&
                  'bg-foreground/10 text-foreground dark:bg-accent',
              )}
            >
              {label}
              <span className="tabular-nums">{count}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search domains…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(PAGE);
            }}
            className="w-64 pl-8"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Date</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>What happened</TableHead>
              <TableHead className="w-20">By</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, limit).map((e) => {
              const closer = closedBy.get(e.id);
              const status = alertStatus(e, closer);
              return (
                <TableRow key={e.id}>
                  <TableCell
                    className="font-mono text-sm text-muted-foreground"
                    title={new Date(e.createdAt).toLocaleString()}
                  >
                    {e.date ?? '—'}
                  </TableCell>
                  <TableCell className="font-mono">
                    {toUnicode(e.domain)}
                  </TableCell>
                  <TableCell>
                    {describeEvent(e, registrars, numberFormat, preferred)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {SOURCE_LABEL[e.source]}
                  </TableCell>
                  <TableCell>
                    {status?.open ? (
                      <AlertActions event={e} size="xs" />
                    ) : status ? (
                      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        {status.text}
                        {status.undo && (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              void (
                                status.undo === 'dismissal'
                                  ? setAlertsDismissed([e.id], false)
                                  : deleteUserEvent(closer!.id)
                              ).then(() =>
                                toast.success(
                                  `${toUnicode(e.domain)} needs review again`,
                                ),
                              )
                            }
                          >
                            Undo
                          </Button>
                        )}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-10 text-center text-muted-foreground"
                >
                  {reviewOnly
                    ? 'Nothing needs review.'
                    : search
                      ? 'No activity for that domain.'
                      : 'No activity yet. Arrivals, departures, and moves appear after an account’s second sync; purchases and sales as you record them.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {rows.length > limit && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLimit((n) => n + PAGE)}
          >
            Show {Math.min(PAGE, rows.length - limit)} more
          </Button>
        </div>
      )}
    </div>
  );
}
