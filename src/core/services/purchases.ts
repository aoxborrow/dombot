import type {
  DomainPurchase,
  PurchaseImportResult,
  PurchaseInput,
  SaleInput,
} from '../../shared/ipc';
import { toCurrencyCode, type CurrencyCode } from '../../shared/currencies';
import { assertDomainName } from '../../shared/domain-name';
import {
  ACQUISITION_TYPES,
  DomainEventSource,
  DomainEventType,
  localDay,
  type DomainEvent,
} from '../../shared/domain-events';
import { parseCanonicalAmount, parsePurchaseDate } from '../../shared/money';
import {
  deleteEvent,
  listEvents,
  nameNotes,
  newEvent,
  putEvents,
  setNameNote,
  setNameNotes,
} from './domain-events';

// What you paid for a name and what you sold it for, read from and written
// to the domain event log. The screens still see one summary per name
// (`DomainPurchase`): the latest purchase or registration, the latest sale
// after it, and the name's note. Editing a purchase or sale changes that
// event in place; recording a buy-back as a new purchase comes with the
// Activity page.

/** Orders events by the day they happened, then by when they were recorded. */
function orderKey(e: DomainEvent): string {
  const day = e.date ?? localDay(e.createdAt);
  return `${day}|${e.id}`;
}

interface Holding {
  acquisition?: DomainEvent;
  sale?: DomainEvent;
}

function holdings(): Map<string, Holding> {
  const out = new Map<string, Holding>();
  const sorted = listEvents().sort((a, b) =>
    orderKey(a).localeCompare(orderKey(b)),
  );
  for (const e of sorted) {
    const h = out.get(e.domain) ?? {};
    if (ACQUISITION_TYPES.has(e.type)) {
      // A newer purchase starts a new holding; an older sale doesn't belong to it.
      h.acquisition = e;
      h.sale = undefined;
    } else if (e.type === DomainEventType.Sold) {
      h.sale = e;
    }
    out.set(e.domain, h);
  }
  return out;
}

function summaryOf(
  h: Holding | undefined,
  notes: string | undefined,
): DomainPurchase | null {
  if (!h?.acquisition && !h?.sale && !notes) return null;
  return {
    purchaseDate: h?.acquisition?.date ?? null,
    amount: h?.acquisition?.amount ?? null,
    currency: h?.acquisition?.currency ?? null,
    notes: notes ?? '',
    saleDate: h?.sale?.date ?? null,
    saleAmount: h?.sale?.amount ?? null,
    saleCurrency: h?.sale?.currency ?? null,
  };
}

/** Every name's purchase summary, keyed by `toAscii(name)`. */
export function getPurchases(): Record<string, DomainPurchase> {
  const all = holdings();
  const notes = nameNotes();
  const out: Record<string, DomainPurchase> = {};
  for (const domain of new Set([...all.keys(), ...Object.keys(notes)])) {
    const summary = summaryOf(all.get(domain), notes[domain]);
    if (summary) out[domain] = summary;
  }
  return out;
}

function purchaseOf(domain: string): DomainPurchase | null {
  return summaryOf(holdings().get(domain), nameNotes()[domain]);
}

function parseAmount(
  raw: string | null | undefined,
  currencyRaw: string | null | undefined,
): { amount: string | null; currency: CurrencyCode | null } {
  const code = currencyRaw?.trim() ? toCurrencyCode(currencyRaw) : null;
  if (currencyRaw?.trim() && !code) {
    throw new Error(`Unknown currency ${currencyRaw.trim().toUpperCase()}.`);
  }
  const rawAmount = (raw ?? '').trim();
  if (!rawAmount) return { amount: null, currency: null };
  if (!code) throw new Error('Choose a currency for the amount.');
  return { amount: parseCanonicalAmount(rawAmount, code), currency: code };
}

/**
 * The event to write for a purchase or sale: the existing one edited, a new
 * one, or null when every field is blank (the existing one is deleted).
 */
function upsert(
  existing: DomainEvent | undefined,
  fields: {
    domain: string;
    type: DomainEvent['type'];
    source: DomainEvent['source'];
    date: string | null;
    amount: string | null;
    currency: CurrencyCode | null;
  },
  now: number,
): DomainEvent | null {
  if (!fields.date && !fields.amount) return null;
  const { domain, type, source, date, amount, currency } = fields;
  if (existing) {
    return { ...existing, type, date, amount, currency, updatedAt: now };
  }
  return newEvent({ domain, type, source, date, amount, currency }, now);
}

/**
 * Save one name's purchase and its note. Blank date and amount delete the
 * purchase; the note and any sale are kept. Returns the name's summary, or
 * null when nothing is left.
 */
export function setPurchase(input: PurchaseInput): DomainPurchase | null {
  const domain = assertDomainName(input.domainName);
  const date = parsePurchaseDate(input.purchaseDate ?? '');
  const { amount, currency } = parseAmount(input.amount, input.currency);
  // Answering an arrival alert records a new holding; otherwise edit the latest.
  const existing = input.resolves
    ? undefined
    : holdings().get(domain)?.acquisition;
  const type =
    input.kind === 'registered'
      ? DomainEventType.Registered
      : input.kind === 'purchased'
        ? DomainEventType.Purchased
        : (existing?.type ?? DomainEventType.Purchased);
  const next = upsert(
    existing,
    { domain, type, source: DomainEventSource.User, date, amount, currency },
    Date.now(),
  );
  if (next) putEvents([withResolves(next, input.resolves)]);
  else if (existing) deleteEvent(existing.id);
  setNameNote(domain, input.notes ?? '');
  return purchaseOf(domain);
}

function withResolves(e: DomainEvent, resolves: string | undefined) {
  return resolves ? { ...e, resolves } : e;
}

/**
 * Save what a name sold for, and its note. Blank date and amount delete the
 * sale; the purchase and note are kept.
 */
export function setSale(input: SaleInput): DomainPurchase | null {
  const domain = assertDomainName(input.domainName);
  const typed = parsePurchaseDate(input.saleDate ?? '', 'Sale date');
  const { amount, currency } = parseAmount(input.amount, input.currency);
  // Marking a name Sold always records the sale, dated today if you left it blank.
  const date = typed ?? (input.mark && !amount ? localDay() : null);
  const existing = holdings().get(domain)?.sale;
  const next = upsert(
    existing,
    {
      domain,
      type: DomainEventType.Sold,
      source: DomainEventSource.User,
      date,
      amount,
      currency,
    },
    Date.now(),
  );
  if (next) putEvents([withResolves(next, input.resolves)]);
  else if (existing) deleteEvent(existing.id);
  setNameNote(domain, input.notes ?? '');
  return purchaseOf(domain);
}

/**
 * Mark names Sold with no price, in one write: each gets a sale dated `date`
 * (today when blank). Each `resolves` closes the sync alert it answers. The
 * price can be added later from the name's row.
 */
export function markSold(
  items: { domainName: string; resolves?: string }[],
  date?: string | null,
): void {
  const day = parsePurchaseDate(date ?? '', 'Sale date') ?? localDay();
  const now = Date.now();
  putEvents(
    items.map((item) =>
      withResolves(
        newEvent(
          {
            domain: assertDomainName(item.domainName),
            type: DomainEventType.Sold,
            source: DomainEventSource.User,
            date: day,
            amount: null,
            currency: null,
          },
          now,
        ),
        item.resolves,
      ),
    ),
  );
}

/**
 * Upsert many purchase rows with one write for the events and one for the
 * notes. One bad row is reported and the rest still save; a later row for the
 * same name wins. A row's note replaces the name's note only when it has one,
 * and a row with a blank date and amount leaves the purchase alone.
 */
export function importPurchases(rows: PurchaseInput[]): PurchaseImportResult {
  const errors: string[] = [];
  const current = holdings();
  const writes = new Map<string, DomainEvent>();
  const noteWrites = new Map<string, string>();
  const now = Date.now();
  let updated = 0;
  for (const row of rows) {
    try {
      const domain = assertDomainName(row.domainName);
      const date = parsePurchaseDate(row.purchaseDate ?? '');
      const { amount, currency } = parseAmount(row.amount, row.currency);
      const existing = writes.get(domain) ?? current.get(domain)?.acquisition;
      const next = upsert(
        existing,
        {
          domain,
          type: existing?.type ?? DomainEventType.Purchased,
          source: existing?.source ?? DomainEventSource.Import,
          date,
          amount,
          currency,
        },
        now,
      );
      if (next) writes.set(domain, next);
      if (row.notes?.trim()) noteWrites.set(domain, row.notes);
      updated++;
    } catch (err) {
      const name = row.domainName?.trim() || 'row';
      const message = err instanceof Error ? err.message : 'Invalid row.';
      errors.push(`${name}: ${message}`);
    }
  }
  putEvents([...writes.values()]);
  setNameNotes([...noteWrites]);
  return { updated, errors };
}
