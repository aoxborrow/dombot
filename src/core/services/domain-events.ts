import { isCurrencyCode } from '../../shared/currencies';
import { isDomainKey, toAscii } from '../../shared/domain-name';
import {
  isDomainEventSource,
  isDomainEventType,
  newEventId,
  type DomainEvent,
  type DomainNote,
} from '../../shared/domain-events';
import { parseCanonicalAmount, parsePurchaseDate } from '../../shared/money';
import { Namespace } from '../storage/namespace';

// Storage for the domain event log and notes (docs/storage-model.md). Both
// are user data: never cleared by "Clear cache", always exported. Events are
// keyed by their time-sortable id and notes by their own id, so each write is
// one small document.

export const EVENTS_NAMESPACE = 'domain-events';
export const NOTES_NAMESPACE = 'domain-notes';

export const MAX_NOTE_LENGTH = 4000;

const events = new Namespace<DomainEvent>(EVENTS_NAMESPACE);
const notes = new Namespace<DomainNote>(NOTES_NAMESPACE);

// ── events ──────────────────────────────────────────────────────────────────

/** Every event, oldest first. */
export function listEvents(): DomainEvent[] {
  return Object.values(events.all()).sort((a, b) => a.id.localeCompare(b.id));
}

/** One name's events, oldest first. */
export function eventsFor(domain: string): DomainEvent[] {
  const key = toAscii(domain);
  return listEvents().filter((e) => e.domain === key);
}

export function getEvent(id: string): DomainEvent | undefined {
  return events.get(id);
}

/** A new event with its id and timestamps filled in (not yet saved). */
export function newEvent(
  fields: Omit<DomainEvent, 'id' | 'createdAt' | 'updatedAt'>,
  now: number = Date.now(),
): DomainEvent {
  return { ...fields, id: newEventId(now), createdAt: now, updatedAt: null };
}

/** Saves events in one store write. */
export function putEvents(list: DomainEvent[]): void {
  void events.setMany(list.map((e) => [e.id, e]));
}

/** Deletes an event and any notes attached to it. */
export function deleteEvent(id: string): void {
  void events.delete(id);
  for (const note of Object.values(notes.all())) {
    if (note.eventId === id) void notes.delete(note.id);
  }
}

// ── notes ───────────────────────────────────────────────────────────────────

/** The note about the name itself (not about one of its events). */
export function nameNote(domain: string): DomainNote | undefined {
  const key = toAscii(domain);
  return Object.values(notes.all()).find(
    (n) => n.domain === key && n.eventId === null,
  );
}

/** Every name's own note text, keyed by `toAscii(name)`. */
export function nameNotes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of Object.values(notes.all())) {
    if (n.eventId === null) out[n.domain] = n.text;
  }
  return out;
}

/** The note to store for a name's new text, or null when nothing changes. */
function nextNameNote(
  existing: DomainNote | undefined,
  domain: string,
  text: string,
  now: number,
): DomainNote | null {
  if (existing?.text === text) return null;
  return existing
    ? { ...existing, text, updatedAt: now }
    : {
        id: newEventId(now),
        domain,
        eventId: null,
        text,
        createdAt: now,
        updatedAt: null,
      };
}

/** Sets the note about a name; blank text deletes it. */
export function setNameNote(domain: string, text: string): void {
  const key = toAscii(domain);
  const trimmed = text.trim().slice(0, MAX_NOTE_LENGTH);
  const existing = nameNote(key);
  if (!trimmed) {
    if (existing) void notes.delete(existing.id);
    return;
  }
  const note = nextNameNote(existing, key, trimmed, Date.now());
  if (note) void notes.set(note.id, note);
}

/** Sets many names' notes in one store write. Blank text is skipped. */
export function setNameNotes(entries: [domain: string, text: string][]): void {
  const now = Date.now();
  const byDomain = new Map(
    Object.values(notes.all())
      .filter((n) => n.eventId === null)
      .map((n) => [n.domain, n]),
  );
  const writes: [string, DomainNote][] = [];
  for (const [domain, text] of entries) {
    const key = toAscii(domain);
    const trimmed = text.trim().slice(0, MAX_NOTE_LENGTH);
    if (!trimmed) continue;
    const note = nextNameNote(byDomain.get(key), key, trimmed, now);
    if (note) {
      byDomain.set(key, note);
      writes.push([note.id, note]);
    }
  }
  void notes.setMany(writes);
}

// ── import validation ───────────────────────────────────────────────────────

const optionalId = (v: unknown) =>
  v === undefined || v === null || typeof v === 'string';

/** An event read from a data bundle, re-checked; null when it doesn't hold. */
export function cleanEvent(id: string, value: unknown): DomainEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const domain = typeof v.domain === 'string' ? toAscii(v.domain) : '';
  if (v.id !== id || !isDomainKey(domain)) return null;
  if (!isDomainEventType(v.type) || !isDomainEventSource(v.source)) return null;
  if (typeof v.createdAt !== 'number') return null;
  if (v.updatedAt !== null && typeof v.updatedAt !== 'number') return null;
  if (!optionalId(v.accountId) || !optionalId(v.fromAccountId)) return null;
  if (!optionalId(v.toAccountId)) return null;
  if (v.resolves !== undefined && typeof v.resolves !== 'string') return null;
  if (v.dismissed !== undefined && typeof v.dismissed !== 'boolean')
    return null;
  let date: string | null;
  try {
    date = v.date === null ? null : parsePurchaseDate(String(v.date), 'Date');
  } catch {
    return null;
  }
  const hasAmount = v.amount !== undefined && v.amount !== null;
  const hasCurrency = v.currency !== undefined && v.currency !== null;
  if (hasAmount !== hasCurrency) return null;
  let amount: string | null = null;
  if (hasAmount) {
    if (!isCurrencyCode(v.currency) || typeof v.amount !== 'string')
      return null;
    try {
      amount = parseCanonicalAmount(v.amount, v.currency);
    } catch {
      return null;
    }
  }
  if (
    v.years !== undefined &&
    v.years !== null &&
    !(Number.isInteger(v.years) && (v.years as number) > 0)
  ) {
    return null;
  }
  return {
    ...(v as unknown as DomainEvent),
    domain,
    date,
    ...(hasAmount ? { amount } : {}),
  };
}

/** A note read from a data bundle, re-checked; null when it doesn't hold. */
export function cleanNote(id: string, value: unknown): DomainNote | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const domain = typeof v.domain === 'string' ? toAscii(v.domain) : '';
  if (v.id !== id || !isDomainKey(domain)) return null;
  if (v.eventId !== null && typeof v.eventId !== 'string') return null;
  if (typeof v.text !== 'string' || !v.text.trim()) return null;
  if (typeof v.createdAt !== 'number') return null;
  if (v.updatedAt !== null && typeof v.updatedAt !== 'number') return null;
  return {
    ...(v as unknown as DomainNote),
    domain,
    text: v.text.trim().slice(0, MAX_NOTE_LENGTH),
  };
}

/** Keeps the entries that pass `clean`, logging the ones dropped. */
export function cleanEntries<T>(
  label: string,
  entries: Record<string, unknown>,
  clean: (id: string, value: unknown) => T | null,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, value] of Object.entries(entries)) {
    const kept = clean(id, value);
    if (kept) out[id] = kept;
    else console.warn(`[${label}] skipping an imported record (${id})`);
  }
  return out;
}
