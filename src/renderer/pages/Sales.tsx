import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAppStore } from '../store/app';
import {
  saleRows,
  filterSales,
  salesSummary,
  groupedSales,
  openingCohort,
  type SaleRow,
} from '../lib/sales-analytics';
import {
  salesDetailsSchema,
  type SalesDetails,
} from '../../shared/sales-details';
import { toCsv } from '../../shared/csv';
import { localDay } from '../../shared/domain-events';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const money = (value: number | null, currency: string | null) =>
  value === null || !currency
    ? 'Unknown'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
        value,
      );
const selectClass = 'h-9 rounded-md border bg-background px-3 text-sm';

export default function Sales() {
  const events = useAppStore((s) => s.domainEvents);
  const folders = useAppStore((s) => s.folders);
  const assignments = useAppStore((s) => s.folderAssignments);
  const registrars = useAppStore((s) => s.registrars);
  const [details, setDetails] = useState<Record<string, SalesDetails>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [currency, setCurrency] = useState('all');
  const [group, setGroup] = useState<
    'marketplace' | 'registrar' | 'folder' | 'tld'
  >('marketplace');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<SaleRow | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    window.api
      .getSalesDetails()
      .then((value) => {
        if (active) setDetails(value);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : 'Could not load sales details',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [events, reload]);
  const all = useMemo(
    () =>
      saleRows(events, {
        details,
        folders: Object.fromEntries(
          Object.entries(assignments).map(([name, id]) => [
            name,
            folders.find((f) => f.id === id)?.name ?? 'Ungrouped',
          ]),
        ),
        registrars: Object.fromEntries(
          (registrars ?? []).map((r) => [r.accountId ?? r.name, r.displayName]),
        ),
      }),
    [events, details, assignments, folders, registrars],
  );
  const rows = useMemo(
    () =>
      filterSales(all, { from, to, currency }).sort(
        (a, b) =>
          (b.event.date ?? '').localeCompare(a.event.date ?? '') ||
          a.event.id.localeCompare(b.event.id),
      ),
    [all, from, to, currency],
  );
  const currencies = [
    ...new Set(all.flatMap((r) => (r.currency ? [r.currency] : []))),
  ].sort();
  const buckets = [
    ...new Set(rows.flatMap((r) => (r.currency ? [r.currency] : []))),
  ].sort();
  const months = groupedSales(rows, 'month');
  const groups = groupedSales(rows, group);
  const cohort = openingCohort(events, from, to);
  const totalPages = Math.max(1, Math.ceil(rows.length / 50));
  const currentPage = Math.min(page, totalPages - 1);
  const undated = all.filter((r) => !r.event.date).length;
  const invalid = !!from && !!to && from > to;
  function setRange(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    setPage(0);
  }
  async function exportSales() {
    try {
      const csv = toCsv([
        [
          'Domain',
          'Sale date',
          'Currency',
          'Gross sale value',
          'Confirmed receipts',
          'Net receipts',
          'Realized profit',
          'Payment status',
          'Marketplace',
          'Registrar',
          'Current folder',
          'Holding days',
        ],
        ...rows.map((r) => [
          r.event.domain,
          r.event.date ?? '',
          r.currency ?? '',
          r.gross?.toString() ?? '',
          r.received?.toString() ?? '',
          r.net?.toString() ?? '',
          r.profit?.toString() ?? '',
          r.payment,
          r.marketplace,
          r.registrar,
          r.folder,
          r.holdingDays?.toString() ?? '',
        ]),
      ]);
      await window.api.saveTextFile(csv, `dombot-sales-${localDay()}.csv`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    }
  }
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1400px] flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sales</h1>
          <p className="text-sm text-muted-foreground">
            Recorded sales, confirmed receipts, and returns by currency.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={exportSales}
          disabled={loading || !!error || invalid || !rows.length}
        >
          Export sales CSV
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          From
          <Input
            aria-label="Sales from"
            type="date"
            value={from}
            onChange={(e) => setRange(e.target.value, to)}
          />
        </label>
        <label className="space-y-1 text-sm">
          To
          <Input
            aria-label="Sales to"
            type="date"
            value={to}
            onChange={(e) => setRange(from, e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Currency
          <select
            aria-label="Sales currency"
            className={selectClass}
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All currencies</option>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
            <option value="unknown">Unknown currency</option>
          </select>
        </label>
        <Button
          variant="outline"
          onClick={() =>
            setRange(`${new Date().getFullYear()}-01-01`, localDay())
          }
        >
          This year
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setRange('', '');
            setCurrency('all');
          }}
        >
          All time
        </Button>
      </div>
      {invalid ? (
        <p role="alert">From must be on or before To.</p>
      ) : loading ? (
        <p role="status">Loading sales…</p>
      ) : error ? (
        <div role="alert">
          {error} <Button onClick={() => setReload((n) => n + 1)}>Retry</Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {rows.length} sale records
            {(from || to) && undated
              ? ` · ${undated} undated sales excluded by date filter`
              : ''}
            . Gross sale value includes contract totals; it is not cash
            received.
          </p>
          {!rows.length && (
            <div className="rounded-lg border border-dashed p-8">
              <h2 className="font-semibold">No sales match this view</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Record a sale from Domains or Activity, or change the date and
                currency filters.
              </p>
            </div>
          )}
          {buckets.map((c) => {
            const subset = rows.filter((r) => r.currency === c);
            const s = salesSummary(subset);
            return (
              <section key={c} className="rounded-lg border p-4">
                <h2 className="mb-3 text-lg font-semibold">
                  {c} · {s.count} sales
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric
                    label="Gross sale value"
                    value={money(s.grossCount ? s.gross : null, c)}
                    detail={`${s.grossCount}/${s.count} amounts known`}
                  />
                  <Metric
                    label="Confirmed receipts"
                    value={s.receivedCount ? money(s.received, c) : 'Unknown'}
                    detail={`${s.receivedCount}/${s.count} receipts reviewed`}
                  />
                  <Metric
                    label="Net receipts"
                    value={s.netCount ? money(s.net, c) : 'Unknown'}
                    detail={`${s.netCount}/${s.count} receipts and fees known`}
                  />
                  <Metric
                    label="Realized profit"
                    value={s.profitCount ? money(s.profit, c) : 'Unknown'}
                    detail={`${s.profitCount}/${s.count} fully paid with complete costs`}
                  />
                  <Metric
                    label="Average sale price"
                    value={money(s.average, c)}
                    detail="Known gross amounts only"
                  />
                  <Metric
                    label="Realized ROI"
                    value={s.roi === null ? 'Unknown' : `${s.roi.toFixed(1)}%`}
                    detail="Profit ÷ acquisition and renewal costs; complete sales only"
                  />
                  <Metric
                    label="Average holding period"
                    value={
                      s.holdingDays === null
                        ? 'Unknown'
                        : `${Math.round(s.holdingDays)} days`
                    }
                    detail={`${s.holdingCount}/${s.count} with purchase and sale dates`}
                  />
                </div>
              </section>
            );
          })}
          {rows.some((r) => !r.currency) && (
            <p className="text-sm text-muted-foreground">
              {rows.filter((r) => !r.currency).length} sales lack a currency and
              are excluded from monetary totals.
            </p>
          )}
          <section className="rounded-lg border p-4">
            <h2 className="font-semibold">Opening-portfolio sell-through</h2>
            <p className="mt-2">
              {cohort?.rate != null
                ? `${cohort.rate.toFixed(1)}% · ${cohort.sold} sold out of ${cohort.opening} domains held at the start`
                : 'Choose From and To dates with a known opening portfolio.'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Unique domains sold in the period ÷ domains known to be held
              before From. Uses all currencies and dated ownership history,
              excludes acquisitions during the period, and is not annualized.
              Incomplete history limits coverage.
            </p>
          </section>
          {!!months.length && (
            <section className="rounded-lg border p-4">
              <h2 className="mb-3 font-semibold">Monthly sale value</h2>
              <p className="mb-3 text-sm text-muted-foreground">
                Grouped by sale date, including contract totals. Receipt totals
                belong to those sales, not payment dates. Bar lengths compare
                months within each currency.
              </p>
              <div className="max-h-80 space-y-3 overflow-auto">
                {months.map((m) => {
                  const max = Math.max(
                    1,
                    ...months
                      .filter((x) => x.currency === m.currency)
                      .map((x) => x.gross),
                  );
                  return (
                    <div
                      key={`${m.label}-${m.currency}`}
                      className="grid grid-cols-[7rem_1fr] items-center gap-3 text-sm"
                    >
                      <span>
                        {m.label}
                        <br />
                        <span className="text-muted-foreground">
                          {m.currency ?? 'Unknown'}
                        </span>
                      </span>
                      <div>
                        <div className="mb-1 flex justify-between gap-2">
                          <span>{m.count} sales</span>
                          <span>
                            {money(m.grossCount ? m.gross : null, m.currency)}
                          </span>
                        </div>
                        <div className="h-2 rounded bg-muted">
                          <div
                            className="h-2 rounded bg-primary"
                            style={{ width: `${(m.gross / max) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {!!rows.length && (
            <section className="rounded-lg border p-4">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="font-semibold">Breakdown</h2>
                <select
                  aria-label="Sales breakdown"
                  className={selectClass}
                  value={group}
                  onChange={(e) => setGroup(e.target.value as typeof group)}
                >
                  <option value="marketplace">Marketplace</option>
                  <option value="registrar">Registrar at sale</option>
                  <option value="folder">Current folder</option>
                  <option value="tld">TLD</option>
                </select>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      'Group',
                      'Currency',
                      'Sales',
                      'Gross value',
                      'Net receipts',
                      'Realized profit',
                    ].map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <TableRow key={`${g.label}-${g.currency}`}>
                      <TableCell>{g.label}</TableCell>
                      <TableCell>{g.currency ?? 'Unknown'}</TableCell>
                      <TableCell>{g.count}</TableCell>
                      <TableCell>
                        {money(g.grossCount ? g.gross : null, g.currency)}
                      </TableCell>
                      <TableCell>
                        {money(g.netCount ? g.net : null, g.currency)}{' '}
                        <span className="text-muted-foreground">
                          ({g.netCount}/{g.count})
                        </span>
                      </TableCell>
                      <TableCell>
                        {money(g.profitCount ? g.profit : null, g.currency)}{' '}
                        <span className="text-muted-foreground">
                          ({g.profitCount}/{g.count})
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
          {!!rows.length && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">Sale records</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      'Domain',
                      'Sold',
                      'Gross',
                      'Received',
                      'Net receipts',
                      'Realized profit',
                      'Payment',
                      '',
                    ].map((h, i) => (
                      <TableHead key={i}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows
                    .slice(currentPage * 50, (currentPage + 1) * 50)
                    .map((r) => (
                      <TableRow key={r.event.id}>
                        <TableCell>
                          <Link
                            className="font-mono hover:underline"
                            to={`/?q=${encodeURIComponent(r.event.domain)}`}
                          >
                            {r.event.domain}
                          </Link>
                        </TableCell>
                        <TableCell>{r.event.date ?? 'Unknown'}</TableCell>
                        <TableCell>{money(r.gross, r.currency)}</TableCell>
                        <TableCell>{money(r.received, r.currency)}</TableCell>
                        <TableCell>{money(r.net, r.currency)}</TableCell>
                        <TableCell>{money(r.profit, r.currency)}</TableCell>
                        <TableCell>{r.payment}</TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Review financials for ${r.event.domain} ${r.event.date ?? r.event.id}`}
                            disabled={!r.currency}
                            onClick={() => setEditing(r)}
                          >
                            Review financials
                          </Button>
                          {!r.currency && (
                            <span className="text-xs">
                              Add a sale amount and currency in Activity first.
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              <div className="mt-3 flex items-center justify-end gap-3 text-sm">
                <Button
                  variant="outline"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <span>
                  {currentPage + 1} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  disabled={currentPage + 1 >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </section>
          )}
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">
              How the numbers are calculated
            </summary>
            <p className="mt-2">
              Net receipts = confirmed gross receipts minus recorded fees.
              Realized profit = net receipts minus the acquisition price and
              reviewed total renewal costs, only for fully paid sales with
              complete costs in the sale currency. ROI uses those same sales.
              Blank values remain unknown; enter 0 only when confirmed.
              Estimated renewal prices are never treated as expenses.
              Installment receipts contribute to receipts and net receipts, but
              not realized profit. No exchange-rate conversion is applied.
              Folder breakdowns use current assignments; registrar breakdowns
              use the last recorded account at the sale. A buyback starts a new
              holding.
            </p>
          </details>
        </>
      )}
      {editing && (
        <FinancialsDialog
          key={editing.event.id}
          row={editing}
          existing={details[editing.event.id]}
          onClose={() => setEditing(null)}
          onSaved={(value) => {
            setDetails(value);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function FinancialsDialog({
  row,
  existing,
  onClose,
  onSaved,
}: {
  row: SaleRow;
  existing?: SalesDetails;
  onClose: () => void;
  onSaved: (value: Record<string, SalesDetails>) => void;
}) {
  const compatible = existing?.currency === row.currency ? existing : undefined;
  const [form, setForm] = useState<SalesDetails>(
    compatible ?? {
      currency: row.currency!,
      marketplace: '',
      payment: 'unconfirmed',
      received: null,
      fees: null,
      renewalCost: null,
    },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setError('');
    const parsed = salesDetailsSchema.safeParse(form);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      );
      return;
    }
    if (
      form.payment === 'paid' &&
      (row.gross === null ||
        form.received === null ||
        Number(form.received) !== row.gross)
    ) {
      setError(
        'Fully paid requires confirmed receipts equal to the recorded gross sale value. Correct the sale amount first if the agreed total changed.',
      );
      return;
    }
    setSaving(true);
    try {
      onSaved(await window.api.setSalesDetails(row.event.id, parsed.data));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review sale financials</DialogTitle>
          <DialogDescription>
            {row.event.domain} · {row.event.date ?? 'Unknown date'} ·{' '}
            {money(row.gross, row.currency)} gross. All amounts below are{' '}
            {row.currency}.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block space-y-1 text-sm">
            Marketplace
            <Input
              aria-label="Marketplace"
              maxLength={100}
              value={form.marketplace}
              onChange={(e) =>
                setForm({ ...form, marketplace: e.target.value })
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Payment status
            <select
              aria-label="Payment status"
              className={selectClass}
              value={form.payment}
              onChange={(e) =>
                setForm({
                  ...form,
                  payment: e.target.value as SalesDetails['payment'],
                })
              }
            >
              <option value="unconfirmed">Unconfirmed</option>
              <option value="paid">Fully paid</option>
              <option value="installments">
                Installments / partially paid
              </option>
            </select>
          </label>
          {(
            [
              ['received', 'Confirmed gross receipts'],
              ['fees', 'Total commissions and fees paid'],
              ['renewalCost', 'Total renewal costs for this holding'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block space-y-1 text-sm">
              {label}
              <Input
                aria-label={label}
                inputMode="decimal"
                placeholder="Unknown"
                value={form[key] ?? ''}
                onChange={(e) =>
                  setForm({ ...form, [key]: e.target.value.trim() || null })
                }
              />
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            Use decimal points, without currency symbols. Blank means unknown; 0
            means confirmed zero. Renewal events record{' '}
            {money(row.recordedRenewals, row.currency)} for this holding; review
            the full total before entering it. Receipts and fees are cumulative,
            not a payment schedule.
          </p>
          {existing && !compatible && (
            <p role="alert" className="text-sm text-destructive">
              The sale currency changed. Re-enter these amounts in the new
              currency.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save financials'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
