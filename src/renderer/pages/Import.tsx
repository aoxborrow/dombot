import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleAlert, FileUp, Info, Pencil, Upload } from 'lucide-react';
import { decodeText, toCsv } from '../../shared/csv';
import { domainsCsvTemplate } from '../../shared/domain-csv';
import { newEventId } from '../../shared/domain-events';
import {
  MAX_IMPORT_ROWS,
  buildRows,
  guessSetup,
  readTable,
  todayLocal,
  type BuiltRows,
  type ImportContext,
  type ImportSetup,
  type ImportTable,
} from '../../shared/domain-import';
import { IMPORT_FIELDS, type ImportField } from '../../shared/import-columns';
import type {
  ImportChange,
  ImportOutcome,
  ImportPlan,
  ImportRow,
} from '../../shared/ipc';
import { toUnicode } from '../../shared/domain-name';
import { DataTable, type DataColumn } from '../components/data-table/DataTable';
import { sortRows, type SortDir } from '../components/data-table/table-state';
import { CurrencyPicker } from '../components/domains/CurrencyPicker';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  formatAmountInput,
  formatMoney,
  parseLocalizedAmount,
} from '../../shared/money';
import { useAppStore } from '../store/app';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

// Import domains (docs/domain-import-export.md, "The Import domains dialog"):
// two tabs. Manual takes typed names plus an asking price and folder for all
// of them; CSV upload takes a file and matches its columns. Both then review
// every change before importing. Reading and matching happen here, so the
// file never leaves the device; the server previews and writes the
// normalized rows.

const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Rows per import request, under one import id (the Worker's write budget). */
const CHUNK = 2000;
const SKIP = '__skip__';
const NONE = '__none__';
const OTHER = '__other__';

type Step = 'choose' | 'match' | 'review' | 'done';
type Source = 'manual' | 'file';

/** What the Manual tab applies to every name it adds. */
interface ManualFields {
  names: string;
  amount: string;
  minOffer: string;
  floor: string;
  currency: string;
  folder: string;
}

/** Typed names, split on lines, commas, and spaces. */
const splitNames = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((n) => n.trim())
    .filter(Boolean);
type Filter = ImportOutcome['result'] | 'errors' | 'all';

const RESULT_LABEL: Record<ImportOutcome['result'], string> = {
  new: 'New',
  update: 'Updated',
  unchanged: 'Unchanged',
  history: 'Archive',
};

const RESULT_STYLE: Record<ImportOutcome['result'], string> = {
  new: 'border-sky-500/40 text-sky-600 dark:text-sky-400',
  update: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
  unchanged: 'border-border text-muted-foreground',
  history: 'border-purple-500/40 text-purple-600 dark:text-purple-400',
};

export default function Import() {
  const navigate = useNavigate();
  const settings = useAppStore((s) => s.settings);
  const registrars = useAppStore((s) => s.registrars);
  const folders = useAppStore((s) => s.folders);
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;

  const ctx: ImportContext = useMemo(() => {
    const byName = new Map<string, string>();
    for (const r of registrars ?? []) byName.set(r.name, r.displayName);
    return {
      preferredCurrency: preferred,
      numberFormat: settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT,
      registrars: [...byName].map(([id, displayName]) => ({ id, displayName })),
      today: todayLocal(),
    };
  }, [registrars, settings, preferred]);

  const [step, setStep] = useState<Step>('choose');
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<ImportTable | null>(null);
  const [setup, setSetup] = useState<ImportSetup | null>(null);
  const [built, setBuilt] = useState<BuiltRows | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [source, setSource] = useState<Source>('manual');
  const [manual, setManual] = useState<ManualFields>({
    names: '',
    amount: '',
    minOffer: '',
    floor: '',
    currency: preferred,
    folder: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{
    plan: ImportPlan;
    importId: string;
  } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function startOver() {
    setStep('choose');
    setResult(null);
    setPlan(null);
    setBuilt(null);
    setTable(null);
    setSetup(null);
    setFileName(null);
    setError(null);
    setManual((m) => ({ ...m, names: '' }));
  }

  // ── choose ────────────────────────────────────────────────────────────────

  async function preview(t: ImportTable, s: ImportSetup): Promise<boolean> {
    const rows = buildRows(t, s, ctx);
    if (rows.rows.length > MAX_IMPORT_ROWS) {
      setError(
        `The file has ${rows.rows.length.toLocaleString('en-US')} names. Import up to ${MAX_IMPORT_ROWS.toLocaleString('en-US')} at a time.`,
      );
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      setBuilt(rows);
      setPlan(
        rows.rows.length > 0
          ? await window.api.previewDomainImport(rows.rows)
          : {
              outcomes: [],
              counts: { new: 0, update: 0, unchanged: 0, history: 0 },
              newFolders: [],
            },
      );
      setFilter('all');
      setStep('review');
      return true;
    } catch (err) {
      setError(message(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function open(text: string, name: string) {
    setError(null);
    const t = readTable(text);
    if (t.rows.length === 0) {
      setError('There are no rows in it.');
      return;
    }
    const s = guessSetup(t, ctx);
    setSource('file');
    setFileName(name);
    setTable(t);
    setSetup(s);
    // DomBot's own export needs no matching.
    if (s.format?.exact) await preview(t, s);
    else setStep('match');
  }

  /**
   * The Manual tab as a table DomBot's import reads: one row per name, with
   * the same asking price and folder on each.
   */
  async function addManual() {
    setError(null);
    const formatId = settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
    let amount: string | null;
    let minOffer: string | null;
    let floor: string | null;
    try {
      amount = parseLocalizedAmount(
        manual.amount,
        manual.currency,
        formatId,
        'Asking price',
      );
      minOffer = parseLocalizedAmount(
        manual.minOffer,
        manual.currency,
        formatId,
        'Minimum offer',
      );
      floor = parseLocalizedAmount(
        manual.floor,
        manual.currency,
        formatId,
        'Floor price',
      );
    } catch (err) {
      setError(message(err));
      return;
    }
    if (amount && minOffer && Number(minOffer) > Number(amount)) {
      setError('The minimum offer is above the asking price.');
      return;
    }
    if (amount && floor && Number(floor) > Number(amount)) {
      setError('The floor price is above the asking price.');
      return;
    }
    const names = splitNames(manual.names);
    const folder = manual.folder.trim();
    const t: ImportTable = {
      headers: [
        'Domain',
        'Asking price',
        'Minimum offer',
        'Floor price',
        'Asking currency',
        'Folder',
      ],
      rows: names.map((name, i) => ({
        line: i + 1,
        cells: [
          name,
          amount ?? '',
          minOffer ?? '',
          floor ?? '',
          amount || minOffer || floor ? manual.currency : '',
          folder,
        ],
      })),
      headerless: false,
    };
    const s: ImportSetup = {
      columns: [
        'domain',
        'askingPrice',
        'minOffer',
        'floorPrice',
        'askingCurrency',
        'folder',
      ],
      format: null,
      dateOrder: 'mdy',
      datesAmbiguous: false,
      defaults: {
        registrar: null,
        currency: manual.currency,
        folder: null,
        status: null,
        purchaseType: null,
      },
    };
    setSource('manual');
    setFileName(null);
    setTable(t);
    setSetup(s);
    await preview(t, s);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError('The file is larger than 10 MB. Split it and import the parts.');
      return;
    }
    const text = decodeText(new Uint8Array(await file.arrayBuffer()));
    await open(text, file.name);
  }

  async function onTemplate() {
    try {
      await window.api.saveTextFile(
        domainsCsvTemplate(),
        'dombot-domains-template.csv',
      );
    } catch (err) {
      setError(message(err));
    }
  }

  // ── match ─────────────────────────────────────────────────────────────────

  const setColumn = (i: number, field: ImportField | null) =>
    setSetup((s) => {
      if (!s) return s;
      // One field per column: taking a field frees it elsewhere.
      const columns = s.columns.map((f, j) =>
        j === i ? field : f === field ? null : f,
      );
      return { ...s, columns };
    });
  const setDefault = <K extends keyof ImportSetup['defaults']>(
    key: K,
    value: ImportSetup['defaults'][K],
  ) =>
    setSetup((s) =>
      s ? { ...s, defaults: { ...s.defaults, [key]: value } } : s,
    );

  // ── import ────────────────────────────────────────────────────────────────

  async function runImport() {
    if (!built || built.rows.length === 0) return;
    setBusy(true);
    setError(null);
    const importId = newEventId();
    const total = { new: 0, update: 0, unchanged: 0, history: 0 };
    const outcomes: ImportOutcome[] = [];
    let newFolders: string[] = [];
    let wrote = false;
    try {
      for (let i = 0; i < built.rows.length; i += CHUNK) {
        setProgress(i / built.rows.length);
        const done = await window.api.importDomains(
          built.rows.slice(i, i + CHUNK),
          { importId },
        );
        wrote = true;
        for (const k of Object.keys(total) as (keyof typeof total)[])
          total[k] += done.counts[k];
        outcomes.push(...done.outcomes);
        newFolders = [...new Set([...newFolders, ...done.newFolders])];
      }
      setProgress(1);
      setResult({ plan: { outcomes, counts: total, newFolders }, importId });
      setStep('done');
    } catch (err) {
      setError(
        `${message(err)} Rows already imported stay; importing again finishes the rest.`,
      );
    } finally {
      // Show what was written, even when a later chunk failed.
      if (wrote) {
        const store = useAppStore.getState();
        await Promise.all([
          store.loadDomainEvents(),
          store.loadPurchases(),
          store.loadFolders(),
          store.loadPricing(),
          store.loadAskingPrices(),
        ]).catch(() => {});
      }
      setBusy(false);
      setProgress(null);
    }
  }

  async function downloadIssues() {
    if (!built || !plan) return;
    const lines = [
      ...built.issues.map((i) => [
        String(i.line),
        i.domain ?? '',
        i.level === 'error' ? `Skipped: ${i.message}` : i.message,
      ]),
      ...plan.outcomes.flatMap((o) =>
        o.warnings.map((w) => [String(o.line), o.domain, w]),
      ),
    ].sort((a, b) => Number(a[0]) - Number(b[0]));
    await window.api.saveTextFile(
      toCsv([['Row', 'Domain', 'Problem'], ...lines]),
      'dombot-import-issues.csv',
    );
  }

  const errors = built?.issues.filter((i) => i.level === 'error') ?? [];
  const toImport =
    plan?.outcomes.filter((o) => o.result !== 'unchanged').length ?? 0;

  const description =
    step === 'choose'
      ? source === 'manual'
        ? 'Type or paste names. The price and folder below apply to every one.'
        : 'Upload a spreadsheet of your names, with any details it has.'
      : step === 'match'
        ? `${fileName ?? 'The file'} · ${(table?.rows.length ?? 0).toLocaleString('en-US')} rows. Check what each column holds.`
        : step === 'review'
          ? 'Review what changes. Nothing is saved until you import.'
          : 'Done.';

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* -m-1 p-1 leaves room for focus rings, which the scroll box would clip. */}
      <div
        className={cn(
          '-m-1 flex min-h-0 flex-col gap-[13px] overflow-y-auto p-1',
          step !== 'review' && 'flex-1',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div>
            <h1 className="text-2xl font-bold leading-none sm:text-[32px]">
              Import
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {description}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {step === 'choose' && source === 'manual' && (
              <Button
                type="button"
                disabled={busy || splitNames(manual.names).length === 0}
                onClick={() => void addManual()}
              >
                {busy
                  ? 'Reading…'
                  : `Review ${splitNames(manual.names).length.toLocaleString('en-US')} name${splitNames(manual.names).length === 1 ? '' : 's'}`}
              </Button>
            )}
            {step === 'match' && (
              <>
                <Button
                  type="button"
                  variant="outline"

                  onClick={() => setStep('choose')}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={
                    busy ||
                    !setup ||
                    (!setup.columns.includes('domain') &&
                      !setup.columns.includes('idn'))
                  }
                  title={
                    setup &&
                    !setup.columns.includes('domain') &&
                    !setup.columns.includes('idn')
                      ? 'Choose the column with the domain names.'
                      : undefined
                  }
                  onClick={() => table && setup && void preview(table, setup)}
                >
                  {busy ? 'Reading…' : 'Review'}
                </Button>
              </>
            )}
            {step === 'review' && (
              <>
                <Button
                  type="button"
                  variant="outline"

                  disabled={busy}
                  onClick={() =>
                    setStep(
                      source === 'manual' || setup?.format?.exact
                        ? 'choose'
                        : 'match',
                    )
                  }
                >
                  Back
                </Button>
                {(errors.length > 0 ||
                  plan?.outcomes.some((o) => o.warnings.length > 0)) && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void downloadIssues()}
                  >
                    Download issues
                  </Button>
                )}
                <Button
                  type="button"
                  disabled={busy || toImport === 0}
                  onClick={() => void runImport()}
                >
                  {busy && progress !== null
                    ? 'Importing…'
                    : toImport === 0
                      ? 'Nothing to import'
                      : `Import ${toImport.toLocaleString('en-US')} name${toImport === 1 ? '' : 's'}`}
                </Button>
              </>
            )}
            {step === 'done' && result && (
              <>
                <Button
                  type="button"
                  variant="outline"

                  onClick={() => {
                    navigate(`/activity?import=${result.importId}`);
                  }}
                >
                  View in Activity
                </Button>
                {result.plan.counts.new > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      navigate(`/activity?review=1&import=${result.importId}`);
                    }}
                  >
                    Review new names
                  </Button>
                )}
                <Button type="button" onClick={startOver}>
                  Import more
                </Button>
              </>
            )}
          </div>
        </div>

        <div className={cn('flex flex-col', step === 'choose' && 'max-w-2xl')}>
          {step === 'choose' && (
            <Tabs
              value={source}
              onValueChange={(v) => {
                setSource(v as Source);
                setError(null);
              }}
              className="gap-4"
            >
              <TabsList
                variant="line"
                className="w-full justify-start border-b"
              >
                <TabsTrigger value="manual" className="gap-2">
                  <Pencil className="size-4" />
                  Manual
                </TabsTrigger>
                <TabsTrigger value="file" className="gap-2">
                  <Upload className="size-4" />
                  CSV upload
                </TabsTrigger>
              </TabsList>
              <TabsContent value="manual">
                <ManualTab
                  fields={manual}
                  onChange={(patch) => setManual((m) => ({ ...m, ...patch }))}
                  folderNames={folders.map((f) => f.name)}
                  placeholder={formatAmountInput(
                    '0',
                    manual.currency,
                    settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT,
                  )}
                />
              </TabsContent>
              <TabsContent value="file" className="flex flex-col gap-4">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void onFile(e.dataTransfer.files[0]);
                  }}
                  className={cn(
                    'flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center',
                    dragging && 'border-brand bg-brand/5',
                  )}
                >
                  <FileUp className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Drop a CSV, TSV, or text file here, up to 10,000 rows.
                  </p>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
                    className="hidden"
                    onChange={(e) => {
                      void onFile(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload className="size-4" />
                    Choose a file
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Any spreadsheet with a domain column works: a DomBot export, a
                  registrar or marketplace export, or your own list. You match
                  its columns next.{' '}
                  <button
                    type="button"
                    className="text-brand underline underline-offset-4"
                    onClick={() => void onTemplate()}
                  >
                    Download the template
                  </button>{' '}
                  for DomBot&apos;s columns and three example rows.
                </p>
              </TabsContent>
            </Tabs>
          )}

          {step === 'match' && table && setup && (
            <MatchStep
              table={table}
              setup={setup}
              registrars={ctx.registrars}
              folderNames={folders.map((f) => f.name)}
              onColumn={setColumn}
              onDefault={setDefault}
              onDateOrder={(order) =>
                setSetup((s) => (s ? { ...s, dateOrder: order } : s))
              }
            />
          )}

          {step === 'review' && built && plan && (
            <ReviewStep
              built={built}
              plan={plan}
              filter={filter}
              onFilter={setFilter}
            />
          )}

          {step === 'done' && result && (
            <div className="flex flex-col gap-3 py-2 text-sm">
              <p>
                Added {result.plan.counts.new.toLocaleString('en-US')} name
                {result.plan.counts.new === 1 ? '' : 's'}, updated{' '}
                {result.plan.counts.update.toLocaleString('en-US')}
                {result.plan.counts.history > 0 &&
                  `, and recorded history for ${result.plan.counts.history.toLocaleString('en-US')}`}
                .
                {result.plan.newFolders.length > 0 &&
                  ` New folders: ${result.plan.newFolders.join(', ')}.`}
              </p>
              {result.plan.counts.new > 0 && (
                <p className="text-muted-foreground">
                  {result.plan.counts.new === 1
                    ? 'The new name waits for review, as names sync finds do: record what you paid, or dismiss it.'
                    : `The ${result.plan.counts.new.toLocaleString('en-US')} new names wait for review, as names sync finds do: record what you paid, or dismiss them.`}
                </p>
              )}
            </div>
          )}

          {error && (
            <p
              className="mt-3 flex items-start gap-2 text-sm text-destructive"
              role="alert"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
          {progress !== null && (
            <div className="mt-4 h-1.5 overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-brand transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>
      {step === 'review' && built && plan && (
        <ReviewTable
          rows={reviewRows(built, plan).filter((r) =>
            filter === 'all'
              ? true
              : filter === 'errors'
                ? r.result === 'error'
                : r.result === filter,
          )}
          registrars={ctx.registrars}
          money={(amount, currency) =>
            // A 0 in the file clears the amount.
            Number(amount) === 0
              ? 'Clear'
              : formatMoney(
                  amount,
                  currency,
                  preferred,
                  settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT,
                )
          }
        />
      )}
    </div>
  );
}

function message(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '');
}

// ── match ───────────────────────────────────────────────────────────────────

/** TEMP (dev builds only): `count` made-up names for the Manual tab. */
function sampleNames(count: number): string[] {
  const a = [
    'swift',
    'blue',
    'quiet',
    'bold',
    'golden',
    'lucky',
    'clever',
    'noble',
    'prime',
    'lunar',
    'amber',
    'velvet',
  ];
  const b = [
    'harbor',
    'finch',
    'forge',
    'summit',
    'meadow',
    'beacon',
    'falcon',
    'grove',
    'lantern',
    'orbit',
    'raven',
    'willow',
  ];
  const tlds = ['com', 'net', 'io', 'co', 'ai', 'app'];
  const names = new Set<string>();
  while (names.size < count)
    names.add(
      `${a[Math.floor(Math.random() * a.length)]}${b[Math.floor(Math.random() * b.length)]}${Math.floor(Math.random() * 90) + 10}.${tlds[Math.floor(Math.random() * tlds.length)]}`,
    );
  return [...names];
}

/**
 * Names typed or pasted, plus what to apply to all of them: an asking price
 * (with minimum offer and floor) and a folder.
 */
function ManualTab({
  fields,
  onChange,
  folderNames,
  placeholder,
}: {
  fields: ManualFields;
  onChange: (patch: Partial<ManualFields>) => void;
  folderNames: string[];
  /** A zero in the number format and currency, e.g. "0.00". */
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="import-names">Domains</Label>
          {/* TEMP (dev builds only): fills sample names to test larger imports. */}
          {import.meta.env.DEV && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              onClick={() => onChange({ names: sampleNames(120).join('\n') })}
            >
              Dev: fill 120 names
            </button>
          )}
        </div>
        <Textarea
          id="import-names"
          rows={7}
          className="min-h-40 font-mono text-sm"
          placeholder={'example.com\nexample.net'}
          value={fields.names}
          onChange={(e) => onChange({ names: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          One per line, or separated by commas or spaces. New names are added to
          Owned. You review every change before anything is saved.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="import-asking">Asking price</Label>
          <Input
            id="import-asking"
            inputMode="decimal"
            placeholder={placeholder}
            value={fields.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="import-min-offer">Minimum offer</Label>
          <Input
            id="import-min-offer"
            inputMode="decimal"
            placeholder="Optional"
            value={fields.minOffer}
            onChange={(e) => onChange({ minOffer: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="import-floor">Floor price</Label>
          <Input
            id="import-floor"
            inputMode="decimal"
            placeholder="Optional"
            value={fields.floor}
            onChange={(e) => onChange({ floor: e.target.value })}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>Currency</Label>
          <CurrencyPicker
            value={fields.currency}
            onChange={(currency) => onChange({ currency })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="import-manual-folder">Folder</Label>
          <Input
            id="import-manual-folder"
            list="import-manual-folders"
            placeholder="No folder"
            value={fields.folder}
            onChange={(e) => onChange({ folder: e.target.value })}
          />
          <datalist id="import-manual-folders">
            {folderNames.map((f) => (
              <option key={f} value={f} />
            ))}
            <option value="Hidden" />
          </datalist>
        </div>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        The price and folder go on every name above, replacing what a name
        already has. A blank field leaves it alone, and 0 clears it. A folder
        that doesn&apos;t exist yet is created.
      </p>
    </div>
  );
}

function MatchStep({
  table,
  setup,
  registrars,
  folderNames,
  onColumn,
  onDefault,
  onDateOrder,
}: {
  table: ImportTable;
  setup: ImportSetup;
  registrars: { id: string; displayName: string }[];
  folderNames: string[];
  onColumn: (i: number, field: ImportField | null) => void;
  onDefault: <K extends keyof ImportSetup['defaults']>(
    key: K,
    value: ImportSetup['defaults'][K],
  ) => void;
  onDateOrder: (order: ImportSetup['dateOrder']) => void;
}) {
  const knownRegistrar = registrars.some(
    (r) => r.id === setup.defaults.registrar,
  );
  const [otherRegistrar, setOtherRegistrar] = useState(
    setup.defaults.registrar !== null && !knownRegistrar,
  );
  const samples = (i: number) =>
    table.rows
      .map((r) => r.cells[i]?.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(' · ');

  return (
    <div className="flex flex-col gap-5 md:flex-row">
      <div className="min-w-0 flex-1">
        {setup.format && (
          <p className="mb-3 flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-brand" />
            Looks like a {setup.format.label}. Its columns are matched below.
          </p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Column in your file</th>
              <th className="pb-2 font-medium">Import as</th>
            </tr>
          </thead>
          <tbody>
            {table.headers.map((header, i) => (
              <tr key={i} className="border-t align-top">
                <td className="py-2 pr-3">
                  <div className="font-medium">
                    {header || `Column ${i + 1}`}
                  </div>
                  <div className="max-w-40 truncate text-xs text-muted-foreground sm:max-w-72">
                    {samples(i) || 'empty'}
                  </div>
                </td>
                <td className="w-[46%] py-2 sm:w-56">
                  <Select
                    value={setup.columns[i] ?? SKIP}
                    onValueChange={(v) =>
                      onColumn(i, v === SKIP ? null : (v as ImportField))
                    }
                  >
                    <SelectTrigger
                      className={cn(
                        'h-8 w-full',
                        !setup.columns[i] && 'text-muted-foreground',
                      )}
                      aria-label={`Import ${header || `column ${i + 1}`} as`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP}>Don&apos;t import</SelectItem>
                      {IMPORT_FIELDS.map((f) => (
                        <SelectItem key={f.field} value={f.field}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex w-full flex-col gap-4 rounded-lg border bg-muted/30 p-4 md:w-64">
        <p className="text-sm font-medium">For every row</p>
        {setup.datesAmbiguous && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Dates like 03/04/2024 are</Label>
            <Select
              value={setup.dateOrder}
              onValueChange={(v) => onDateOrder(v as 'mdy' | 'dmy')}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mdy">Month first (March 4)</SelectItem>
                <SelectItem value="dmy">Day first (3 April)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Registrar</Label>
          <Select
            value={otherRegistrar ? OTHER : (setup.defaults.registrar ?? NONE)}
            onValueChange={(v) => {
              setOtherRegistrar(v === OTHER);
              onDefault('registrar', v === NONE || v === OTHER ? null : v);
            }}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>From the file</SelectItem>
              {registrars.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.displayName}
                </SelectItem>
              ))}
              <SelectItem value={OTHER}>Other…</SelectItem>
            </SelectContent>
          </Select>
          {otherRegistrar && (
            <Input
              className="h-8"
              aria-label="Registrar name"
              placeholder="e.g. Epik"
              defaultValue={
                knownRegistrar ? '' : (setup.defaults.registrar ?? '')
              }
              onChange={(e) => onDefault('registrar', e.target.value || null)}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Used for names no account of yours holds.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Currency for amounts without one</Label>
          <CurrencyPicker
            value={setup.defaults.currency}
            onChange={(c) => onDefault('currency', c)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs" htmlFor="import-folder">
            Folder
          </Label>
          <Input
            id="import-folder"
            className="h-8"
            list="import-folders"
            placeholder="From the file"
            value={setup.defaults.folder ?? ''}
            onChange={(e) => onDefault('folder', e.target.value || null)}
          />
          <datalist id="import-folders">
            {folderNames.map((f) => (
              <option key={f} value={f} />
            ))}
            <option value="Hidden" />
          </datalist>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Status</Label>
          <Select
            value={setup.defaults.status ?? NONE}
            onValueChange={(v) =>
              onDefault(
                'status',
                v === NONE
                  ? null
                  : (v as NonNullable<ImportSetup['defaults']['status']>),
              )
            }
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>From the file</SelectItem>
              <SelectItem value="owned">Owned</SelectItem>
              <SelectItem value="sold">Sold</SelectItem>
              <SelectItem value="dropped">Dropped</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Purchase type</Label>
          <Select
            value={setup.defaults.purchaseType ?? NONE}
            onValueChange={(v) =>
              onDefault(
                'purchaseType',
                v === NONE ? null : (v as 'registered' | 'purchased'),
              )
            }
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>From the file</SelectItem>
              <SelectItem value="registered">Registered</SelectItem>
              <SelectItem value="purchased">Purchased</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

// ── review ──────────────────────────────────────────────────────────────────

/** One line of the review table: a name the import reads, or a row it skips. */
interface ReviewRow {
  key: string;
  line: number;
  /** ASCII; null for a row with no readable name. */
  domain: string | null;
  result: ImportOutcome['result'] | 'error';
  row: ImportRow | null;
  /** What changes, by field label ("Folder", "Asking price", …). */
  changes: Map<string, ImportChange>;
  /** Warnings, or the reason an error row is skipped. */
  problems: string[];
}

/** The plan as table rows, errors included. */
export function reviewRows(built: BuiltRows, plan: ImportPlan): ReviewRow[] {
  const byLine = new Map(built.rows.map((r) => [r.line, r]));
  const warnings = new Map<number, string[]>();
  for (const i of built.issues)
    if (i.level === 'warning')
      warnings.set(i.line, [...(warnings.get(i.line) ?? []), i.message]);
  return [
    ...plan.outcomes.map((o) => ({
      key: `n:${o.domain}`,
      line: o.line,
      domain: o.domain,
      result: o.result,
      row: byLine.get(o.line) ?? null,
      changes: new Map(o.changes.map((c) => [c.field, c])),
      problems: [...(warnings.get(o.line) ?? []), ...o.warnings],
    })),
    ...built.issues
      .filter((i) => i.level === 'error')
      .map((i, n) => ({
        key: `e:${i.line}:${n}`,
        line: i.line,
        domain: i.domain,
        result: 'error' as const,
        row: null,
        changes: new Map<string, ImportChange>(),
        problems: [i.message],
      })),
  ];
}

const STATUS_LABEL: Record<NonNullable<ImportRow['status']>, string> = {
  owned: 'Owned',
  sold: 'Sold',
  dropped: 'Dropped',
  archived: 'Archived',
  removed: 'Removed',
};

/**
 * A value column of the review table: what the row says, and the change
 * label that marks it as something the import writes.
 */
interface ValueColumn {
  key: string;
  label: string;
  /** The `ImportChange.field` this column shows. */
  field: string;
  align?: 'right';
  value: (row: ImportRow) => string | null;
  sortValue?: (row: ImportRow) => string | number | null;
}

/** The filters above the review table. */
function ReviewStep({
  built,
  plan,
  filter,
  onFilter,
}: {
  built: BuiltRows;
  plan: ImportPlan;
  filter: Filter;
  onFilter: (f: Filter) => void;
}) {
  const errors = built.issues.filter((i) => i.level === 'error');
  const chips: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: plan.outcomes.length + errors.length },
    { id: 'new', label: 'New', count: plan.counts.new },
    { id: 'update', label: 'Updated', count: plan.counts.update },
    { id: 'unchanged', label: 'Unchanged', count: plan.counts.unchanged },
    { id: 'history', label: 'Archive', count: plan.counts.history },
    { id: 'errors', label: 'Skipped', count: errors.length },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onFilter(c.id)}
            disabled={c.count === 0 && c.id !== 'all'}
            className={cn(
              'rounded-full border px-3 py-1 text-xs tabular-nums disabled:opacity-40',
              filter === c.id
                ? 'border-brand bg-brand/10 text-brand'
                : 'hover:bg-accent',
              c.id === 'errors' &&
                c.count > 0 &&
                filter !== c.id &&
                'text-destructive',
            )}
          >
            {c.label} {c.count.toLocaleString('en-US')}
          </button>
        ))}
        {built.skipped > 0 && (
          <span className="text-xs text-muted-foreground">
            {built.skipped.toLocaleString('en-US')} blank or non-domain row
            {built.skipped === 1 ? '' : 's'} left out
          </span>
        )}
        {plan.newFolders.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Creates {plan.newFolders.length === 1 ? 'a folder' : 'folders'}:{' '}
            {plan.newFolders.join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Every name the import reads, one row each, with a column per field the
 * file has. A value the import writes is in full color (hover shows what it
 * replaces); one DomBot already has, or keeps, is dimmed.
 */
function ReviewTable({
  rows,
  registrars,
  money,
}: {
  rows: ReviewRow[];
  registrars: ImportContext['registrars'];
  money: (amount: string, currency: string) => string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({
    key: 'line',
    dir: 'asc',
  });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const registrarName = (id: string) =>
    registrars.find((r) => r.id === id)?.displayName ?? id;
  const allColumns: ValueColumn[] = [
    {
      key: 'status',
      label: 'Status',
      field: 'Status',
      value: (r) => (r.status ? STATUS_LABEL[r.status] : null),
    },
    {
      key: 'folder',
      label: 'Folder',
      field: 'Folder',
      value: (r) => r.folder ?? null,
    },
    {
      key: 'registrar',
      label: 'Registrar',
      field: 'Registrar',
      value: (r) =>
        r.registration?.registrar
          ? registrarName(r.registration.registrar)
          : (r.registration?.registrarLabel ?? null),
    },
    {
      key: 'expires',
      label: 'Expires',
      field: 'Expires',
      value: (r) => r.registration?.expirationDate ?? null,
    },
    {
      key: 'asking',
      label: 'Asking',
      field: 'Asking price',
      align: 'right',
      value: (r) => {
        const a = r.asking;
        if (!a) return null;
        const parts = [
          a.amount && money(a.amount, a.currency),
          a.minOffer && `min ${money(a.minOffer, a.currency)}`,
          a.floor && `floor ${money(a.floor, a.currency)}`,
        ].filter(Boolean);
        return parts.length ? parts.join(' · ') : null;
      },
      sortValue: (r) => (r.asking?.amount ? Number(r.asking.amount) : null),
    },
    {
      key: 'renewal',
      label: 'Renewal',
      field: 'Renewal price',
      align: 'right',
      value: (r) =>
        r.renewal ? money(r.renewal.amount, r.renewal.currency) : null,
      sortValue: (r) => (r.renewal ? Number(r.renewal.amount) : null),
    },
    {
      key: 'purchased',
      label: 'Purchased',
      field: 'Purchase date',
      value: (r) => r.purchase?.date ?? null,
    },
    {
      key: 'paid',
      label: 'Paid',
      field: 'Purchase amount',
      align: 'right',
      value: (r) =>
        r.purchase?.amount
          ? money(r.purchase.amount, r.purchase.currency ?? '')
          : null,
      sortValue: (r) => (r.purchase?.amount ? Number(r.purchase.amount) : null),
    },
    {
      key: 'sold',
      label: 'Sold',
      field: 'Sale date',
      value: (r) => r.sale?.date ?? null,
    },
    {
      key: 'soldFor',
      label: 'Sold for',
      field: 'Sale amount',
      align: 'right',
      value: (r) =>
        r.sale?.amount ? money(r.sale.amount, r.sale.currency ?? '') : null,
      sortValue: (r) => (r.sale?.amount ? Number(r.sale.amount) : null),
    },
    {
      key: 'notes',
      label: 'Notes',
      field: 'Notes',
      value: (r) => r.notes ?? null,
    },
  ];
  const valueColumns = allColumns.filter((c) =>
    rows.some((r) => r.row && c.value(r.row) !== null),
  );

  const columns: DataColumn<ReviewRow>[] = [
    {
      key: 'line',
      label: 'Row',
      align: 'right',
      compact: true,
      cell: (r) => (
        <span className="text-muted-foreground tabular-nums">{r.line}</span>
      ),
    },
    {
      key: 'domain',
      label: 'Domain',
      cell: (r) => (
        <span className="font-mono">
          {r.domain ? toUnicode(r.domain) : '—'}
        </span>
      ),
    },
    {
      key: 'result',
      label: 'Result',
      cell: (r) => (
        <Badge
          variant="outline"
          className={cn(
            'justify-center',
            r.result === 'error'
              ? 'border-destructive/40 text-destructive'
              : RESULT_STYLE[r.result],
          )}
        >
          {r.result === 'error' ? 'Skipped' : RESULT_LABEL[r.result]}
        </Badge>
      ),
    },
    ...valueColumns.map((c): DataColumn<ReviewRow> => ({
      key: c.key,
      label: c.label,
      align: c.align,
      hideOnMobile: true,
      cell: (r) => {
        const value = r.row ? c.value(r.row) : null;
        if (value === null)
          return <span className="text-muted-foreground/50">—</span>;
        const change = r.changes.get(c.field);
        return (
          <span
            className={cn(
              'block max-w-64 truncate',
              !change && 'text-muted-foreground',
            )}
            title={
              change
                ? change.from
                  ? `Replaces ${change.from}`
                  : 'New'
                : 'Already in DomBot, or kept'
            }
          >
            {value}
          </span>
        );
      },
    })),
    {
      key: 'problems',
      label: 'Notes',
      sortable: true,
      cell: (r) =>
        r.problems.length === 0 ? null : (
          <span
            className={cn(
              'flex max-w-96 items-start gap-1.5 text-xs',
              r.result === 'error'
                ? 'text-destructive'
                : 'text-amber-600 dark:text-amber-400',
            )}
            title={r.problems.join('\n')}
          >
            <CircleAlert className="mt-px size-3.5 shrink-0" />
            <span className="truncate">{r.problems.join(' ')}</span>
          </span>
        ),
    },
  ];
  // "Notes" is taken by the file's notes column when it has one.
  if (valueColumns.some((c) => c.key === 'notes'))
    columns[columns.length - 1].label = 'Problems';

  const sorted = useMemo(() => {
    const col = valueColumns.find((c) => c.key === sort.key);
    const valueOf = (r: ReviewRow): string | number | null => {
      switch (sort.key) {
        case 'line':
          return r.line;
        case 'domain':
          return r.domain;
        case 'result':
          return r.result;
        case 'problems':
          return r.problems.length || null;
        default:
          if (!col || !r.row) return null;
          return (col.sortValue ?? col.value)(r.row);
      }
    };
    return sortRows([...rows], valueOf, sort.dir);
    // valueColumns is rebuilt each render from `rows`; the sort key covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  return (
    <DataTable
      className="mt-[13px]"
      rows={sorted}
      columns={columns}
      rowKey={(r) => r.key}
      sort={sort}
      onSort={(key) => {
        setSort((s) =>
          s.key === key
            ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
            : { key, dir: 'asc' },
        );
        setPage(0);
      }}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={(n) => {
        setPageSize(n);
        setPage(0);
      }}
      empty="Nothing to show."
    />
  );
}
