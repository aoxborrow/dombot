import type {
  DomainPurchase,
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
  type UserSource,
} from '../../shared/domain-events';
import { parseCanonicalAmount, parsePurchaseDate } from '../../shared/money';
import {
  deleteEvent,
  listEvents,
  nameNotes,
  newEvent,
  putEvents,
  setNameNote,
  currentLabel,
  replaceLabel,
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

export interface Holding {
  acquisition?: DomainEvent;
  sale?: DomainEvent;
}

export function holdings(): Map<string, Holding> {
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
  const acquired = h?.acquisition;
  return {
    ...(acquired ? { acquisitionId: acquired.id } : {}),
    purchaseDate: acquired?.date ?? null,
    amount: acquired?.amount ?? null,
    currency: acquired?.currency ?? null,
    ...(acquired
      ? {
          purchaseType:
            acquired.type === DomainEventType.Registered
              ? ('registered' as const)
              : ('purchased' as const),
        }
      : {}),
    ...(acquired?.years ? { purchaseYears: acquired.years } : {}),
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
 * null when nothing is left. `source` is `agent` when an MCP client asked.
 */
export function setPurchase(
  input: PurchaseInput,
  source: UserSource = DomainEventSource.User,
): DomainPurchase | null {
  const domain = assertDomainName(input.domainName);
  const date = parsePurchaseDate(input.purchaseDate ?? '');
  const { amount, currency } = parseAmount(input.amount, input.currency);
  // Answering an arrival alert records a new holding, unless a purchase was
  // already recorded since the name arrived (an import, or the Domains row):
  // then it edits that one instead of adding a second. Otherwise edit the
  // latest.
  const latest = holdings().get(domain)?.acquisition;
  const existing = input.resolves
    ? latest && latest.id > input.resolves
      ? latest
      : undefined
    : latest;
  const type =
    input.kind === 'registered'
      ? DomainEventType.Registered
      : input.kind === 'purchased'
        ? DomainEventType.Purchased
        : (existing?.type ?? DomainEventType.Purchased);
  const next = upsert(
    existing,
    { domain, type, source, date, amount, currency },
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
 * Save a name's note on its own, leaving its purchase and sale as they are.
 * A blank note deletes it.
 */
export function setNotes(
  domainName: string,
  notes: string,
): DomainPurchase | null {
  const domain = assertDomainName(domainName);
  setNameNote(domain, notes);
  return purchaseOf(domain);
}

/**
 * Save what a name sold for, and its note. Blank date and amount delete the
 * sale; the purchase and note are kept. `source` as for setPurchase.
 */
export function setSale(
  input: SaleInput,
  source: UserSource = DomainEventSource.User,
): DomainPurchase | null {
  const domain = assertDomainName(input.domainName);
  const typed = parsePurchaseDate(input.saleDate ?? '', 'Sale date');
  const { amount, currency } = parseAmount(input.amount, input.currency);
  // Marking a name Sold always records the sale, dated today if you left it blank.
  const date = typed ?? (input.mark && !amount ? localDay() : null);
  // Marking Sold, or answering an alert, records a new sale: a name that was
  // sold, left, and came back keeps its earlier sale as history. Marking
  // replaces the Dropped or Archived label you'd set (see replaceLabel).
  const replaced = input.mark ? replaceLabel(domain) : undefined;
  const resolves = input.resolves ?? replaced?.resolves;
  const existing =
    input.mark || input.resolves ? undefined : holdings().get(domain)?.sale;
  const next = upsert(
    existing,
    { domain, type: DomainEventType.Sold, source, date, amount, currency },
    Date.now(),
  );
  if (next) putEvents([withResolves(next, resolves)]);
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
  const sales: DomainEvent[] = [];
  for (const item of items) {
    const domain = assertDomainName(item.domainName);
    // Already Sold: left as is. Labeled otherwise: Sold takes its place.
    if (currentLabel(domain) === 'sold') continue;
    const replaced = replaceLabel(domain);
    sales.push(
      withResolves(
        newEvent(
          {
            domain,
            type: DomainEventType.Sold,
            source: DomainEventSource.User,
            date: day,
            amount: null,
            currency: null,
          },
          now,
        ),
        item.resolves ?? replaced.resolves,
      ),
    );
  }
  putEvents(sales);
}
