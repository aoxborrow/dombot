import { assertDomainName } from '../../shared/domain-name';
import type { ManualArchiveReason } from '../../shared/ownership';
import { Namespace } from '../storage/namespace';

// Names you put in Archive yourself: dropped, or archived with no reason.
// Kept apart from the event log because the old `dropped` and `archived`
// event types are stripped on import (storage/migrations.ts). A name an
// account still lists, or one you added by hand, stays in Owned until one
// of these is set (shared/ownership.ts). Not cache: you wrote it.

const store = new Namespace<ManualArchiveReason>('manual-archive');

function isReason(value: unknown): value is ManualArchiveReason {
  return value === 'dropped' || value === 'archived';
}

/** Every hand mark, keyed by the normalized domain name. */
export function getManualArchives(): Record<string, ManualArchiveReason> {
  const out: Record<string, ManualArchiveReason> = {};
  for (const [key, value] of Object.entries(store.all())) {
    if (isReason(value)) out[key] = value;
  }
  return out;
}

/** The hand mark on one name, or null. */
export function manualArchiveOf(
  domainName: string,
): ManualArchiveReason | null {
  const value = store.get(assertDomainName(domainName));
  return isReason(value) ? value : null;
}

/**
 * Marks names dropped or archived, or clears the mark with null. Nothing
 * changes at the registrar.
 */
export function setManualArchive(
  domainNames: string[],
  reason: ManualArchiveReason | null,
): void {
  const keys = domainNames.map((name) => assertDomainName(name));
  if (reason === null) {
    for (const key of keys) void store.delete(key);
    return;
  }
  void store.setMany(keys.map((key) => [key, reason]));
}
