import type { PurchaseInput } from './ipc';
import {
  DEFAULT_CURRENCY,
  assertDomainName,
  currencyInfo,
  parseCanonicalAmount,
  parsePurchaseDate,
} from './money';

export interface PurchaseCsvParse {
  rows: PurchaseInput[];
  /** Data rows with no purchase fields. Those names are left alone. */
  skipped: number;
  errors: string[];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/**
 * A starter file for Import purchases. The three rows show a dollar amount
 * with cents, a yen amount with no decimals, and a note with the date and
 * price left blank. Replace them with real names before importing.
 */
export function purchaseCsvSample(): string {
  return [
    'Domain,Purchase date,Purchase amount,Currency,Notes',
    'example.com,2024-03-15,12.99,USD,"Hand registered, GoDaddy"',
    'shop.example,2019-11-02,5000,JPY,Yen has no decimal places',
    'notes.example,,,,"Date and price unknown"',
  ].join('\n');
}

function headerIndex(headers: string[], names: string[]): number {
  return headers.findIndex((h) => names.includes(h.trim().toLowerCase()));
}

/**
 * Read a spreadsheet of purchase fields. Headers match the Domains CSV:
 * Domain, Purchase date, Purchase amount, Currency, Notes. Extra columns
 * (a full domain export) are ignored. Amounts are plain numbers with a
 * period (`1000000.00`). A row with every purchase cell blank is skipped
 * so re-importing an export does not erase records you left empty.
 */
export function parsePurchaseCsv(
  text: string,
  fallbackCurrency = DEFAULT_CURRENCY,
): PurchaseCsvParse {
  const table = parseCsv(text);
  if (table.length === 0) {
    return { rows: [], skipped: 0, errors: ['The file is empty.'] };
  }
  const headers = table[0];
  const domainCol = headerIndex(headers, ['domain', 'domain name']);
  if (domainCol === -1) {
    return {
      rows: [],
      skipped: 0,
      errors: ['The file needs a Domain column.'],
    };
  }
  const dateCol = headerIndex(headers, ['purchase date']);
  const amountCol = headerIndex(headers, ['purchase amount']);
  const currencyCol = headerIndex(headers, ['currency']);
  const notesCol = headerIndex(headers, ['notes']);
  const fallback = currencyInfo(fallbackCurrency)?.code ?? DEFAULT_CURRENCY;

  const rows: PurchaseInput[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const line = i + 1;
    const domainName = (cells[domainCol] ?? '').trim();
    if (!domainName) {
      skipped++;
      continue;
    }
    const dateRaw = dateCol === -1 ? '' : (cells[dateCol] ?? '').trim();
    const amountRaw = amountCol === -1 ? '' : (cells[amountCol] ?? '').trim();
    const currencyRaw =
      currencyCol === -1 ? '' : (cells[currencyCol] ?? '').trim();
    const notes = (notesCol === -1 ? '' : (cells[notesCol] ?? '').trim()).slice(
      0,
      4000,
    );
    if (!dateRaw && !amountRaw && !notes) {
      skipped++;
      continue;
    }
    try {
      const key = assertDomainName(domainName);
      const purchaseDate = parsePurchaseDate(dateRaw);
      const currencyCode = currencyRaw
        ? (currencyInfo(currencyRaw)?.code ?? null)
        : null;
      if (currencyRaw && !currencyCode) {
        throw new Error(`Unknown currency ${currencyRaw.toUpperCase()}.`);
      }
      const currency = amountRaw ? (currencyCode ?? fallback) : null;
      const amount =
        amountRaw && currency
          ? parseCanonicalAmount(amountRaw, currency)
          : null;
      rows.push({
        domainName: key,
        purchaseDate,
        amount,
        currency: amount ? currency : null,
        notes,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid row.';
      errors.push(`Row ${line} (${domainName}): ${message}`);
    }
  }

  return { rows, skipped, errors };
}
