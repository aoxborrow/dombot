// Builds the Domains-page CSV export. Kept separate from the page component so
// the column model and formatting are easy to read and test in isolation.

import {
  HIDDEN_FOLDER_ID,
  type Domain,
  type Folder,
} from '../../shared/ipc';

/** id → nicely capitalized registrar name, e.g. dynadot → "Dynadot". */
type RegistrarLabels = Record<string, string>;

/** Everything after the first dot, e.g. "example.co.uk" → "co.uk". */
function tldOf(domainName: string): string {
  const dot = domainName.indexOf('.');
  return dot === -1 ? '' : domainName.slice(dot + 1).toLowerCase();
}

/**
 * ISO date (YYYY-MM-DD), the format Excel and Google Sheets both parse as a real
 * date regardless of locale. Empty string for a missing/invalid date so the
 * spreadsheet cell is simply blank.
 */
function isoDate(date: Date | null): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const t = d.getTime();
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

/** Whole days until expiry (negative once expired); empty when there's no date. */
function daysUntil(date: Date | null): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const t = d.getTime();
  if (Number.isNaN(t)) return '';
  return String(Math.round((t - Date.now()) / 86_400_000));
}

/** Quote a field per RFC 4180: wrap in quotes and double any embedded quote when
 *  the value contains a comma, quote, or newline. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

interface CsvColumn {
  header: string;
  value: (
    d: Domain,
    labels: RegistrarLabels,
    folderName: (d: Domain) => string,
  ) => string;
}

/** The exported columns, in order. Every value is a plain string. */
const CSV_COLUMNS: CsvColumn[] = [
  { header: 'Domain', value: (d) => d.domainName },
  { header: 'TLD', value: (d) => tldOf(d.domainName) },
  {
    header: 'Registrar',
    value: (d, labels) => labels[d.registrar] ?? d.registrar,
  },
  {
    header: 'Folder',
    value: (d, _labels, folderName) => folderName(d),
  },
  { header: 'Status', value: (d) => d.status },
  { header: 'Created', value: (d) => isoDate(d.createdDate) },
  { header: 'Expires', value: (d) => isoDate(d.expirationDate) },
  { header: 'Days Until Expiry', value: (d) => daysUntil(d.expirationDate) },
  { header: 'Renewal Date', value: (d) => isoDate(d.renewalDate) },
  { header: 'Auto Renew', value: (d) => (d.autoRenew ? 'Yes' : 'No') },
  { header: 'Locked', value: (d) => (d.locked ? 'Yes' : 'No') },
  { header: 'Privacy', value: (d) => (d.privacy ? 'Yes' : 'No') },
  { header: 'Nameservers', value: (d) => d.nameservers.join('; ') },
  { header: 'Last Synced', value: (d) => isoDate(d.syncedAt) },
];

/**
 * Serializes the given domains (already filtered + sorted by the caller) to a
 * CSV string. Uses CRLF line endings per RFC 4180 for the widest spreadsheet
 * compatibility.
 */
export function domainsToCsv(
  domains: Domain[],
  labels: RegistrarLabels,
  folders: Folder[],
  assignments: Record<string, string>,
): string {
  const nameById = new Map(folders.map((f) => [f.id, f.name]));
  // The assigned folder's name, "Hidden" for the built-in hidden folder, or
  // empty when unassigned or the folder is gone.
  const folderName = (d: Domain): string => {
    const id = assignments[`${d.registrar}:${d.domainName}`];
    if (id === HIDDEN_FOLDER_ID) return 'Hidden';
    return nameById.get(id ?? '') ?? '';
  };

  const rows: string[] = [CSV_COLUMNS.map((c) => csvField(c.header)).join(',')];
  for (const d of domains) {
    rows.push(
      CSV_COLUMNS.map((c) => csvField(c.value(d, labels, folderName))).join(','),
    );
  }
  return rows.join('\r\n');
}

/** Timestamped default filename, e.g. "dombot-domains-2026-08-30.csv". */
export function csvFilename(): string {
  return `dombot-domains-${new Date().toISOString().slice(0, 10)}.csv`;
}
