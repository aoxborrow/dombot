import { useMemo, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { domainKey } from '../../../shared/account-key';
import { toAscii } from '../../../shared/domain-name';
import type { Domain, DomainOp, DomainTarget } from '../../../shared/ipc';
import type {
  MarketAccountView,
  MarketWriteResult,
} from '../../../shared/markets';
import { bucketSelection } from '../../lib/bulk';
import {
  recheckAccounts,
  txtAccounts,
  txtValueOf,
} from '../../lib/ownership-verification';
import { useAppStore } from '../../store/app';
import { MarketLogo } from '../RegistrarLogo';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';

// Ownership verification on selected names (docs/markets.md, "Ownership
// verification"), as two actions kept apart. Ownership verification TXT…
// adds the selected market accounts' TXT records at the names' registrars,
// in one bulk job; the markets aren't contacted. Recheck ownership… asks
// the selected markets to check the names they list, and changes no DNS.
// Nameservers are the nameserver editor's job (its market presets).

export type VerificationAction = 'verificationTxt' | 'recheckOwnership';

const names = (n: number) => `${n.toLocaleString()} name${n === 1 ? '' : 's'}`;
const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+':\s*(Error:\s*)?/,
    '',
  );

/** How each account reads: the market, and its name when there are several. */
function useAccountNames(accounts: readonly MarketAccountView[]) {
  const catalog = useAppStore((s) => s.marketCatalog);
  const nameOf = (a: MarketAccountView) =>
    catalog.find((m) => m.id === a.market)?.name ?? a.market;
  const whereOf = (a: MarketAccountView) =>
    accounts.filter((b) => b.market === a.market).length > 1
      ? `${nameOf(a)} (${a.label})`
      : nameOf(a);
  return { nameOf, whereOf };
}

function useTicks(initial: () => string[]) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(initial()));
  const onTick = (id: string, on: boolean) =>
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return [ticked, onTick] as const;
}

/** The account checkboxes both dialogs share. */
function AccountChecks({
  accounts,
  ticked,
  onTick,
  detail,
}: {
  accounts: MarketAccountView[];
  ticked: Set<string>;
  onTick: (id: string, on: boolean) => void;
  detail: (a: MarketAccountView) => ReactNode;
}) {
  const { nameOf, whereOf } = useAccountNames(accounts);
  return (
    <Field>
      <FieldLabel>Markets</FieldLabel>
      <div className="flex flex-col gap-2">
        {accounts.map((a) => (
          <label
            key={a.id}
            className="flex min-w-0 cursor-pointer items-center gap-2.5"
          >
            <Checkbox
              checked={ticked.has(a.id)}
              onCheckedChange={(on) => onTick(a.id, on === true)}
            />
            <MarketLogo
              market={a.market}
              label={nameOf(a)}
              className="size-5 shrink-0 text-muted-foreground"
            />
            <span className="shrink-0">{whereOf(a)}</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {detail(a)}
            </span>
          </label>
        ))}
      </div>
    </Field>
  );
}

/**
 * Ownership verification TXT…: every selected market account's TXT record,
 * added at the root of each selected name a registrar account holds, as one
 * bulk job (one write per name). Names whose DNS isn't at their registrar,
 * or that already have the records, are skipped. Accounts without an
 * Ownership Verification ID aren't offered.
 */
export function VerificationTxtDialog({
  domains,
  onClose,
  onStarted,
}: {
  /** The selected domains (merged rows). */
  domains: Domain[];
  onClose: () => void;
  /** The bulk job started: show it. */
  onStarted: (op: DomainOp, jobId: string) => void;
}) {
  const accounts = txtAccounts(useAppStore((s) => s.marketAccounts) ?? []);
  const registrars = useAppStore((s) => s.registrars);
  const enriched = useAppStore((s) => s.enriched);
  const bulk = useAppStore((s) => s.bulk);
  const startBulk = useAppStore((s) => s.startBulk);
  const [ticked, onTick] = useTicks(() => accounts.map((a) => a.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const held = useMemo(
    () => domains.filter((d) => !d.departed && d.source !== 'imported'),
    [domains],
  );
  const values = [
    ...new Set(accounts.filter((a) => ticked.has(a.id)).map(txtValueOf)),
  ];
  const op: DomainOp | null = values.length
    ? { kind: 'txtRecords', values }
    : null;
  const buckets = op
    ? bucketSelection(held, op, registrars, (d) => domainKey(d) in enriched)
    : null;
  const n = buckets?.eligible.length ?? 0;
  const anotherRunning = bulk?.status === 'running';

  const start = async () => {
    if (!op || !buckets?.eligible.length) return;
    setBusy(true);
    setError(null);
    try {
      const targets: DomainTarget[] = buckets.eligible.map((d) => ({
        registrar: d.registrar as DomainTarget['registrar'],
        accountId: d.accountId,
        domainName: d.domainName,
      }));
      const job = await startBulk(targets, op);
      onStarted(op, job.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ownership verification TXT</DialogTitle>
          <DialogDescription>
            Adds the selected markets’ TXT records at the root of every name and
            keeps its other records. Names whose DNS isn’t at their registrar,
            or that already have the records, are skipped.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-sm">
          <AccountChecks
            accounts={accounts}
            ticked={ticked}
            onTick={onTick}
            detail={(a) => (
              <code className="font-mono text-xs">{txtValueOf(a)}</code>
            )}
          />
          <p>
            {n
              ? `${names(n)} will have ${values.length === 1 ? 'a TXT record' : `${values.length} TXT records`} added.`
              : 'Nothing to do.'}
            {domains.length > held.length && (
              <span className="text-muted-foreground">
                {' '}
                {names(domains.length - held.length)} no registrar account holds
                will be skipped.
              </span>
            )}
            {buckets && buckets.unsupported.length > 0 && (
              <span className="text-muted-foreground">
                {' '}
                {names(buckets.unsupported.length)} can’t:{' '}
                {[...new Set(buckets.unsupported.map((u) => u.reason))].join(
                  ' ',
                )}
              </span>
            )}
          </p>
          {anotherRunning && (
            <p className="text-muted-foreground">
              Another bulk action is running; wait for it to finish.
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || n === 0 || anotherRunning}
            onClick={() => void start()}
          >
            {busy ? 'Starting…' : `Add TXT records to ${names(n)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Recheck ownership…: asks each selected market account to check the
 * selected names it lists, now. Afternic relists them (`RESYNC`); Atom
 * checks DNS one name at a time until it says a check is in progress.
 * Markets that check on their own (Sedo) aren't offered. Changes no DNS.
 */
export function RecheckOwnershipDialog({
  domains,
  onClose,
}: {
  domains: Domain[];
  onClose: () => void;
}) {
  const catalog = useAppStore((s) => s.marketCatalog);
  const accounts = recheckAccounts(
    useAppStore((s) => s.marketAccounts) ?? [],
    catalog,
  );
  const listings = useAppStore((s) => s.marketListings);
  const loadMarkets = useAppStore((s) => s.loadMarkets);
  const { nameOf, whereOf } = useAccountNames(accounts);
  const keys = useMemo(
    () => [...new Set(domains.map((d) => toAscii(d.domainName)))],
    [domains],
  );
  const listedOn = (a: MarketAccountView) =>
    keys.filter((k) => listings[k]?.some((l) => l.accountId === a.id));
  // Starts from the markets that list any of these names.
  const [ticked, onTick] = useTicks(() =>
    accounts.filter((a) => listedOn(a).length > 0).map((a) => a.id),
  );
  const chosen = accounts.filter(
    (a) => ticked.has(a.id) && listedOn(a).length > 0,
  );
  const total = new Set(chosen.flatMap(listedOn)).size;
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<
    | {
        account: MarketAccountView;
        results: MarketWriteResult[] | null;
        error: string | null;
      }[]
    | null
  >(null);

  const run = async () => {
    setBusy(true);
    // One account at a time: each market has its own limits and answers.
    const out: NonNullable<typeof results> = [];
    for (const a of chosen) {
      try {
        out.push({
          account: a,
          results: await window.api.requestMarketVerification(
            a.id,
            listedOn(a),
          ),
          error: null,
        });
      } catch (err) {
        out.push({ account: a, results: null, error: errorMessage(err) });
      }
    }
    setResults(out);
    await loadMarkets().catch(() => {});
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Recheck ownership</DialogTitle>
          {!results && (
            <DialogDescription>
              Asks the selected markets to check the names’ TXT records or
              nameservers for your ownership verification now. Afternic relists
              them; Atom checks once per account every 12 hours. Nothing in DNS
              changes.
            </DialogDescription>
          )}
        </DialogHeader>
        {results ? (
          <div className="flex max-h-[50vh] flex-col gap-5 overflow-y-auto text-sm">
            {results.map(({ account: a, results: rs, error: err }) => (
              <section key={a.id} className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 font-medium">
                  <MarketLogo
                    market={a.market}
                    label={nameOf(a)}
                    className="size-5 text-muted-foreground"
                  />
                  {whereOf(a)}
                </h3>
                {err ? (
                  <p role="alert" className="text-destructive">
                    {err}
                  </p>
                ) : (
                  <RecheckResults results={rs!} where={whereOf(a)} />
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <AccountChecks
              accounts={accounts}
              ticked={ticked}
              onTick={onTick}
              detail={(a) =>
                listedOn(a).length
                  ? `${names(listedOn(a).length)} listed`
                  : 'none listed'
              }
            />
            <p>
              {total
                ? `${names(total)} will be rechecked.`
                : 'None of these are listed on the selected markets.'}
            </p>
          </div>
        )}
        <DialogFooter>
          {results ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={busy || total === 0} onClick={() => void run()}>
                {busy ? 'Rechecking…' : `Recheck ${names(total)}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecheckResults({
  results,
  where,
}: {
  results: MarketWriteResult[];
  where: string;
}) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  return (
    <div className="flex flex-col gap-2">
      {ok.length > 0 && (
        <p className="flex items-center gap-2">
          <CircleCheck className="size-4 text-brand" />
          {where} is rechecking {names(ok.length)}. A listing stays pending
          until it has.
        </p>
      )}
      {failed.length > 0 && (
        <div>
          <p className="flex items-center gap-2 font-medium text-destructive">
            <CircleAlert className="size-4" />
            {names(failed.length)} not rechecked
          </p>
          <ul className="mt-1 list-disc pl-5">
            {failed.map((r) => (
              <li key={r.name}>
                {r.name}: {r.error?.message ?? 'Failed'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
