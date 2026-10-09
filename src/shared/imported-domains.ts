import { toAscii, toUnicode } from './domain-name';
import type { Domain, ImportedDomain } from './ipc';

// Imported domains (docs/domain-import-export.md, "Imported domains"): names
// you own that no connected account reports. They live in
// `imported-domains`, keyed by `toAscii(name)`, and show beside the synced names
// as ordinary rows with `source: 'imported'`. Shared so the Domains table, Renewals, the
// pricing map, and later MCP build the same rows.

/** A `YYYY-MM-DD` day as a Date at midnight UTC, or null. */
function day(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** One imported name as a table row. */
export function importedRow(key: string, m: ImportedDomain): Domain {
  return {
    domainName: toUnicode(key),
    registrar: m.registrar ?? '',
    status: '',
    createdDate: day(m.createdDate),
    expirationDate: day(m.expirationDate),
    renewalDate: null,
    autoRenew: m.autoRenew ?? false,
    locked: false,
    privacy: false,
    nameservers: [],
    syncedAt: new Date(m.updatedAt ?? m.addedAt),
    deleted: false,
    source: 'imported',
    ...(m.registrar ? {} : { importedRegistrarLabel: m.registrarLabel ?? '' }),
    ...(m.autoRenew == null ? { autoRenewUnknown: true } : {}),
  };
}

/**
 * Rows for the imported names no account reports. A name an account also
 * reports is left out: the registrar's row is the authority (and the next
 * sync removes the imported entry).
 */
export function importedRows(
  imported: Record<string, ImportedDomain>,
  synced: Domain[],
): Domain[] {
  const held = new Set(synced.map((d) => toAscii(d.domainName)));
  return Object.entries(imported)
    .filter(([key]) => !held.has(key))
    .map(([key, m]) => importedRow(key, m));
}
