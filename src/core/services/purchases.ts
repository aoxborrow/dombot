import type {
  DomainPurchase,
  PurchaseImportResult,
  PurchaseInput,
  SaleInput,
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
  const { amount, currency } = parseAmount(input.amount, input.currency);
  return {
    key,
    record: {
      purchaseDate,
      amount,
      currency,
      notes,
      ...keptSale(store.get(key)),
    },
  };
}

function keptSale(
  existing: DomainPurchase | undefined,
): Pick<DomainPurchase, 'saleDate' | 'saleAmount' | 'saleCurrency'> {
  return {
    saleDate: existing?.saleDate ?? null,
    saleAmount: existing?.saleAmount ?? null,
    saleCurrency: existing?.saleCurrency ?? null,
  };
}

function parseAmount(
  raw: string | null | undefined,
  currencyRaw: string | null | undefined,
): { amount: string | null; currency: string | null } {
  const currencyCode = currencyRaw ? currencyInfo(currencyRaw)?.code : null;
  if (currencyRaw?.trim() && !currencyCode) {
    throw new Error(`Unknown currency ${currencyRaw.trim().toUpperCase()}.`);
  }
  const rawAmount = (raw ?? '').trim();
  if (!rawAmount) return { amount: null, currency: null };
  if (!currencyCode) throw new Error('Choose a currency for the amount.');
  return {
    amount: parseCanonicalAmount(rawAmount, currencyCode),
    currency: currencyCode,
  };
}

function isEmpty(record: DomainPurchase): boolean {
  return (
    !record.purchaseDate &&
    !record.amount &&
    !record.notes &&
    !record.saleDate &&
    !record.saleAmount
  );
}

/**
 * Save one name's purchase fields. Returns null and deletes the record when
 * the purchase fields, sale fields, and notes are all empty. A sale already
 * stored on the name is left in place.
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

/**
 * Save what a sold name went for, plus the shared notes. What you paid stays.
 * Returns null and deletes the record only when nothing is left on it.
 */
export function setSale(input: SaleInput): DomainPurchase | null {
  const key = assertDomainName(input.domainName);
  const saleDate = parsePurchaseDate(input.saleDate ?? '', 'Sale date');
  const notes = (input.notes ?? '').trim().slice(0, MAX_NOTES);
  const { amount, currency } = parseAmount(input.amount, input.currency);
  const existing = store.get(key);
  const record: DomainPurchase = {
    purchaseDate: existing?.purchaseDate ?? null,
    amount: existing?.amount ?? null,
    currency: existing?.currency ?? null,
    notes,
    saleDate,
    saleAmount: amount,
    saleCurrency: currency,
  };
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
