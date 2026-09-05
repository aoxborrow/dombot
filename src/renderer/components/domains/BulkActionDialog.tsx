import { useMemo, useState } from 'react';
import { ChevronRight, Copy, TriangleAlert } from 'lucide-react';
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
  flagOf,
  flagOp,
  flagTarget,
  hasAuthCodes,
  isRetryable,
  isRiskyOp,
  registrarRuleConflicts,
  resultsCsvFilename,
  resultsToCsv,
  STATUS_LABEL,
  type FlagKind,
} from '../../lib/bulk';
import {
  normalizeEmailForward,
  normalizeUrlForward,
  validateEmailForwards,
  validateUrlForwards,
} from '../../lib/forwarding-input';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '../ConfirmDialog';
import { ConfirmPopover } from '../ConfirmPopover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NameserversEditor } from './NameserversEditor';
import { UrlForwardingEditor } from './UrlForwardingEditor';
import { EmailForwardingEditor } from './EmailForwardingEditor';
import { useNameserverPresets } from './useNameserverPresets';

/**
 * The three-stage bulk dialog every bulk op uses:
 *  1. Configure — choose the value (on/off for the flag kinds; a payload
 *     editor for the rest), see the eligibility summary (what will change,
 *     what's already there, what the registrar can't do), and Start.
 *  2. Running — progress, the live results list, Cancel. Closing the dialog
 *     doesn't stop the job; the bar keeps a progress pill.
 *  3. Done — counts, the failures, Retry failed, Export results CSV. Auth
 *     codes get a results table with copy instead.
 *
 * With `jobId` it opens straight onto that job's Running/Done stage (the
 * bar's View button).
 */
export function BulkActionDialog({
  initialOp,
  domains,
  jobId: initialJobId = null,
  onClose,
}: {
  /** The op to open with; the Configure stage may change its value. */
  initialOp: DomainOp;
  /** The selected domains (merged rows). */
  domains: Domain[];
  jobId?: string | null;
  onClose: () => void;
}) {
  const bulk = useAppStore((s) => s.bulk);
  const registrars = useAppStore((s) => s.registrars);
  const enriched = useAppStore((s) => s.enriched);
  const pricing = useAppStore((s) => s.pricing);
  const startBulk = useAppStore((s) => s.startBulk);
  const cancelBulk = useAppStore((s) => s.cancelBulk);
  const rememberNameservers = useAppStore((s) => s.rememberNameservers);

  const [op, setOp] = useState<DomainOp>(initialOp);
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  // After "Retry failed": only these targets are offered in Configure.
  const [retryOf, setRetryOf] = useState<Set<string> | null>(null);
  const [starting, setStarting] = useState(false);
  // The nameserver editor's parsed set (null while invalid/empty).
  const [nsValid, setNsValid] = useState<string[] | null>(null);

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

  // Payload validation. Forwarding rules are checked registrar-agnostically
  // for the Start gate, then per registrar to hold back domains whose
  // registrar rejects the set (Gandi apex, NameSilo single rule).
  const payload = useMemo(() => {
    const none = new Map<string, string[]>();
    if (op.kind === 'urlForwarding') {
      const generic = validateUrlForwards(op.forwards);
      const conflicts = registrarRuleConflicts(
        buckets.eligible,
        (r) => validateUrlForwards(op.forwards, r),
        generic.errors,
      );
      return {
        validation: generic,
        conflicts,
        ready: generic.errors.length === 0,
      };
    }
    if (op.kind === 'emailForwarding') {
      const generic = validateEmailForwards(op.forwards);
      const conflicts = registrarRuleConflicts(
        buckets.eligible,
        (r) => validateEmailForwards(op.forwards, r),
        generic.errors,
      );
      return {
        validation: generic,
        conflicts,
        ready: generic.errors.length === 0,
      };
    }
    if (op.kind === 'nameservers') {
      return { validation: null, conflicts: none, ready: nsValid !== null };
    }
    return { validation: null, conflicts: none, ready: true };
  }, [op, buckets.eligible, nsValid]);

  const held = useMemo(
    () =>
      buckets.eligible
        .filter((d) => payload.conflicts.has(d.registrar))
        .map((d) => ({
          domain: d,
          reason: payload.conflicts.get(d.registrar)![0],
        })),
    [buckets.eligible, payload.conflicts],
  );
  const targetsToRun = useMemo(
    () => buckets.eligible.filter((d) => !payload.conflicts.has(d.registrar)),
    [buckets.eligible, payload.conflicts],
  );

  const anotherRunning = bulk?.status === 'running' && bulk.id !== jobId;

  const start = async () => {
    if (starting || targetsToRun.length === 0 || !payload.ready) return;
    setStarting(true);
    try {
      const finalOp: DomainOp =
        op.kind === 'nameservers'
          ? { kind: 'nameservers', nameservers: nsValid ?? [] }
          : op.kind === 'urlForwarding'
            ? { ...op, forwards: op.forwards.map(normalizeUrlForward) }
            : op.kind === 'emailForwarding'
              ? { ...op, forwards: op.forwards.map(normalizeEmailForward) }
              : op;
      const targets: DomainTarget[] = targetsToRun.map((d) => ({
        registrar: d.registrar as DomainTarget['registrar'],
        domainName: d.domainName,
      }));
      const started = await startBulk(targets, finalOp);
      setJobId(started.id);
      if (finalOp.kind === 'nameservers') {
        void rememberNameservers(finalOp.nameservers);
      }
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
  const wide =
    op.kind === 'nameservers' ||
    op.kind === 'urlForwarding' ||
    op.kind === 'emailForwarding';

  if (stage === 'configure') {
    const n = targetsToRun.length;
    return (
      <ConfirmDialog
        title={`${title} · ${n} domain${n === 1 ? '' : 's'}`}
        description={configureDescription(op, anotherRunning, retryOf !== null)}
        actionLabel={starting ? 'Starting…' : 'Start'}
        busy={starting}
        disabled={n === 0 || anotherRunning || !payload.ready}
        destructive={isRiskyOp(op)}
        typeToConfirm={op.kind === 'renew' ? 'RENEW' : undefined}
        wide={wide}
        onConfirm={() => void start()}
        onClose={onClose}
      >
        {flagTarget(op) !== null && (
          <FlagChooser
            kind={op.kind as FlagKind}
            value={flagTarget(op)!}
            domains={candidates}
            onChange={(on) => setOp(flagOp(op.kind as FlagKind, on))}
          />
        )}
        {op.kind === 'nameservers' && <BulkNameservers onChange={setNsValid} />}
        {op.kind === 'urlForwarding' && (
          <>
            <UrlForwardingEditor
              rows={op.forwards}
              onChange={(forwards) => setOp({ ...op, forwards })}
              validation={payload.validation!}
              urlPlaceholder="https://example.com/?from={domain}"
            />
            <TemplateHint />
            <SkipExisting
              checked={op.skipIfExisting ?? false}
              onChange={(v) => setOp({ ...op, skipIfExisting: v })}
              what="URL forwarding"
            />
          </>
        )}
        {op.kind === 'emailForwarding' && (
          <>
            <EmailForwardingEditor
              rows={op.forwards}
              onChange={(forwards) => setOp({ ...op, forwards })}
              validation={payload.validation!}
              domainName="{domain}"
            />
            <TemplateHint />
            <SkipExisting
              checked={op.skipIfExisting ?? false}
              onChange={(v) => setOp({ ...op, skipIfExisting: v })}
              what="email forwarding"
            />
          </>
        )}
        {op.kind === 'renew' && (
          <BulkRenew
            years={op.years}
            onYears={(years) => setOp({ kind: 'renew', years })}
            domains={targetsToRun}
            pricing={pricing}
          />
        )}
        {op.kind === 'authCode' && (
          <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Auth codes are transfer secrets. They’re shown once here and never
            stored by DomBot; export them only if you need a file.
          </p>
        )}
        <Buckets buckets={buckets} held={held} />
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
  const showCodes = stage === 'done' && hasAuthCodes(j);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className={showCodes ? 'sm:max-w-2xl' : undefined}>
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

          {showCodes ? (
            <AuthCodeResults results={j.results} />
          ) : (
            <ResultsList
              results={stage === 'running' ? j.results : failures}
              emptyText={
                stage === 'running'
                  ? 'Waiting for the first result…'
                  : 'No failures.'
              }
            />
          )}
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
              {showCodes ? (
                <ConfirmPopover
                  title="Export transfer secrets?"
                  body="The CSV will contain every auth code in plain text. Keep it somewhere safe and delete it when you’re done."
                  actionLabel="Export"
                  destructive
                  onConfirm={() => void exportResults(j)}
                >
                  <Button variant="outline">Export results CSV</Button>
                </ConfirmPopover>
              ) : (
                <Button variant="outline" onClick={() => void exportResults(j)}>
                  Export results CSV
                </Button>
              )}
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

function configureDescription(
  op: DomainOp,
  anotherRunning: boolean,
  retrying: boolean,
): string {
  if (anotherRunning)
    return 'Another bulk action is running — wait for it to finish.';
  if (retrying) return 'Retrying the domains that failed last time.';
  switch (op.kind) {
    case 'nameservers':
      return 'Replaces the full nameserver set on every domain below. Paced per registrar; you can cancel while it runs.';
    case 'urlForwarding':
    case 'emailForwarding':
      return 'Replaces the full rule set on every domain below — rules not listed here are removed. Paced per registrar; you can cancel while it runs.';
    case 'renew':
      return 'Renews every domain below, one at a time, and charges your registrar accounts. There is no automatic retry.';
    case 'authCode':
      return 'Fetches the authorization (EPP) code for every domain below.';
    default:
      return 'Applied one domain at a time, paced per registrar. You can cancel while it runs.';
  }
}

// ── Configure-stage forms ────────────────────────────────────────────────────

const FLAG_WORDS: Record<FlagKind, [on: string, off: string]> = {
  autoRenew: ['On', 'Off'],
  privacy: ['On', 'Off'],
  lock: ['Locked', 'Unlocked'],
};

/**
 * The on/off choice for a flag kind, with the selection's current split so
 * the number sits next to the state it describes ("7 on · 3 off").
 */
function FlagChooser({
  kind,
  value,
  domains,
  onChange,
}: {
  kind: FlagKind;
  value: boolean;
  domains: Domain[];
  onChange: (on: boolean) => void;
}) {
  const on = domains.filter((d) => flagOf(d, kind)).length;
  const off = domains.length - on;
  const [onWord, offWord] = FLAG_WORDS[kind];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Currently <span className="tabular-nums text-foreground">{on}</span>{' '}
        {onWord.toLowerCase()} ·{' '}
        <span className="tabular-nums text-foreground">{off}</span>{' '}
        {offWord.toLowerCase()}
      </p>
      <div
        role="radiogroup"
        aria-label="Target value"
        className="inline-flex w-fit rounded-md border p-0.5"
      >
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              'rounded-[5px] px-3 py-1 text-sm transition-colors',
              value === v
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {v ? onWord : offWord}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The nameserver editor in controlled mode, with the shared presets. */
function BulkNameservers({
  onChange,
}: {
  onChange: (nameservers: string[] | null) => void;
}) {
  const presets = useNameserverPresets();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        One per line. The same set is written to every domain.
      </p>
      <NameserversEditor
        initial={[]}
        presets={presets}
        showActions={false}
        onChange={onChange}
      />
    </div>
  );
}

function TemplateHint() {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-mono">{'{domain}'}</span> in a destination is
      replaced with each domain’s name, e.g.{' '}
      <span className="font-mono">https://example.com/?from={'{domain}'}</span>.
    </p>
  );
}

function SkipExisting({
  checked,
  onChange,
  what,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  what: string;
}) {
  return (
    <Label className="flex items-start gap-2 text-sm font-normal">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span>
        Skip domains that already have {what} rules
        <span className="block text-xs text-muted-foreground">
          One extra read per domain. Off, every domain’s rules are replaced.
        </span>
      </span>
    </Label>
  );
}

/** Whole/decimal USD, e.g. "$12" or "$12.99". */
function usd(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

const MAX_YEARS = 10;

/** Term picker plus the summed estimate across the domains that will run. */
function BulkRenew({
  years,
  onYears,
  domains,
  pricing,
}: {
  years: number;
  onYears: (years: number) => void;
  domains: Domain[];
  pricing: ReturnType<typeof useAppStore.getState>['pricing'];
}) {
  let known = 0;
  let total = 0;
  for (const d of domains) {
    const p = pricing[`${d.registrar}:${d.domainName}`];
    if (p?.renewal != null) {
      known += 1;
      total += p.renewal * years;
    }
  }
  const hasPorkbun = domains.some((d) => d.registrar === 'porkbun');
  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="bulk-renew-years">Term</FieldLabel>
        <Select value={String(years)} onValueChange={(v) => onYears(Number(v))}>
          <SelectTrigger id="bulk-renew-years" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: MAX_YEARS }, (_, i) => i + 1).map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} year{n === 1 ? '' : 's'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasPorkbun && (
          <p className="text-xs text-muted-foreground">
            Porkbun always renews for the registry-minimum term regardless of
            the years chosen.
          </p>
        )}
      </Field>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-md border bg-muted/30 px-3 py-2.5 text-sm">
        <dt className="text-muted-foreground">Estimated total</dt>
        <dd className="tabular-nums">
          {known === 0 ? (
            <span className="text-muted-foreground">unknown</span>
          ) : (
            <>
              {usd(total)}
              {known < domains.length && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  for {known} of {domains.length} priced
                </span>
              )}
            </>
          )}
        </dd>
      </dl>
      <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Estimates only — each registrar charges its own price, which can differ
        for premium names. Renewals run one at a time and are never retried
        automatically.
      </p>
    </div>
  );
}

// ── Running / Done pieces ────────────────────────────────────────────────────

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

/**
 * The Done stage for auth codes: domain → code, with per-row copy and Copy
 * all. Codes live only in this job's in-memory results.
 */
function AuthCodeResults({ results }: { results: DomainOpResult[] }) {
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${what}`);
    } catch {
      toast.error('Couldn’t copy to the clipboard');
    }
  };
  const withCodes = results.filter((r) => r.data?.authCode);
  const all = withCodes
    .map((r) => `${r.target.domainName}\t${r.data!.authCode}`)
    .join('\n');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {withCodes.length} code{withCodes.length === 1 ? '' : 's'} — treat
          them as secrets
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={withCodes.length === 0}
          onClick={() => void copy(all, 'all auth codes')}
        >
          <Copy />
          Copy all
        </Button>
      </div>
      <ul className="max-h-72 overflow-y-auto rounded-md border text-xs">
        {results.map((r, i) => (
          <li
            key={`${r.target.registrar}:${r.target.domainName}:${i}`}
            className="flex items-center gap-2 border-b px-2.5 py-1.5 last:border-b-0"
          >
            <StatusDot status={r.status} />
            <span className="w-48 shrink-0 truncate font-mono">
              {r.target.domainName}
            </span>
            {r.data?.authCode ? (
              <>
                <span className="min-w-0 flex-1 truncate font-mono select-all">
                  {r.data.authCode}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Copy code for ${r.target.domainName}`}
                  onClick={() =>
                    void copy(r.data!.authCode!, r.target.domainName)
                  }
                >
                  <Copy />
                </Button>
              </>
            ) : (
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {friendlyError(r.message)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The Configure stage's eligibility summary with expandable lists. */
function Buckets({
  buckets,
  held,
}: {
  buckets: ReturnType<typeof bucketSelection>;
  /** Eligible domains held back because the rule set conflicts with their
   *  registrar's own constraints. */
  held: { domain: Domain; reason: string }[];
}) {
  const heldKeys = new Set(
    held.map((h) => `${h.domain.registrar}:${h.domain.domainName}`),
  );
  const willChange = buckets.eligible.filter(
    (d) => !heldKeys.has(`${d.registrar}:${d.domainName}`),
  );
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <Bucket
        label="Will change"
        tone="text-foreground"
        items={willChange.map((d) => ({
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
        label="Rules the registrar can’t take — held back"
        tone="text-amber-600 dark:text-amber-400"
        items={held.map((h) => ({ name: h.domain.domainName, note: h.reason }))}
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
