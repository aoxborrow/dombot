import { registrars } from '@aoxborrow/registrar-client';
import type { ImportedDomain, ImportedDomainFields } from '../../shared/ipc';
import {
  assertDomainName,
  isDomainKey,
  toAscii,
} from '../../shared/domain-name';
import {
  DomainEventSource,
  DomainEventType,
  localDay,
  type DomainEvent,
} from '../../shared/domain-events';
import { isOpenAlert, resolvedIds } from '../../shared/sync-diff';
import { parsePurchaseDate } from '../../shared/money';
import { Namespace } from '../storage/namespace';
import { listEvents, newEvent, putEvents } from './domain-events';

// Imported domains (docs/domain-import-export.md): names you own that no
// connected account reports, keyed by `toAscii(name)`. User data: never
// cleared by "Clear cache", always exported. Folders, prices, notes, and
// events are keyed by name too, so they need nothing extra here; when an
// account later reports the name, sync takes it over (`takeOverImported`).

export const IMPORTED_DOMAINS_NAMESPACE = 'imported-domains';

const store = new Namespace<ImportedDomain>(IMPORTED_DOMAINS_NAMESPACE);

const MAX_LABEL = 100;

/** Every imported name, keyed by `toAscii(name)`. */
export function getImportedDomains(): Record<string, ImportedDomain> {
  return store.all();
}

/** True when `id` is a registrar DomBot knows. */
export function isKnownRegistrar(id: unknown): id is string {
  return typeof id === 'string' && Object.hasOwn(registrars, id);
}

/**
 * Registration fields checked and in stored form. A known registrar clears
 * the free-text label; an unknown one keeps it. Throws when a field doesn't
 * hold.
 */
export function cleanFields(
  fields: Partial<ImportedDomainFields>,
): Partial<ImportedDomainFields> {
  const out: Partial<ImportedDomainFields> = {};
  if (fields.registrar !== undefined) {
    if (fields.registrar !== null && !isKnownRegistrar(fields.registrar))
      throw new Error(`Unknown registrar ${fields.registrar}.`);
    out.registrar = fields.registrar;
    if (fields.registrar) out.registrarLabel = null;
  }
  if (fields.registrarLabel !== undefined && !out.registrar) {
    const label = fields.registrarLabel?.trim().slice(0, MAX_LABEL) || null;
    out.registrarLabel = label;
  }
  if (fields.createdDate !== undefined)
    out.createdDate = parsePurchaseDate(
      fields.createdDate ?? '',
      'Registration date',
    );
  if (fields.expirationDate !== undefined)
    out.expirationDate = parsePurchaseDate(
      fields.expirationDate ?? '',
      'Expiration date',
    );
  if (fields.autoRenew !== undefined) out.autoRenew = fields.autoRenew;
  return out;
}

/**
 * Adds names as imported domains, in one write each for the entries and their
 * events. Each writes `added`, an open review like a sync arrival (it asks
 * what you paid). A name with an open "removed" review is coming back, not
 * new: its `added` closes that review and is written already dismissed, as
 * sync does. A name that's already imported is left alone. Returns the names
 * added.
 */
export function addImportedDomains(
  items: { domainName: string; fields?: Partial<ImportedDomainFields> }[],
  options: {
    source: typeof DomainEventSource.User | typeof DomainEventSource.Import;
    importId?: string;
  },
  now: number = Date.now(),
): string[] {
  const events = listEvents();
  const resolved = resolvedIds(events);
  const openRemoval = new Map<string, string>();
  for (const e of events)
    if (e.type === DomainEventType.Removed && isOpenAlert(e, resolved))
      openRemoval.set(e.domain, e.id);

  const entries: [string, ImportedDomain][] = [];
  const added: DomainEvent[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = assertDomainName(item.domainName);
    if (seen.has(key) || store.get(key)) continue;
    seen.add(key);
    const fields = cleanFields(item.fields ?? {});
    entries.push([
      key,
      {
        registrar: fields.registrar ?? null,
        registrarLabel: fields.registrarLabel ?? null,
        createdDate: fields.createdDate ?? null,
        expirationDate: fields.expirationDate ?? null,
        autoRenew: fields.autoRenew ?? null,
        addedAt: now,
        updatedAt: null,
        ...(options.importId ? { importId: options.importId } : {}),
      },
    ]);
    const removal = openRemoval.get(key);
    added.push(
      newEvent(
        {
          domain: key,
          type: DomainEventType.Added,
          source: options.source,
          date: localDay(now),
          accountId: null,
          ...(removal ? { resolves: removal, dismissed: true } : {}),
          ...(options.importId ? { importId: options.importId } : {}),
        },
        now,
      ),
    );
  }
  void store.setMany(entries);
  putEvents(added);
  return entries.map(([key]) => key);
}

/** Writes imported entries in one write (an import's new and edited names). */
export function putImportedDomains(entries: [string, ImportedDomain][]): void {
  if (entries.length > 0) void store.setMany(entries);
}

/** Edits an imported name's registration fields. Throws for a name that isn't imported. */
export function updateImportedDomain(
  domainName: string,
  fields: Partial<ImportedDomainFields>,
): ImportedDomain {
  const key = assertDomainName(domainName);
  const existing = store.get(key);
  if (!existing) throw new Error(`${key} isn't an imported domain.`);
  const next: ImportedDomain = {
    ...existing,
    ...cleanFields(fields),
    updatedAt: Date.now(),
  };
  void store.set(key, next);
  return next;
}

/** Removes names' imported entries (Delete, or an account taking them over). */
export function removeImportedDomains(domains: string[]): void {
  for (const domain of domains) {
    const key = toAscii(domain);
    if (store.get(key)) void store.delete(key);
  }
}

/**
 * Names an account now reports stop being imported: the entry goes, and a
 * `moved` from no account to that account is returned for the sync to
 * record ("Now synced from Dynadot"). It's info, not a new arrival.
 */
export function takeOverImported(
  reported: { accountId: string; names: string[] }[],
  now: number,
): { events: DomainEvent[]; names: Set<string> } {
  const events: DomainEvent[] = [];
  const names = new Set<string>();
  for (const { accountId, names: list } of reported) {
    for (const raw of list) {
      const key = toAscii(raw);
      if (names.has(key) || !store.get(key)) continue;
      names.add(key);
      events.push(
        newEvent(
          {
            domain: key,
            type: DomainEventType.Moved,
            source: DomainEventSource.Sync,
            date: localDay(now),
            fromAccountId: null,
            toAccountId: accountId,
          },
          now,
        ),
      );
    }
  }
  removeImportedDomains([...names]);
  return { events, names };
}

/** An imported domain read from a data bundle, re-checked; null when it doesn't hold. */
export function cleanImportedDomain(
  key: string,
  value: unknown,
): ImportedDomain | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!isDomainKey(key) || toAscii(key) !== key) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.addedAt !== 'number') return null;
  if (v.updatedAt !== null && typeof v.updatedAt !== 'number') return null;
  const text = (x: unknown) => (typeof x === 'string' ? x : null);
  try {
    const fields = cleanFields({
      registrar: isKnownRegistrar(v.registrar) ? v.registrar : null,
      registrarLabel: text(v.registrarLabel),
      createdDate: text(v.createdDate),
      expirationDate: text(v.expirationDate),
      autoRenew: typeof v.autoRenew === 'boolean' ? v.autoRenew : null,
    });
    return {
      registrar: fields.registrar ?? null,
      registrarLabel: fields.registrarLabel ?? null,
      createdDate: fields.createdDate ?? null,
      expirationDate: fields.expirationDate ?? null,
      autoRenew: fields.autoRenew ?? null,
      addedAt: v.addedAt,
      updatedAt: (v.updatedAt as number | null) ?? null,
      ...(typeof v.importId === 'string' ? { importId: v.importId } : {}),
    };
  } catch {
    return null;
  }
}
