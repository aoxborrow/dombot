import { accountTitle } from '../../shared/account-label';
import type { Domain, RegistrarName } from '../../shared/ipc';
import {
  ImportedRegistrarIcon,
  RegistrarLogo,
} from '../components/RegistrarLogo';
import type { FilterOption } from '../components/data-table/Toolbar';

// The Registrar filter, shared by Domains and Renewals: one option per
// account, then the registrars you gave imported names.

type RegistrarLabels = Record<string, string>;

/** A registrar's display name, falling back to its raw id. */
function registrarLabel(id: string, labels: RegistrarLabels): string {
  return labels[id] ?? id;
}

/**
 * Registrar filter value for a name you added that no account reports: one
 * per registrar name (so a known "gandi" and a typed "Gandi.net" meet), and
 * "imported:" alone for names with no registrar (Unknown).
 */
export function importedRegistrarValue(label: string): string {
  return `imported:${label.trim().toLowerCase()}`;
}

/** An imported name's registrar as shown: DomBot's name for it, or your text. */
export function importedRegistrarName(
  d: Domain,
  labels: RegistrarLabels,
): string {
  return d.registrar
    ? registrarLabel(d.registrar, labels)
    : (d.importedRegistrarLabel ?? '');
}

/** The Registrar filter option a row belongs to. */
export function registrarFilterValue(d: Domain, labels: RegistrarLabels) {
  return d.source === 'imported'
    ? importedRegistrarValue(importedRegistrarName(d, labels))
    : (d.accountId ?? d.registrar);
}

/**
 * One option per account (keyed by account id), so accounts of the same
 * registrar can be filtered apart or, by multi-selecting, together. Labelled
 * "Registrar · nickname" / "Registrar #2" / "Registrar". Then, past a line,
 * the names you added, by the registrar you gave them (a faint building, no
 * logo, as no account backs them), with Unknown last. Counts are over `rows`.
 */
export function registrarFilterOptions(
  rows: Domain[],
  labels: RegistrarLabels,
  multipleAccounts: ReadonlySet<string>,
): FilterOption[] {
  const acc = new Map<
    string,
    { label: string; registrar: string; count: number }
  >();
  const imported = new Map<string, { label: string; count: number }>();
  for (const d of rows) {
    if (d.source === 'imported') {
      const label = importedRegistrarName(d, labels);
      const value = importedRegistrarValue(label);
      const existing = imported.get(value);
      if (existing) existing.count += 1;
      else imported.set(value, { label: label || 'Unknown', count: 1 });
      continue;
    }
    const value = d.accountId ?? d.registrar;
    const existing = acc.get(value);
    if (existing) existing.count += 1;
    else
      acc.set(value, {
        label: accountTitle(
          registrarLabel(d.registrar, labels),
          d.accountLabel,
          multipleAccounts.has(d.registrar),
        ),
        registrar: d.registrar,
        count: 1,
      });
  }
  const accounts: FilterOption[] = Array.from(acc, ([value, v]) => ({
    value,
    label: v.label,
    count: v.count,
    icon: (
      <RegistrarLogo
        name={v.registrar as RegistrarName}
        label={v.label}
        className="size-4"
      />
    ),
  })).sort((a, b) => a.label.localeCompare(b.label));
  const unknown = importedRegistrarValue('');
  const added: FilterOption[] = Array.from(imported, ([value, v]) => ({
    value,
    label: v.label,
    count: v.count,
    icon: <ImportedRegistrarIcon />,
  })).sort(
    (a, b) =>
      Number(a.value === unknown) - Number(b.value === unknown) ||
      a.label.localeCompare(b.label),
  );
  if (accounts.length > 0 && added.length > 0) added[0].divider = true;
  return [...accounts, ...added];
}
