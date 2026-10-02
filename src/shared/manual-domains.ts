import { toAscii, toUnicode } from './domain-name';
import type { Domain, ManualDomain } from './ipc';

// Manual domains (docs/domain-import-export.md, "Imported names are manual
// domains"): names you own that no connected account reports. They live in
// `manual-domains`, keyed by `toAscii(name)`, and show beside the synced names
// as ordinary rows marked `manual`. Shared so the Domains table, Renewals, the
// pricing map, and later MCP build the same rows.

/** A `YYYY-MM-DD` day as a Date at midnight UTC, or null. */
function day(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** One manual name as a table row. */
export function manualRow(key: string, m: ManualDomain): Domain {
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
    manual: true,
    ...(m.registrar ? {} : { manualRegistrarLabel: m.registrarLabel ?? '' }),
  };
}

/**
 * Rows for the manual names no account reports. A name an account also
 * reports is left out: the registrar's row is the authority (and the next
 * sync removes the manual entry).
 */
export function manualRows(
  manual: Record<string, ManualDomain>,
  synced: Domain[],
): Domain[] {
  const held = new Set(synced.map((d) => toAscii(d.domainName)));
  return Object.entries(manual)
    .filter(([key]) => !held.has(key))
    .map(([key, m]) => manualRow(key, m));
}
