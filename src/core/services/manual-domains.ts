import { registrars } from '@aoxborrow/registrar-client';
import type { ManualDomain, ManualDomainFields } from '../../shared/ipc';
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

// Manual domains (docs/domain-import-export.md): names you own that no
// connected account reports, keyed by `toAscii(name)`. User data: never
// cleared by "Clear cache", always exported. Folders, prices, notes, and
// events are keyed by name too, so they need nothing extra here; when an
// account later reports the name, sync takes it over (`takeOverManual`).

export const MANUAL_DOMAINS_NAMESPACE = 'manual-domains';

const manual = new Namespace<ManualDomain>(MANUAL_DOMAINS_NAMESPACE);

const MAX_LABEL = 100;

/** Every manual name, keyed by `toAscii(name)`. */
export function getManualDomains(): Record<string, ManualDomain> {
  return manual.all();
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
  fields: Partial<ManualDomainFields>,
): Partial<ManualDomainFields> {
  const out: Partial<ManualDomainFields> = {};
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
 * Adds names as manual domains, in one write each for the entries and their
 * events. Each writes `added`, an open review like a sync arrival (it asks
 * what you paid). A name with an open "removed" review is coming back, not
 * new: its `added` closes that review and is written already dismissed, as
 * sync does. A name that's already manual is left alone. Returns the names
 * added.
 */
export function addManualDomains(
  items: { domainName: string; fields?: Partial<ManualDomainFields> }[],
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

  const entries: [string, ManualDomain][] = [];
  const added: DomainEvent[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = assertDomainName(item.domainName);
    if (seen.has(key) || manual.get(key)) continue;
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
  void manual.setMany(entries);
  putEvents(added);
  return entries.map(([key]) => key);
}

/** Edits a manual name's registration fields. Throws for a name that isn't manual. */
export function updateManualDomain(
  domainName: string,
  fields: Partial<ManualDomainFields>,
): ManualDomain {
  const key = assertDomainName(domainName);
  const existing = manual.get(key);
  if (!existing) throw new Error(`${key} isn't a manual domain.`);
  const next: ManualDomain = {
    ...existing,
    ...cleanFields(fields),
    updatedAt: Date.now(),
  };
  void manual.set(key, next);
  return next;
}

/** Removes names' manual entries (Delete, or an account taking them over). */
export function removeManualDomains(domains: string[]): void {
  for (const domain of domains) {
    const key = toAscii(domain);
    if (manual.get(key)) void manual.delete(key);
  }
}

/**
 * Names an account now reports stop being manual: the entry goes, and a
 * `moved` from no account to that account is returned for the sync to
 * record ("Now synced from Dynadot"). It's info, not a new arrival.
 */
export function takeOverManual(
  reported: { accountId: string; names: string[] }[],
  now: number,
): { events: DomainEvent[]; names: Set<string> } {
  const events: DomainEvent[] = [];
  const names = new Set<string>();
  for (const { accountId, names: list } of reported) {
    for (const raw of list) {
      const key = toAscii(raw);
      if (names.has(key) || !manual.get(key)) continue;
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
  removeManualDomains([...names]);
  return { events, names };
}

/** A manual domain read from a data bundle, re-checked; null when it doesn't hold. */
export function cleanManualDomain(
  key: string,
  value: unknown,
): ManualDomain | null {
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
