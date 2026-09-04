import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import type {
  BulkJob,
  Domain,
  DomainOp,
  DomainOpResult,
  DomainOpStatus,
  DomainTarget,
} from '../../../shared/ipc';
import { friendlyError } from '../../../shared/domain-ops';
import { useAppStore } from '../../store/app';
import {
  bucketSelection,
  bulkOpTitle,
  isRetryable,
  isRiskyOp,
  resultsCsvFilename,
  resultsToCsv,
  STATUS_LABEL,
} from '../../lib/bulk';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '../ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * The three-stage bulk dialog every bulk op uses:
 *  1. Configure — the eligibility summary (what will change, what's skipped,
 *     what the registrar can't do) and Start.
 *  2. Running — progress, the live results list, Cancel. Closing the dialog
 *     doesn't stop the job; the bar keeps a progress pill.
 *  3. Done — counts, the failures, Retry failed, Export results CSV.
 *
 * With `jobId` it opens straight onto that job's Running/Done stage (the
 * bar's View button).
 */
export function BulkActionDialog({
  op,
  domains,
  jobId: initialJobId = null,
  onClose,
}: {
  op: DomainOp;
  /** The selected domains (merged rows). */
  domains: Domain[];
  jobId?: string | null;
  onClose: () => void;
}) {
  const bulk = useAppStore((s) => s.bulk);
  const registrars = useAppStore((s) => s.registrars);
  const enriched = useAppStore((s) => s.enriched);
  const startBulk = useAppStore((s) => s.startBulk);
  const cancelBulk = useAppStore((s) => s.cancelBulk);

  const [jobId, setJobId] = useState<string | null>(initialJobId);
  // After "Retry failed": only these targets are offered in Configure.
  const [retryOf, setRetryOf] = useState<Set<string> | null>(null);
  const [starting, setStarting] = useState(false);

  const job = bulk && bulk.id === jobId ? bulk : null;
  const stage: 'configure' | 'running' | 'done' = !job
    ? 'configure'
    : job.status === 'running'
      ? 'running'
      : 'done';

  const candidates = useMemo(
    () =>
      retryOf
        ? domains.filter((d) => retryOf.has(`${d.registrar}:${d.domainName}`))
        : domains,
    [domains, retryOf],
  );
  const buckets = useMemo(
    () =>
      bucketSelection(
        candidates,
        op,
        registrars,
        (d) => `${d.registrar}:${d.domainName}` in enriched,
      ),
    [candidates, op, registrars, enriched],
  );

  const anotherRunning = bulk?.status === 'running' && bulk.id !== jobId;

  const start = async () => {
    if (starting || buckets.eligible.length === 0) return;
    setStarting(true);
    try {
      const targets: DomainTarget[] = buckets.eligible.map((d) => ({
        registrar: d.registrar as DomainTarget['registrar'],
        domainName: d.domainName,
      }));
      const started = await startBulk(targets, op);
      setJobId(started.id);
    } catch (err) {
      toast.error('Couldn’t start the bulk action', {
        description: friendlyError(
          err instanceof Error ? err.message : String(err),
        ),
      });
    } finally {
      setStarting(false);
    }
  };

  const retryFailed = (j: BulkJob) => {
    const keys = j.results
      .filter((r) => isRetryable(r.status))
      .map((r) => `${r.target.registrar}:${r.target.domainName}`);
    setRetryOf(new Set(keys));
    setJobId(null);
  };

  const exportResults = async (j: BulkJob) => {
    try {
      const result = await window.api.saveCsv(
        resultsToCsv(j),
        resultsCsvFilename(j),
      );
      if (result.saved) toast.success('Results exported');
    } catch (err) {
      toast.error('Export failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const title = bulkOpTitle(op);

  if (stage === 'configure') {
    const n = buckets.eligible.length;
    return (
      <ConfirmDialog
        title={`${title} · ${n} domain${n === 1 ? '' : 's'}`}
        description={
          anotherRunning
            ? 'Another bulk action is running — wait for it to finish.'
            : retryOf
              ? 'Retrying the domains that failed last time.'
              : 'Applied one domain at a time, paced per registrar. You can cancel while it runs.'
        }
        actionLabel={starting ? 'Starting…' : 'Start'}
        busy={starting}
        disabled={n === 0 || anotherRunning}
        destructive={isRiskyOp(op)}
        onConfirm={() => void start()}
        onClose={onClose}
      >
        <Buckets buckets={buckets} />
      </ConfirmDialog>
    );
  }

  // Running / Done share a plain dialog (not a confirmation).
  const j = job!;
  const done = j.results.length;
  const pct = j.total === 0 ? 100 : Math.round((done / j.total) * 100);
  const failures = j.results.filter(
    (r) => r.status !== 'ok' && r.status !== 'skipped',
  );
  const retryable = j.results.filter((r) => isRetryable(r.status)).length;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {title} ·{' '}
            {stage === 'running'
              ? `${done}/${j.total}`
              : j.status === 'cancelled'
                ? 'cancelled'
                : 'done'}
          </DialogTitle>
          <DialogDescription>
            {stage === 'running'
              ? 'Closing this keeps the job running; the bar shows its progress.'
              : summarize(j)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width]',
                j.status === 'cancelled'
                  ? 'bg-muted-foreground/50'
                  : 'bg-primary',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(Object.keys(j.counts) as DomainOpStatus[])
              .filter((s) => j.counts[s] > 0)
              .map((s) => (
                <span key={s}>
                  <StatusDot status={s} /> {STATUS_LABEL[s]}{' '}
                  <span className="tabular-nums text-foreground">
                    {j.counts[s]}
                  </span>
                </span>
              ))}
          </div>

          <ResultsList
            results={stage === 'running' ? j.results : failures}
            emptyText={
              stage === 'running'
                ? 'Waiting for the first result…'
                : 'No failures.'
            }
          />
        </div>

        <DialogFooter>
          {stage === 'running' ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Hide
              </Button>
              <Button variant="destructive" onClick={() => void cancelBulk()}>
                Cancel job
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => void exportResults(j)}>
                Export results CSV
              </Button>
              {retryable > 0 && op.kind !== 'renew' && (
                <Button variant="outline" onClick={() => retryFailed(j)}>
                  Retry {retryable} failed
                </Button>
              )}
              <Button onClick={onClose}>Close</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function summarize(j: BulkJob): string {
  const parts: string[] = [];
  if (j.counts.ok) parts.push(`${j.counts.ok} done`);
  if (j.counts.skipped) parts.push(`${j.counts.skipped} skipped`);
  if (j.counts.failed) parts.push(`${j.counts.failed} failed`);
  if (j.counts['rate-limited'])
    parts.push(`${j.counts['rate-limited']} rate limited`);
  if (j.counts.unsupported) parts.push(`${j.counts.unsupported} unsupported`);
  if (j.counts.cancelled) parts.push(`${j.counts.cancelled} cancelled`);
  return parts.join(' · ') || 'Nothing to do.';
}

const DOT: Record<DomainOpStatus, string> = {
  ok: 'bg-[#7ac28d]',
  failed: 'bg-red-500',
  unsupported: 'bg-amber-500',
  skipped: 'bg-muted-foreground/50',
  'rate-limited': 'bg-orange-500',
  cancelled: 'bg-muted-foreground/50',
};

function StatusDot({ status }: { status: DomainOpStatus }) {
  return (
    <span
      className={cn(
        'inline-block size-2 rounded-full align-middle',
        DOT[status],
      )}
      aria-hidden
    />
  );
}

/** Newest first, scrollable. */
function ResultsList({
  results,
  emptyText,
}: {
  results: DomainOpResult[];
  emptyText: string;
}) {
  if (results.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ul className="max-h-64 overflow-y-auto rounded-md border text-xs">
      {[...results].reverse().map((r, i) => (
        <li
          key={`${r.target.registrar}:${r.target.domainName}:${i}`}
          className="flex items-start gap-2 border-b px-2.5 py-1.5 last:border-b-0"
        >
          <span className="mt-1.5 shrink-0">
            <StatusDot status={r.status} />
          </span>
          <span className="w-44 shrink-0 truncate font-mono">
            {r.target.domainName}
          </span>
          <span
            className={cn(
              'min-w-0 flex-1 break-words',
              r.status === 'ok' ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {friendlyError(r.message)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The Configure stage's eligibility summary with expandable lists. */
function Buckets({ buckets }: { buckets: ReturnType<typeof bucketSelection> }) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <Bucket
        label="Will change"
        tone="text-foreground"
        items={buckets.eligible.map((d) => ({
          name: d.domainName,
          note: d.registrar,
        }))}
      />
      <Bucket
        label="Already in state — skipped"
        tone="text-muted-foreground"
        items={buckets.skipped.map((s) => ({
          name: s.domain.domainName,
          note: s.reason,
        }))}
      />
      <Bucket
        label="Not supported by the registrar"
        tone="text-amber-600 dark:text-amber-400"
        items={buckets.unsupported.map((s) => ({
          name: s.domain.domainName,
          note: s.reason,
        }))}
      />
    </div>
  );
}

function Bucket({
  label,
  tone,
  items,
}: {
  label: string;
  tone: string;
  items: { name: string; note: string }[];
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn('group inline-flex items-center gap-1', tone)}
      >
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        <span className="tabular-nums">{items.length}</span> {label}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 ml-5 max-h-40 overflow-y-auto text-xs">
          {items.map((it) => (
            <li key={it.name} className="flex gap-2 py-0.5">
              <span className="font-mono">{it.name}</span>
              <span className="truncate text-muted-foreground">{it.note}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
