import { useMemo, useState } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { toAscii } from '../../../shared/domain-name';
import type { Domain } from '../../../shared/ipc';
import type {
  MarketAccountView,
  MarketBulkJob,
  MarketWriteResult,
} from '../../../shared/markets';
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

// List, reprice or delist names on market accounts, from a row or
// the bulk bar (docs/markets.md). Listing pushes the asking prices you set in
// DomBot (BIN price, minimum offer, floor), so DomBot stays where you price,
// to every market account you tick at once; a listing that was stuck also
// gets the market's checks re-run (Afternic's relist). Delisting works the
// same way, starting from the markets that list the names.

export type MarketAction = 'list' | 'delist';

/**
 * More names than this on a market that writes one name per call (Atom) run
 * as a market bulk job, with progress, instead of one long request.
 */
const DIRECT_NAMES = 10;

/** A finished job's outcomes, in the shape the results view shows. */
function jobResults(job: MarketBulkJob): MarketWriteResult[] {
  return job.results.map((r) => ({
    name: r.name,
    ok: r.status === 'ok' || r.status === 'skipped',
    pending: r.pending,
    saved: null,
    adjusted: r.adjusted,
    error:
      r.status === 'ok' || r.status === 'skipped'
        ? null
        : { code: r.code ?? r.status, message: r.message || r.status },
  }));
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const names = (n: number) => `${n.toLocaleString()} name${n === 1 ? '' : 's'}`;

/** How a market's adjusted fields are named to people. */
export const FIELD_LABEL: Record<string, string> = {
  price: 'BIN price',
  minOffer: 'minimum offer',
  floor: 'floor',
  forSale: 'shown to buyers',
  'leaseToOwn.enabled': 'lease-to-own',
  'leaseToOwn.maxPayments': 'lease-to-own payments',
};

export function MarketActionDialog({
  action,
  domains,
  onClose,
}: {
  action: MarketAction;
  domains: Domain[];
  onClose: () => void;
}) {
  const accounts = useAppStore((s) => s.marketAccounts) ?? [];
  const catalog = useAppStore((s) => s.marketCatalog);
  const listings = useAppStore((s) => s.marketListings);
  const listPrices = useAppStore((s) => s.listPrices);
  const loadMarkets = useAppStore((s) => s.loadMarkets);
  const enabled = accounts.filter((a) => a.enabled && a.configured);
  const [running, setRunning] = useState(false);
  const [job, setJob] = useState<MarketBulkJob | null>(null);
  const [perAccount, setPerAccount] = useState<
    | {
        account: MarketAccountView;
        results: MarketWriteResult[] | null;
        error: string | null;
      }[]
    | null
  >(null);

  const marketName = (a?: MarketAccountView) =>
    catalog.find((m) => m.id === a?.market)?.name ?? a?.market ?? 'the market';
  const whereOf = (a?: MarketAccountView) =>
    a
      ? enabled.filter((b) => b.market === a.market).length > 1
        ? `${marketName(a)} (${a.label})`
        : marketName(a)
      : 'the market';

  const keys = useMemo(
    () => [...new Set(domains.map((d) => toAscii(d.domainName)))],
    [domains],
  );
  const priced = keys.filter(
    (k) => listPrices[k]?.amount || listPrices[k]?.minOffer,
  );
  // What each account would act on: every priced name for a listing, the
  // names it lists for a delist.
  const targetsFor = (a: MarketAccountView) =>
    action === 'list'
      ? priced
      : keys.filter((k) => listings[k]?.some((l) => l.accountId === a.id));

  // Listing goes to every market; delisting starts from the markets that
  // list any of these names. Either way you can untick some.
  const [ticked, setTicked] = useState<Set<string>>(
    () =>
      new Set(
        enabled
          .filter((a) => action === 'list' || targetsFor(a).length > 0)
          .map((a) => a.id),
      ),
  );
  const chosen = enabled.filter((a) => ticked.has(a.id));
  const targets = [...new Set(chosen.flatMap(targetsFor))];
  const only = enabled.length === 1 ? enabled[0] : undefined;

  /** Whether the write to `a` runs as a market bulk job (Atom-like). */
  const jobFor = (a: MarketAccountView) =>
    targetsFor(a).length > DIRECT_NAMES &&
    catalog.find((m) => m.id === a.market)?.capabilities.writeBatch === 1;
  const jobAccounts = chosen.filter(jobFor);

  /** Start a market bulk job and follow it to the end. */
  const runJob = async (
    id: string,
    kind: 'pushAskingPrices' | 'delete',
    names: string[],
  ): Promise<MarketWriteResult[]> => {
    let current = await window.api.startMarketBulk(
      names.map((name) => ({ accountId: id, name })),
      { kind },
    );
    setJob(current);
    while (current.status === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      current = (await window.api.advanceMarketBulk()) ?? current;
      setJob(current);
    }
    return jobResults(current);
  };

  const run = async () => {
    setRunning(true);
    // One account at a time: each has its own rate limit and its own reasons
    // to refuse a name, so one market failing doesn't stop the rest. A market
    // that writes one name per call (Atom) runs as a market bulk job.
    const out: NonNullable<typeof perAccount> = [];
    for (const a of chosen) {
      const names = targetsFor(a);
      if (!names.length) continue;
      try {
        out.push({
          account: a,
          results: jobFor(a)
            ? await runJob(
                a.id,
                action === 'list' ? 'pushAskingPrices' : 'delete',
                names,
              )
            : action === 'list'
              ? await window.api.pushMarketPrices(a.id, names)
              : await window.api.deleteMarketListings(a.id, names),
          error: null,
        });
      } catch (err) {
        out.push({ account: a, results: null, error: errorMessage(err) });
      }
    }
    setPerAccount(out);
    await loadMarkets().catch(() => {});
    setRunning(false);
  };

  const done = perAccount !== null;
  const title =
    action === 'list'
      ? only
        ? `List on ${whereOf(only)} at your prices`
        : 'List at your prices'
      : only
        ? `Delist from ${whereOf(only)}`
        : 'Delist';
  const markets = (n: number) => `${n} market${n === 1 ? '' : 's'}`;

  return (
    <Dialog open onOpenChange={(open) => !open && !running && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {!done && (
            <DialogDescription>
              {action === 'list' &&
                'Lists each name, or updates its listing, with the BIN price, minimum offer and floor you set in DomBot. Listings you already have keep their other settings, and any that are inactive, rejected or stuck pending get the market’s checks re-run.'}
              {action === 'delist' &&
                'Takes the listings down. The names stay in your registrar accounts, and you can list them again later.'}
            </DialogDescription>
          )}
        </DialogHeader>

        {!done ? (
          <div className="flex flex-col gap-4 text-sm">
            {!only && (
              <Field>
                <FieldLabel>Markets</FieldLabel>
                <div className="flex flex-col gap-2">
                  {enabled.map((a) => {
                    const n = targetsFor(a).length;
                    return (
                      <label
                        key={a.id}
                        className="flex cursor-pointer items-center gap-2.5"
                      >
                        <Checkbox
                          checked={ticked.has(a.id)}
                          onCheckedChange={(on) =>
                            setTicked((current) => {
                              const next = new Set(current);
                              if (on === true) next.add(a.id);
                              else next.delete(a.id);
                              return next;
                            })
                          }
                        />
                        <MarketLogo
                          market={a.market}
                          label={marketName(a)}
                          className="size-5 text-muted-foreground"
                        />
                        {whereOf(a)}
                        {action === 'delist' && (
                          <span className="text-muted-foreground">
                            {n ? `${names(n)} listed` : 'none listed'}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </Field>
            )}
            <p>
              {targets.length
                ? `${names(targets.length)} will be ${
                    action === 'list' ? 'listed or updated' : 'delisted'
                  }.`
                : 'Nothing to do for this selection.'}
              {action === 'list' && keys.length > priced.length && (
                <span className="text-muted-foreground">
                  {' '}
                  {names(keys.length - priced.length)} without an asking price
                  in DomBot will be skipped; set one with Pricing first.
                </span>
              )}
              {action === 'delist' && keys.length > targets.length && (
                <span className="text-muted-foreground">
                  {' '}
                  {names(keys.length - targets.length)} not listed on the ticked
                  markets will be skipped.
                </span>
              )}
            </p>
            {jobAccounts.length > 0 && !job && (
              <p className="text-muted-foreground">
                {jobAccounts.map(whereOf).join(' and ')}{' '}
                {jobAccounts.length === 1 ? 'takes' : 'take'} one name at a
                time, so {jobAccounts.length === 1 ? 'it runs' : 'they run'} in
                the background, about a name a second.
              </p>
            )}
            {job && job.status === 'running' && (
              <p aria-live="polite">
                {job.results.length.toLocaleString()} of{' '}
                {job.total.toLocaleString()} done
                {job.counts.skipped > 0 &&
                  ` (${job.counts.skipped.toLocaleString()} already up to date)`}
                …
              </p>
            )}
          </div>
        ) : (
          <div className="flex max-h-[50vh] flex-col gap-5 overflow-y-auto">
            {perAccount.map(({ account: a, results: rs, error: err }) => (
              <section key={a.id} className="flex flex-col gap-2">
                {!only && (
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <MarketLogo
                      market={a.market}
                      label={marketName(a)}
                      className="size-5 text-muted-foreground"
                    />
                    {whereOf(a)}
                  </h3>
                )}
                {err ? (
                  <p role="alert" className="text-sm text-destructive">
                    {err}
                  </p>
                ) : (
                  <Results results={rs!} action={action} where={whereOf(a)} />
                )}
              </section>
            ))}
          </div>
        )}

        <DialogFooter>
          {done ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              {job?.status === 'running' ? (
                <Button
                  variant="ghost"
                  onClick={() => void window.api.cancelMarketBulk(job.id)}
                >
                  Stop
                </Button>
              ) : (
                <Button variant="ghost" disabled={running} onClick={onClose}>
                  Cancel
                </Button>
              )}
              <Button
                variant={action === 'delist' ? 'destructive' : 'default'}
                disabled={running || targets.length === 0}
                onClick={() => void run()}
              >
                {running
                  ? 'Working…'
                  : `${action === 'list' ? 'List' : 'Delist'} ${names(
                      targets.length,
                    )}${
                      chosen.length > 1
                        ? ` ${action === 'list' ? 'on' : 'from'} ${markets(chosen.length)}`
                        : ''
                    }`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Results({
  results,
  action,
  where,
}: {
  results: MarketWriteResult[];
  action: MarketAction;
  where: string;
}) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const adjusted = ok.filter((r) => r.adjusted.length);
  const pending = ok.filter((r) => r.pending);
  const relisted = ok.filter((r) => r.relisted?.ok);
  const relistFailed = ok.filter((r) => r.relisted && !r.relisted.ok);
  return (
    <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto text-sm">
      <p className="flex items-center gap-2">
        <CircleCheck className="size-4 text-brand" />
        {names(ok.length)}{' '}
        {action === 'list' ? 'listed or updated' : `${action}ed`} on {where}.
      </p>
      {relisted.length > 0 && (
        <p className="text-muted-foreground">
          {names(relisted.length)} had a stuck listing, so {where} is re-running
          its checks: {relisted.map((r) => r.name).join(', ')}.
        </p>
      )}
      {relistFailed.length > 0 && (
        <div>
          <p className="font-medium">
            Prices saved, but {where} couldn&apos;t re-run its checks:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {relistFailed.map((r) => (
              <li key={r.name}>
                {r.name}: {r.relisted?.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {pending.length > 0 && (
        <p className="text-muted-foreground">
          {names(pending.length)} pending. {where} lists a name once it can
          verify you own it: point its nameservers at {where}&apos;s, or verify
          it there.
        </p>
      )}
      {adjusted.length > 0 && (
        <div>
          <p className="font-medium">Saved differently by {where}:</p>
          <ul className="mt-1 list-disc pl-5">
            {adjusted.map((r) => (
              <li key={r.name}>
                {r.name}:{' '}
                {r.adjusted
                  .map(
                    (a) =>
                      `${FIELD_LABEL[a.field] ?? a.field} ${String(a.saved ?? 'none')} (asked ${String(a.asked ?? 'none')})`,
                  )
                  .join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {failed.length > 0 && (
        <div>
          <p className="flex items-center gap-2 font-medium text-destructive">
            <CircleAlert className="size-4" />
            {names(failed.length)} failed
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
