import type {
  DomainPurchase,
  PurchaseImportResult,
  PurchaseInput,
} from '../../shared/ipc';
import {
  assertDomainName,
  currencyInfo,
  parseCanonicalAmount,
  parsePurchaseDate,
} from '../../shared/money';
import { Namespace } from '../storage/namespace';

// What you paid for a name, keyed by the domain name itself (not
// registrar:account). Sync and Clear cache do not touch this namespace, so
// a name that leaves the portfolio keeps its record.

const store = new Namespace<DomainPurchase>('domain-purchases');

const MAX_NOTES = 4000;

export function getPurchases(): Record<string, DomainPurchase> {
  return store.all();
}

function clean(input: PurchaseInput): { key: string; record: DomainPurchase } {
  const key = assertDomainName(input.domainName);
  const purchaseDate = parsePurchaseDate(input.purchaseDate ?? '');
  const notes = (input.notes ?? '').trim().slice(0, MAX_NOTES);
  const currencyCode = input.currency
    ? currencyInfo(input.currency)?.code
    : null;
  if (input.currency?.trim() && !currencyCode) {
    throw new Error(`Unknown currency ${input.currency.trim().toUpperCase()}.`);
  }
  let amount: string | null = null;
  let currency: string | null = null;
  const rawAmount = (input.amount ?? '').trim();
  if (rawAmount) {
    if (!currencyCode) throw new Error('Choose a currency for the amount.');
    amount = parseCanonicalAmount(rawAmount, currencyCode);
    currency = currencyCode;
  }
  return {
    key,
    record: { purchaseDate, amount, currency, notes },
  };
}

function isEmpty(record: DomainPurchase): boolean {
  return !record.purchaseDate && !record.amount && !record.notes;
}

/**
 * Save one name's purchase fields. Returns null and deletes the record when
 * the date, amount, and notes are all empty.
 */
export function setPurchase(input: PurchaseInput): DomainPurchase | null {
  const { key, record } = clean(input);
  if (isEmpty(record)) {
    void store.delete(key);
    return null;
  }
  void store.set(key, record);
  return record;
}

/** Upsert many rows. One bad row is reported and the rest still save. */
export function importPurchases(rows: PurchaseInput[]): PurchaseImportResult {
  const errors: string[] = [];
  let updated = 0;
  for (const row of rows) {
    try {
      setPurchase(row);
      updated++;
    } catch (err) {
      const name = row.domainName?.trim() || 'row';
      const message = err instanceof Error ? err.message : 'Invalid row.';
      errors.push(`${name}: ${message}`);
    }
  }
  return { updated, errors };
}
