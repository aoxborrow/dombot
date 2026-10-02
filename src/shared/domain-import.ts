import type { CurrencyCode } from './currencies';
import { detectDelimiter, parseCsv, unguardCell } from './csv';
import {
  FIELD_INFO,
  detectFormat,
  isDomainHeader,
  matchColumns,
  type ImportField,
  type KnownFormat,
} from './import-columns';
import {
  detectDateOrder,
  fitAmount,
  hasAmbiguousDates,
  looksLikeDomain,
  readBoolean,
  readCurrency,
  readDate,
  readDomain,
  readMoney,
  readPurchaseType,
  readRegistrar,
  readStatus,
  readYears,
  statusWord,
  type DateOrder,
  type ImportStatus,
  type RegistrarName,
} from './import-values';
import type { ImportRow } from './ipc';
import type { NumberFormatId } from './money';

// From a file's text to normalized rows (docs/domain-import-export.md,
// "Reading the file" and "Normalized rows"). Runs in the renderer so the
// matching step and the errors show instantly and the raw file never leaves
// the device; the server only sees `ImportRow`s.

/** Data rows in a file: up to this many import at once. */
export const MAX_IMPORT_ROWS = 10_000;

export interface ImportTable {
  headers: string[];
  rows: { line: number; cells: string[] }[];
  /** The file had no header row: it's a list of names. */
  headerless: boolean;
}

const blank = (cells: string[]) => cells.every((c) => !c.trim());

/**
 * The file as a header row and data rows. The header is the first of the
 * first ten rows with a cell that names the Domain column; rows above it (a
 * title, instructions) are dropped. A file whose first row starts with a
 * domain name has no header: it's a list of names. Trailing empty columns
 * are dropped.
 */
export function readTable(text: string): ImportTable {
  const all = parseCsv(text, detectDelimiter(text)).map((cells, i) => ({
    line: i + 1,
    cells: cells.map(unguardCell),
  }));
  const filled = all.filter((r) => !blank(r.cells));
  if (filled.length === 0) return { headers: [], rows: [], headerless: false };

  let headerAt = filled
    .slice(0, 10)
    .findIndex((r) => r.cells.some((c) => isDomainHeader(c)));
  let headers: string[];
  let headerless = false;
  if (headerAt === -1) {
    const first = filled[0];
    const domainCol = first.cells.findIndex(looksLikeDomain);
    if (domainCol !== -1) {
      headerless = true;
      headerAt = -1;
      headers = first.cells.map((_, i) =>
        i === domainCol ? 'Domain' : `Column ${i + 1}`,
      );
    } else {
      headerAt = 0;
      headers = first.cells;
    }
  } else {
    headers = filled[headerAt].cells;
  }
  const startLine = headerless ? filled[0].line : filled[headerAt].line + 1;
  const rows = all.filter((r) => r.line >= startLine);
  // Drop trailing columns with no header and nothing in them.
  let width = Math.max(headers.length, ...rows.map((r) => r.cells.length));
  while (
    width > 0 &&
    !headers[width - 1]?.trim() &&
    rows.every((r) => !r.cells[width - 1]?.trim())
  )
    width--;
  return {
    headers: Array.from({ length: width }, (_, i) => headers[i]?.trim() ?? ''),
    rows: rows.map((r) => ({
      line: r.line,
      cells: Array.from({ length: width }, (_, i) => r.cells[i] ?? ''),
    })),
    headerless,
  };
}

/** Values set once for every row, in the matching step. */
export interface ImportDefaults {
  /** A registrar id DomBot knows, or free text. */
  registrar: string | null;
  /** For amounts that name no currency of their own. */
  currency: string;
  folder: string | null;
  status: ImportStatus | null;
  purchaseType: 'registered' | 'purchased' | null;
}

/** How the file's columns are read. */
export interface ImportSetup {
  /** The field each column holds, or null for "Don't import". */
  columns: (ImportField | null)[];
  format: KnownFormat | null;
  /** How `03/04/2024` reads. */
  dateOrder: DateOrder;
  /** True when no date in the file told the order apart. */
  datesAmbiguous: boolean;
  defaults: ImportDefaults;
}

export interface ImportContext {
  preferredCurrency: string;
  numberFormat: NumberFormatId;
  /** The registrars DomBot knows, for matching a registrar cell. */
  registrars: RegistrarName[];
  /** `YYYY-MM-DD`, for "in the future" warnings. */
  today: string;
}

const DATE_FIELDS = new Set<ImportField>([
  'createdDate',
  'expirationDate',
  'purchaseDate',
  'saleDate',
]);

const column = (table: ImportTable, i: number) =>
  table.rows.map((r) => r.cells[i] ?? '').filter((c) => c.trim());

/**
 * The first guess at reading the file: columns matched by header (and by a
 * known format), the date order from the dates themselves, and the format's
 * registrar and purchase type as values for every row.
 */
export function guessSetup(
  table: ImportTable,
  ctx: ImportContext,
): ImportSetup {
  const format = table.headerless ? null : detectFormat(table.headers);
  const columns = matchColumns(
    table.headers,
    (i) => {
      const values = column(table, i).slice(0, 200);
      const known = values.filter((v) => statusWord(v) !== null).length;
      return values.length > 0 && known / values.length >= 0.8;
    },
    format,
  );
  const dateValues = columns.flatMap((f, i) =>
    f && DATE_FIELDS.has(f) ? column(table, i) : [],
  );
  const detected = detectDateOrder(dateValues);
  return {
    columns,
    format,
    dateOrder: detected ?? (ctx.numberFormat === 'us' ? 'mdy' : 'dmy'),
    datesAmbiguous: detected === null && hasAmbiguousDates(dateValues),
    defaults: {
      registrar: format?.registrar ?? null,
      currency: ctx.preferredCurrency,
      folder: null,
      status: null,
      purchaseType: format?.purchaseType ?? null,
    },
  };
}

/** A problem on one row. Errors skip the row; warnings don't. */
export interface RowIssue {
  line: number;
  domain: string | null;
  level: 'error' | 'warning';
  message: string;
}

export interface BuiltRows {
  rows: ImportRow[];
  issues: RowIssue[];
  /** Blank rows, repeated headers, and rows with no domain in them. */
  skipped: number;
  /** Rows merged into an earlier row for the same name. */
  merged: number;
}

/** The cells of one row, by field. */
type Cells = Partial<Record<ImportField, string>>;

/** One row read into fields, or throws with the reason it can't be. */
function readRow(
  cells: Cells,
  hints: Partial<Record<ImportField, string>>,
  setup: ImportSetup,
  ctx: ImportContext,
  domain: string,
  line: number,
): ImportRow {
  const pref = ctx.preferredCurrency;
  const date = (f: ImportField) =>
    readDate(cells[f] ?? '', setup.dateOrder) ?? undefined;
  const label = (f: ImportField) => FIELD_INFO[f].label;
  const at = <T>(f: ImportField, read: () => T): T => {
    try {
      return read();
    } catch (err) {
      throw new Error(
        `${label(f)}: ${err instanceof Error ? err.message : 'not readable'}`,
      );
    }
  };
  const currencyOf = (f: ImportField) =>
    at(f, () => readCurrency(cells[f] ?? '', pref));
  const rowCurrency = currencyOf('currency');
  /** Amount fields sharing one currency (cell, column, row, header, file). */
  const money = (
    fields: ImportField[],
    currencyField: ImportField,
  ): {
    amounts: Partial<Record<ImportField, string>>;
    currency: CurrencyCode;
  } | null => {
    // What the row says the currency is, apart from the amounts. A bare "$"
    // reads as that currency when it's a dollar.
    const columnCurrency = currencyOf(currencyField);
    const hinted = fields.map((f) => hints[f]).find(Boolean);
    const stated =
      columnCurrency ??
      rowCurrency ??
      (hinted ? readCurrency(hinted, pref) : null);
    // A 0 clears the stored amount, except in another site's export, where
    // it means "not set" (Efty, Afternic).
    const zeroIsBlank = !!setup.format && !setup.format.exact;
    const read = fields.map((f) => {
      const m = at(f, () => readMoney(cells[f] ?? '', stated ?? pref));
      return [f, m && zeroIsBlank && Number(m.value) === 0 ? null : m] as const;
    });
    if (read.every(([, m]) => !m)) return null;
    const named = read.map(([, m]) => m?.currency).filter(Boolean);
    if (new Set(named).size > 1)
      throw new Error(`${label(fields[0])}: the amounts name two currencies.`);
    if (named[0] && stated && named[0] !== stated)
      throw new Error(
        `${label(fields[0])}: the amount says ${named[0]}, the row says ${stated}.`,
      );
    const currency =
      named[0] ?? stated ?? readCurrency(setup.defaults.currency, pref);
    if (!currency) throw new Error(`${label(fields[0])}: choose a currency.`);
    const amounts: Partial<Record<ImportField, string>> = {};
    for (const [f, m] of read)
      if (m) amounts[f] = at(f, () => fitAmount(m.value, currency));
    return { amounts, currency };
  };

  const row: ImportRow = { line, domain };
  const status =
    at('status', () => readStatus(cells.status ?? '')) ?? setup.defaults.status;
  if (status) row.status = status;
  const folder = cells.folder?.trim().split(/\s*[;|]\s*/)[0];
  const folderName =
    folder && !/^(\(no folder\)|none|-|—)$/i.test(folder)
      ? folder.slice(0, 100)
      : setup.defaults.folder?.trim() || undefined;
  if (folderName) row.folder = folderName;
  const notes = cells.notes?.trim();
  if (notes) row.notes = notes.slice(0, 4000);

  const registrarCell =
    cells.registrar?.trim() || setup.defaults.registrar?.trim();
  const registrar = registrarCell
    ? readRegistrar(registrarCell, ctx.registrars)
    : null;
  const registration: NonNullable<ImportRow['registration']> = {};
  if (registrar && 'id' in registrar) registration.registrar = registrar.id;
  if (registrar && 'label' in registrar)
    registration.registrarLabel = registrar.label;
  const created = at('createdDate', () => date('createdDate'));
  if (created) registration.createdDate = created;
  const expires = at('expirationDate', () => date('expirationDate'));
  if (expires) registration.expirationDate = expires;
  const autoRenew = at('autoRenew', () => readBoolean(cells.autoRenew ?? ''));
  if (autoRenew !== null) registration.autoRenew = autoRenew;
  if (Object.keys(registration).length > 0) row.registration = registration;

  const renewal = money(['renewalPrice'], 'renewalCurrency');
  if (renewal?.amounts.renewalPrice)
    row.renewal = {
      amount: renewal.amounts.renewalPrice,
      currency: renewal.currency,
    };

  const asking = money(
    ['askingPrice', 'minOffer', 'floorPrice'],
    'askingCurrency',
  );
  if (asking) {
    const { askingPrice, minOffer, floorPrice } = asking.amounts;
    // A zero asking price clears it, so it caps nothing.
    const cap =
      askingPrice && Number(askingPrice) > 0 ? Number(askingPrice) : null;
    if (cap !== null && minOffer && Number(minOffer) > cap)
      throw new Error('The minimum offer is above the asking price.');
    if (cap !== null && floorPrice && Number(floorPrice) > cap)
      throw new Error('The floor price is above the asking price.');
    row.asking = {
      ...(askingPrice ? { amount: askingPrice } : {}),
      ...(minOffer ? { minOffer } : {}),
      ...(floorPrice ? { floor: floorPrice } : {}),
      currency: asking.currency,
    };
  }

  const purchase: NonNullable<ImportRow['purchase']> = {};
  const type =
    at('purchaseType', () => readPurchaseType(cells.purchaseType ?? '')) ??
    setup.defaults.purchaseType;
  const bought = at('purchaseDate', () => date('purchaseDate'));
  const paid = money(['purchaseAmount'], 'purchaseCurrency');
  const years = at('purchaseYears', () => readYears(cells.purchaseYears ?? ''));
  if (bought) purchase.date = bought;
  if (paid?.amounts.purchaseAmount) {
    purchase.amount = paid.amounts.purchaseAmount;
    purchase.currency = paid.currency;
  }
  if (years) purchase.years = years;
  // A purchase type alone (a value for every row) records nothing by itself.
  if (Object.keys(purchase).length > 0) {
    if (type) purchase.type = type;
    row.purchase = purchase;
  } else if (cells.purchaseType?.trim() && type) {
    row.purchase = { type };
  }

  const sold = at('saleDate', () => date('saleDate'));
  const got = money(['saleAmount'], 'saleCurrency');
  if (sold || got?.amounts.saleAmount) {
    row.sale = {
      ...(sold ? { date: sold } : {}),
      ...(got?.amounts.saleAmount
        ? { amount: got.amounts.saleAmount, currency: got.currency }
        : {}),
    };
  }
  return row;
}

/** Warnings a readable row can still carry. */
function rowWarnings(row: ImportRow, today: string): string[] {
  const out: string[] = [];
  const bought = row.purchase?.date;
  const sold = row.sale?.date;
  if (bought && sold && sold < bought)
    out.push('The sale date is before the purchase date.');
  if (bought && bought > today) out.push('The purchase date is in the future.');
  if (sold && sold > today) out.push('The sale date is in the future.');
  return out;
}

// Merging: each group that has to stay whole (an amount with its currency)
// is one key, so a later row can't pair one row's amount with another's
// currency.
type Flat = Record<string, unknown>;

/** A merge key as a field name for the duplicate warning. */
const MERGE_FIELD: Record<string, string> = {
  status: 'status',
  folder: 'folder',
  notes: 'note',
  'registration.registrar': 'registrar',
  'registration.registrarLabel': 'registrar',
  'registration.createdDate': 'created date',
  'registration.expirationDate': 'expiry',
  'registration.autoRenew': 'auto-renew',
  renewal: 'renewal price',
  asking: 'asking price',
  'purchase.type': 'purchase type',
  'purchase.date': 'purchase date',
  'purchase.money': 'purchase amount',
  'purchase.years': 'purchase years',
  'sale.date': 'sale date',
  'sale.money': 'sale amount',
};

function flatten(row: ImportRow): Flat {
  const out: Flat = {};
  const put = (key: string, value: unknown) => {
    if (value !== undefined) out[key] = value;
  };
  put('status', row.status);
  put('folder', row.folder);
  put('notes', row.notes);
  for (const [k, v] of Object.entries(row.registration ?? {}))
    put(`registration.${k}`, v);
  put('renewal', row.renewal);
  put('asking', row.asking);
  const { amount, currency, ...purchase } = row.purchase ?? {};
  for (const [k, v] of Object.entries(purchase)) put(`purchase.${k}`, v);
  if (amount) put('purchase.money', { amount, currency });
  const { amount: saleAmount, currency: saleCurrency, date } = row.sale ?? {};
  put('sale.date', date);
  if (saleAmount)
    put('sale.money', { amount: saleAmount, currency: saleCurrency });
  return out;
}

function unflatten(line: number, domain: string, flat: Flat): ImportRow {
  const row: ImportRow = { line, domain };
  const group = (prefix: string) => {
    const entries = Object.entries(flat)
      .filter(([k]) => k.startsWith(`${prefix}.`))
      .map(([k, v]) => [k.slice(prefix.length + 1), v] as const);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  };
  if (flat.status) row.status = flat.status as ImportRow['status'];
  if (flat.folder) row.folder = flat.folder as string;
  if (flat.notes) row.notes = flat.notes as string;
  const registration = group('registration');
  if (registration) row.registration = registration;
  if (flat.renewal) row.renewal = flat.renewal as ImportRow['renewal'];
  if (flat.asking) row.asking = flat.asking as ImportRow['asking'];
  const purchase = group('purchase');
  if (purchase) {
    const { money, ...rest } = purchase as { money?: object };
    row.purchase = { ...rest, ...(money ?? {}) };
  }
  const sale = group('sale');
  if (sale) {
    const { money, ...rest } = sale as { money?: object };
    row.sale = { ...rest, ...(money ?? {}) };
  }
  return row;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The file's rows as normalized `ImportRow`s, one per name: rows for the
 * same name merge cell by cell, a later non-blank value winning. A row that
 * can't be read is reported and left out; the rest still import.
 */
export function buildRows(
  table: ImportTable,
  setup: ImportSetup,
  ctx: ImportContext,
): BuiltRows {
  const issues: RowIssue[] = [];
  let skipped = 0;
  let merged = 0;
  const domainCol = setup.columns.indexOf('domain');
  const idnCol = setup.columns.indexOf('idn');
  const hints: Partial<Record<ImportField, string>> = {};
  setup.columns.forEach((f, i) => {
    const hint = /\(([A-Za-z]{3})\)/.exec(table.headers[i] ?? '')?.[1];
    if (f && hint) hints[f] = hint;
  });
  const byName = new Map<
    string,
    { line: number; flat: Flat; from: Map<string, number> }
  >();

  for (const { line, cells } of table.rows) {
    if (blank(cells)) {
      skipped++;
      continue;
    }
    const byField: Cells = {};
    setup.columns.forEach((f, i) => {
      if (f && cells[i]?.trim()) byField[f] = cells[i];
    });
    const rawDomain =
      (domainCol !== -1 ? cells[domainCol]?.trim() : '') ||
      (idnCol !== -1 ? cells[idnCol]?.trim() : '') ||
      '';
    if (!rawDomain || isDomainHeader(rawDomain)) {
      // Money with no name to attach it to is worth saying; anything else
      // (a repeated header, a note at the end) is just skipped.
      const hasData = Object.keys(byField).some((f) =>
        /price|amount|date|offer/i.test(f),
      );
      if (rawDomain || !hasData) skipped++;
      else
        issues.push({
          line,
          domain: null,
          level: 'error',
          message: 'The Domain cell is empty.',
        });
      continue;
    }
    let domain: string;
    try {
      domain = readDomain(rawDomain)!;
    } catch (err) {
      // Instructions or a totals line, not a name: skip it quietly.
      if (/\s/.test(rawDomain) || !rawDomain.includes('.')) {
        skipped++;
        continue;
      }
      issues.push({
        line,
        domain: null,
        level: 'error',
        message: err instanceof Error ? err.message : 'Not a domain name.',
      });
      continue;
    }
    let row: ImportRow;
    try {
      row = readRow(byField, hints, setup, ctx, domain, line);
    } catch (err) {
      issues.push({
        line,
        domain,
        level: 'error',
        message: err instanceof Error ? err.message : 'Not readable.',
      });
      continue;
    }
    for (const message of rowWarnings(row, ctx.today))
      issues.push({ line, domain, level: 'warning', message });

    const flat = flatten(row);
    const existing = byName.get(domain);
    if (!existing) {
      byName.set(domain, {
        line,
        flat,
        from: new Map(Object.keys(flat).map((k) => [k, line])),
      });
      continue;
    }
    merged++;
    // Noted on the name's first row, which is the one the review shows.
    const disagree: string[] = [];
    for (const [key, value] of Object.entries(flat)) {
      const before = existing.flat[key];
      if (before !== undefined && !same(before, value)) {
        const field = MERGE_FIELD[key] ?? key;
        if (!disagree.includes(field)) disagree.push(field);
      }
      existing.flat[key] = value;
      existing.from.set(key, line);
    }
    issues.push({
      line: existing.line,
      domain,
      level: 'warning',
      message: disagree.length
        ? `Duplicate of row ${line}, which has a different ${disagree.join(', ')}; using row ${line}'s.`
        : `Duplicate of row ${line}; combined.`,
    });
  }

  const rows = [...byName].map(([domain, r]) =>
    unflatten(r.line, domain, r.flat),
  );
  return { rows, issues, skipped, merged };
}

/** Today in this machine's time, as `YYYY-MM-DD`. */
export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
