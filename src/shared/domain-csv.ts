import { domainKey } from './account-key';
import { CURRENCIES, isCurrencyCode } from './currencies';
import { toCsv } from './csv';
import { isIdn, toAscii, toUnicode } from './domain-name';
import {
  builtInFolderName,
  type AskingPrice,
  type Domain,
  type DomainPurchase,
  type Folder,
  type RenewalPriceInput,
  type RenewalPricing,
} from './ipc';
import type { ArchiveLabel } from './ownership';

// The DomBot CSV (docs/domain-import-export.md, "The DomBot CSV format"): one
// row per name, every column DomBot has about it. Export writes one spelling
// of everything; the importer reads these headers back, so a file DomBot
// exported imports into the same state. Headers are part of that contract:
// rename one and older files stop matching.

/** What the export needs besides the rows themselves. */
export interface DomainCsvContext {
  /** Registrar id → display name ("dynadot" → "Dynadot"). */
  registrarLabels: Record<string, string>;
  folders: Folder[];
  /** `toAscii(name)` → folder id. */
  assignments: Record<string, string>;
  /** `toAscii(name)` → the purchase and sale summary (`getPurchases`). */
  purchases: Record<string, DomainPurchase>;
  /** `toAscii(name)` → asking price. */
  askingPrices: Record<string, AskingPrice>;
  /** `domainKey(row)` → renewal pricing (for the estimate). */
  pricing: Record<string, RenewalPricing>;
  /**
   * `toAscii(name)` → your renewal price (`getManualPrices`). Keyed by name so
   * Archive names, which have no pricing entry, keep theirs.
   */
  manualPrices: Record<string, RenewalPriceInput>;
  /** Why a name is in Archive, or null while you own it. */
  archiveLabel: (name: string) => ArchiveLabel | null;
  /** The account a row comes from, as DomBot names it ("Dynadot #2"). */
  accountName: (row: Domain) => string;
  /** For "Days until expiry"; defaults to now. */
  now?: number;
}

/** One name's rows (two when two accounts hold it) and what DomBot knows. */
interface NameRow {
  /** The row the registrar columns come from: the most recently synced. */
  domain: Domain;
  accounts: string[];
  key: string;
  ctx: DomainCsvContext;
}

export interface DomainCsvColumn {
  header: string;
  /** Read back by the importer. Export-only columns are ignored there. */
  importable: boolean;
  /** Holds a number: no formula guard, so a minus sign stays a sign. */
  numeric?: boolean;
  value: (row: NameRow) => string;
}

const STATUS: Record<ArchiveLabel, string> = {
  sold: 'Sold',
  dropped: 'Dropped',
  archived: 'Archived',
  removed: 'Removed',
};

const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

/** `YYYY-MM-DD` for a date, or blank. */
function isoDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const t = (date instanceof Date ? date : new Date(date)).getTime();
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

function tldOf(name: string): string {
  const dot = name.indexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** A price as a stored decimal: the currency's decimal places, no grouping. */
function decimal(n: number, currency: string): string {
  const places = isCurrencyCode(currency) ? CURRENCIES[currency] : 2;
  return n.toFixed(places);
}

/** Registrar columns are blank for a name no account holds any more. */
const held = (r: NameRow) => !r.domain.departed;
const registration = (r: NameRow, value: () => string) =>
  r.domain.unregistered ? '' : value();

const purchase = (r: NameRow) => r.ctx.purchases[r.key];
const asking = (r: NameRow) => r.ctx.askingPrices[r.key];
const pricing = (r: NameRow) => r.ctx.pricing[domainKey(r.domain)];
const manualPrice = (r: NameRow) => r.ctx.manualPrices[r.key];

/** The columns, in file order (see the plan's "Columns" table). */
export const DOMAIN_CSV_COLUMNS: DomainCsvColumn[] = [
  { header: 'Domain', importable: true, value: (r) => r.key },
  {
    header: 'IDN',
    importable: true,
    value: (r) => (isIdn(r.key) ? toUnicode(r.key) : ''),
  },
  {
    header: 'Status',
    importable: true,
    value: (r) => {
      const label = r.ctx.archiveLabel(r.key);
      return label ? STATUS[label] : 'Owned';
    },
  },
  {
    header: 'Folder',
    importable: true,
    value: (r) => {
      const id = r.ctx.assignments[r.key];
      if (!id) return '';
      return (
        builtInFolderName(id) ??
        r.ctx.folders.find((f) => f.id === id)?.name ??
        ''
      );
    },
  },
  {
    header: 'Registrar',
    importable: true,
    value: (r) =>
      registration(
        r,
        () =>
          r.domain.registrationRegistrar ??
          r.ctx.registrarLabels[r.domain.registrar] ??
          r.domain.registrar,
      ),
  },
  { header: 'Account', importable: false, value: (r) => r.accounts.join('; ') },
  {
    header: 'Created',
    importable: true,
    value: (r) => registration(r, () => isoDate(r.domain.createdDate)),
  },
  {
    header: 'Expires',
    importable: true,
    value: (r) => registration(r, () => isoDate(r.domain.expirationDate)),
  },
  {
    header: 'Auto-renew',
    importable: true,
    value: (r) => (held(r) ? yesNo(r.domain.autoRenew) : ''),
  },
  {
    header: 'Renewal price',
    importable: true,
    numeric: true,
    value: (r) => {
      return manualPrice(r)?.amount ?? '';
    },
  },
  {
    header: 'Renewal currency',
    importable: true,
    value: (r) => manualPrice(r)?.currency ?? '',
  },
  {
    header: 'Renewal estimate',
    importable: false,
    numeric: true,
    value: (r) => {
      const p = pricing(r);
      return held(r) && p?.renewal != null
        ? decimal(p.renewal, p.currency)
        : '';
    },
  },
  {
    header: 'Renewal estimate currency',
    importable: false,
    value: (r) => {
      const p = pricing(r);
      return held(r) && p?.renewal != null ? p.currency : '';
    },
  },
  {
    header: 'Asking price',
    importable: true,
    numeric: true,
    value: (r) => asking(r)?.amount ?? '',
  },
  {
    header: 'Minimum offer',
    importable: true,
    numeric: true,
    value: (r) => asking(r)?.minOffer ?? '',
  },
  {
    header: 'Floor price',
    importable: true,
    numeric: true,
    value: (r) => asking(r)?.floor ?? '',
  },
  {
    header: 'Asking currency',
    importable: true,
    value: (r) => asking(r)?.currency ?? '',
  },
  {
    header: 'Purchase type',
    importable: true,
    value: (r) => {
      const type = purchase(r)?.purchaseType;
      return type === 'registered'
        ? 'Registered'
        : type === 'purchased'
          ? 'Purchased'
          : '';
    },
  },
  {
    header: 'Purchase date',
    importable: true,
    value: (r) => purchase(r)?.purchaseDate ?? '',
  },
  {
    header: 'Purchase amount',
    importable: true,
    numeric: true,
    value: (r) => purchase(r)?.amount ?? '',
  },
  {
    header: 'Purchase currency',
    importable: true,
    value: (r) => (purchase(r)?.amount ? (purchase(r)?.currency ?? '') : ''),
  },
  {
    header: 'Purchase years',
    importable: true,
    numeric: true,
    value: (r) => String(purchase(r)?.purchaseYears ?? ''),
  },
  {
    header: 'Sale date',
    importable: true,
    value: (r) => purchase(r)?.saleDate ?? '',
  },
  {
    header: 'Sale amount',
    importable: true,
    numeric: true,
    value: (r) => purchase(r)?.saleAmount ?? '',
  },
  {
    header: 'Sale currency',
    importable: true,
    value: (r) =>
      purchase(r)?.saleAmount ? (purchase(r)?.saleCurrency ?? '') : '',
  },
  { header: 'TLD', importable: false, value: (r) => tldOf(r.key) },
  {
    header: 'Days until expiry',
    importable: false,
    numeric: true,
    value: (r) => {
      const exp = r.domain.expirationDate;
      if (!held(r) || !exp) return '';
      const t = (exp instanceof Date ? exp : new Date(exp)).getTime();
      if (Number.isNaN(t)) return '';
      return String(Math.round((t - (r.ctx.now ?? Date.now())) / 86_400_000));
    },
  },
  {
    header: 'Renewal date',
    importable: false,
    value: (r) => (held(r) ? isoDate(r.domain.renewalDate) : ''),
  },
  {
    header: 'Locked',
    importable: false,
    value: (r) => (held(r) ? yesNo(r.domain.locked) : ''),
  },
  {
    header: 'Privacy',
    importable: false,
    value: (r) => (held(r) ? yesNo(r.domain.privacy) : ''),
  },
  {
    header: 'Nameservers',
    importable: false,
    value: (r) => (held(r) ? r.domain.nameservers.join('; ') : ''),
  },
  {
    header: 'Registrar status',
    importable: false,
    value: (r) => (held(r) ? r.domain.status : ''),
  },
  {
    header: 'Last synced',
    importable: false,
    value: (r) => (held(r) ? isoDate(r.domain.syncedAt) : ''),
  },
  {
    header: 'Notes',
    importable: true,
    value: (r) => purchase(r)?.notes ?? '',
  },
];

/** Every header the export writes, in order. */
export const DOMAIN_CSV_HEADERS = DOMAIN_CSV_COLUMNS.map((c) => c.header);

/**
 * One row per name, in the order the names first appear. A name two accounts
 * hold (mid-transfer) lists both accounts and takes its registrar columns
 * from the copy synced most recently.
 */
function nameRows(domains: Domain[], ctx: DomainCsvContext): NameRow[] {
  const byName = new Map<string, NameRow>();
  for (const d of domains) {
    const key = toAscii(d.domainName);
    const account = d.departed ? '' : ctx.accountName(d);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, {
        domain: d,
        accounts: account ? [account] : [],
        key,
        ctx,
      });
      continue;
    }
    if (account && !existing.accounts.includes(account))
      existing.accounts.push(account);
    const synced = (x: Domain) => new Date(x.syncedAt).getTime() || 0;
    if (
      (existing.domain.departed && !d.departed) ||
      (!d.departed && synced(d) > synced(existing.domain))
    )
      existing.domain = d;
  }
  return [...byName.values()];
}

/** The rows as DomBot CSV text (headers first, CRLF line endings). */
export function domainsToCsv(domains: Domain[], ctx: DomainCsvContext): string {
  const numeric = new Set(
    DOMAIN_CSV_COLUMNS.flatMap((c, i) => (c.numeric ? [i] : [])),
  );
  return toCsv(
    [
      DOMAIN_CSV_HEADERS,
      ...nameRows(domains, ctx).map((r) =>
        DOMAIN_CSV_COLUMNS.map((c) => c.value(r)),
      ),
    ],
    numeric,
  );
}

/** Timestamped default filename, e.g. "dombot-domains-2026-08-30.csv". */
export function domainsCsvFilename(now: Date = new Date()): string {
  return `dombot-domains-${now.toISOString().slice(0, 10)}.csv`;
}
