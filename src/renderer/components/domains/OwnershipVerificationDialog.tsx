import { useMemo, useState } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { domainKey } from '../../../shared/account-key';
import { toAscii } from '../../../shared/domain-name';
import type { Domain, DomainOp, DomainTarget } from '../../../shared/ipc';
import type {
  MarketAccountView,
  MarketWriteResult,
} from '../../../shared/markets';
import {
  VERIFICATION_METHODS,
  verificationMethodLabel,
  verificationNameservers,
  verificationTxt,
  type VerificationMethod,
} from '../../../shared/market-verification';
import { bucketSelection } from '../../lib/bulk';
import { useAppStore } from '../../store/app';
import { MarketLogo } from '../RegistrarLogo';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Apply and Request ownership verification on selected names (docs/markets.md,
// "Ownership verification"): two different actions, kept apart. Apply is
// DomBot's own change to the names' DNS at their registrars (a TXT record, or
// the market's nameservers), run as a bulk job; the market isn't contacted.
// Request asks the market to run its own check on names listed there, and
// changes no DNS.

export type VerificationAction = 'applyVerification' | 'requestVerification';

const names = (n: number) => `${n.toLocaleString()} name${n === 1 ? '' : 's'}`;
const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+':\s*(Error:\s*)?/,
    '',
  );

export function OwnershipVerificationDialog({
  action,
  domains,
  onClose,
  onStarted,
}: {
  action: VerificationAction;
  /** The selected domains (merged rows). */
  domains: Domain[];
  onClose: () => void;
  /** Apply started its bulk job: show it. */
  onStarted: (op: DomainOp, jobId: string) => void;
}) {
  const apply = action === 'applyVerification';
  const accounts = useAppStore((s) => s.marketAccounts) ?? [];
  const catalog = useAppStore((s) => s.marketCatalog);
  const listings = useAppStore((s) => s.marketListings);
  const registrars = useAppStore((s) => s.registrars);
  const enriched = useAppStore((s) => s.enriched);
  const bulk = useAppStore((s) => s.bulk);
  const startBulk = useAppStore((s) => s.startBulk);
  const loadMarkets = useAppStore((s) => s.loadMarkets);

  // Apply changes DNS only, so any enabled account will do; Request calls
  // the market, so it needs the account's key.
  const usable = accounts.filter((a) => a.enabled && (apply || a.configured));
  const infoOf = (a: MarketAccountView) =>
    catalog.find((m) => m.id === a.market);
  const nameOf = (a: MarketAccountView) => infoOf(a)?.name ?? a.market;
  const whereOf = (a: MarketAccountView) =>
    usable.filter((b) => b.market === a.market).length > 1
      ? `${nameOf(a)} (${a.label})`
      : nameOf(a);
  const canRequest = (a: MarketAccountView) => {
    const caps = infoOf(a)?.capabilities;
    return !!caps && (caps.relist || caps.verifyDns);
  };

  // Apply works on names a registrar account holds; Request on the ones
  // listed on the chosen account.
  const held = useMemo(
    () => domains.filter((d) => !d.departed && d.source !== 'imported'),
    [domains],
  );
  const keys = useMemo(
    () => [...new Set(domains.map((d) => toAscii(d.domainName)))],
    [domains],
  );
  const listedOn = (a: MarketAccountView) =>
    keys.filter((k) => listings[k]?.some((l) => l.accountId === a.id));

  const [accountId, setAccountId] = useState(
    () =>
      (apply
        ? usable[0]
        : (usable.find((a) => canRequest(a) && listedOn(a).length > 0) ??
          usable.find(canRequest) ??
          usable[0])
      )?.id ?? '',
  );
  const account = usable.find((a) => a.id === accountId);
  const info = account ? infoOf(account) : undefined;
  const where = account ? whereOf(account) : 'the market';
  const vid = account?.verification?.id ?? null;

  // The account's method first, but TXT needs its ID saved.
  const [chosen, setChosen] = useState<VerificationMethod | null>(null);
  const preferred = account?.verification?.method ?? 'txt';
  const method: VerificationMethod =
    chosen ?? (preferred === 'txt' && !vid ? 'nameservers' : preferred);

  const op: DomainOp | null = !info
    ? null
    : method === 'txt'
      ? vid
        ? { kind: 'txtRecord', value: verificationTxt(info.id, vid) }
        : null
      : {
          kind: 'nameservers',
          nameservers: verificationNameservers(info, vid),
        };
  const buckets = op
    ? bucketSelection(held, op, registrars, (d) => domainKey(d) in enriched)
    : null;

  const toRequest = account ? listedOn(account) : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<MarketWriteResult[] | null>(null);
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

  const request = async () => {
    if (!account || !toRequest.length) return;
    setBusy(true);
    setError(null);
    try {
      setResults(
        await window.api.requestMarketVerification(account.id, toRequest),
      );
      await loadMarkets().catch(() => {});
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const title = apply
    ? 'Apply ownership verification'
    : 'Request ownership verification';
  const n = apply ? (buckets?.eligible.length ?? 0) : toRequest.length;
  const requestReason =
    account && !canRequest(account)
      ? `${nameOf(account)} has no way to ask for a check; it checks names on its own.`
      : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {!results && (
            <DialogDescription>
              {apply
                ? `Changes each name’s DNS at its registrar so ${where} can verify you own it. ${where} isn’t contacted.`
                : `Asks ${where} to check the names listed there now. Nothing in DNS changes.`}
            </DialogDescription>
          )}
        </DialogHeader>

        {results ? (
          <Results results={results} where={where} />
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            {usable.length > 1 && (
              <Field>
                <FieldLabel>Market account</FieldLabel>
                <Select
                  value={accountId}
                  onValueChange={(id) => {
                    setAccountId(id);
                    setChosen(null);
                  }}
                >
                  <SelectTrigger aria-label="Market account" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {usable.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <MarketLogo
                          market={a.market}
                          label={nameOf(a)}
                          className="size-4 text-muted-foreground"
                        />
                        {whereOf(a)}
                        {!apply && (
                          <span className="text-muted-foreground">
                            {listedOn(a).length
                              ? `${names(listedOn(a).length)} listed`
                              : 'none listed'}
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {apply && info && (
              <>
                <Field>
                  <FieldLabel>Method</FieldLabel>
                  <SegmentedControl
                    aria-label="Method"
                    value={method}
                    onChange={setChosen}
                    options={VERIFICATION_METHODS.map((m) => ({
                      value: m,
                      label: verificationMethodLabel(m, info.name),
                    }))}
                  />
                </Field>
                <p>
                  {method === 'txt' ? (
                    vid ? (
                      <>
                        Adds the TXT record{' '}
                        <code className="break-all">
                          {verificationTxt(info.id, vid)}
                        </code>{' '}
                        at each name’s root and keeps its other records. Names
                        whose DNS isn’t at their registrar, or that already have
                        the record, are skipped.
                      </>
                    ) : (
                      <span className="text-destructive">
                        Save this account’s Ownership Verification ID in
                        Settings → Markets first.
                      </span>
                    )
                  ) : (
                    <>
                      Sets each name’s nameservers to{' '}
                      {verificationNameservers(info, vid).join(', ')}
                      {info.id === 'afternic' &&
                        (vid
                          ? ', Afternic’s pair with your account’s NS3'
                          : '. Save your Ownership Verification ID to add Afternic’s NS3 with them')}
                      . Any website or email on these names stops working.
                    </>
                  )}
                </p>
                {buckets && (
                  <p>
                    {buckets.eligible.length
                      ? `${names(buckets.eligible.length)} will be changed.`
                      : 'Nothing to change for this selection.'}
                    {domains.length > held.length && (
                      <span className="text-muted-foreground">
                        {' '}
                        {names(domains.length - held.length)} no registrar
                        account holds will be skipped.
                      </span>
                    )}
                    {buckets.unsupported.length > 0 && (
                      <span className="text-muted-foreground">
                        {' '}
                        {names(buckets.unsupported.length)} can’t:{' '}
                        {[
                          ...new Set(buckets.unsupported.map((u) => u.reason)),
                        ].join(' ')}
                      </span>
                    )}
                  </p>
                )}
                {anotherRunning && (
                  <p className="text-muted-foreground">
                    Another bulk action is running; wait for it to finish.
                  </p>
                )}
              </>
            )}

            {!apply && account && (
              <p>
                {requestReason ?? (
                  <>
                    {toRequest.length
                      ? `${names(toRequest.length)} listed on ${where}.`
                      : `None of these are listed on ${where}.`}
                    {keys.length > toRequest.length && toRequest.length > 0 && (
                      <span className="text-muted-foreground">
                        {' '}
                        {names(keys.length - toRequest.length)} not listed there
                        will be skipped.
                      </span>
                    )}{' '}
                    <span className="text-muted-foreground">
                      {infoOf(account)?.capabilities.relist
                        ? `${where} relists them, which re-runs its checks.`
                        : `${where} takes one request per account every 12 hours, so names go one at a time until it says a check is in progress.`}
                    </span>
                  </>
                )}
              </p>
            )}

            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {results ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              {apply ? (
                <Button
                  variant={method === 'nameservers' ? 'destructive' : 'default'}
                  disabled={busy || !op || n === 0 || anotherRunning}
                  onClick={() => void start()}
                >
                  {busy
                    ? 'Starting…'
                    : method === 'txt'
                      ? `Add TXT record to ${names(n)}`
                      : `Change nameservers on ${names(n)}`}
                </Button>
              ) : (
                <Button
                  disabled={busy || n === 0 || requestReason !== null}
                  onClick={() => void request()}
                >
                  {busy ? 'Requesting…' : `Request for ${names(n)}`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Results({
  results,
  where,
}: {
  results: MarketWriteResult[];
  where: string;
}) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  return (
    <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto text-sm">
      {ok.length > 0 && (
        <p className="flex items-center gap-2">
          <CircleCheck className="size-4 text-brand" />
          Asked {where} to check {names(ok.length)}. A listing stays pending
          until it has.
        </p>
      )}
      {failed.length > 0 && (
        <div>
          <p className="flex items-center gap-2 font-medium text-destructive">
            <CircleAlert className="size-4" />
            {names(failed.length)} not requested
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
