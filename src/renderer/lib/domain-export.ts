import { domainKey } from '../../shared/account-key';
import { toAscii } from '../../shared/domain-name';
import { domainsCsvFilename, domainsToCsv } from '../../shared/domain-csv';
import type { Domain } from '../../shared/ipc';
import { manualRows } from '../../shared/manual-domains';
import { ownershipByDomain } from '../../shared/ownership';
import { useAppStore } from '../store/app';
import { accountName, archiveRows } from './domain-history';

// "Export all domains" from outside the Domains page (Settings → Sync): the
// same rows the page lists, Owned and Archive, in the DomBot CSV.

/** Every name DomBot lists: synced (with any loaded detail), manual, and Archive. */
export function allDomainRows(): Domain[] {
  const s = useAppStore.getState();
  const synced = s.portfolio.map((d) =>
    s.enriched[domainKey(d)]
      ? {
          ...s.enriched[domainKey(d)],
          accountId: d.accountId,
          accountLabel: d.accountLabel,
        }
      : d,
  );
  const manual = manualRows(s.manualDomains, s.portfolio);
  const ownership = ownershipByDomain(s.domainEvents);
  return [
    ...synced,
    ...manual,
    ...archiveRows(ownership, [...s.portfolio, ...manual], s.registrars),
  ].sort((a, b) => toAscii(a.domainName).localeCompare(toAscii(b.domainName)));
}

/** Saves every name as a DomBot CSV. Returns the number of names, or null if cancelled. */
export async function exportAllDomains(): Promise<number | null> {
  const s = useAppStore.getState();
  const rows = allDomainRows();
  const ownership = ownershipByDomain(s.domainEvents);
  const csv = domainsToCsv(rows, {
    registrarLabels: s.portfolioRegistrarLabels,
    folders: s.folders,
    assignments: s.folderAssignments,
    purchases: s.purchases,
    listPrices: s.listPrices,
    pricing: s.pricing,
    manualPrices: await window.api.getManualPrices(),
    archiveLabel: (name) => ownership.get(name)?.label ?? null,
    accountName: (d) =>
      accountName(s.registrars, d.accountId ?? d.registrar) ??
      s.portfolioRegistrarLabels[d.registrar] ??
      d.registrar,
  });
  const result = await window.api.saveTextFile(csv, domainsCsvFilename());
  return result.saved
    ? new Set(rows.map((d) => toAscii(d.domainName))).size
    : null;
}
