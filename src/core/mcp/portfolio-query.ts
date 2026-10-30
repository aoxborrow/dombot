// Pure query logic for the MCP `portfolio_query` tool — filtering, sorting, and
// paging over the merged portfolio. Kept free of Electron and the MCP SDK so it
// can be unit-tested in isolation; tools.ts owns the zod schema and feeds this
// the cache reads (merged domains plus imported and Archive rows, folders,
// assignments, each name's ownership from the event log, and the money, notes
// and prices DomBot keeps per name).

import { domainKey } from '../../shared/account-key';
import type {
  Domain,
  DomainPurchase,
  DomainSource,
  ListPrice,
  PriceSource,
  RegistrarMeta,
  RenewalPricing,
} from '../../shared/ipc';
import { toAscii } from '../../shared/domain-name';
import { reportsPrivacy } from '../../shared/domain-ops';
import { STALE_AFTER_MS } from '../../shared/ipc';
import {
  hasAskingRange,
  matchesAsking,
  type AskingFilter,
  type AskingKind,
} from '../../shared/list-prices';
import {
  standingOf,
  type ArchiveLabel,
  type Ownership,
  type Standing,
} from '../../shared/ownership';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

/** Fields portfolio_query can sort by. */
export type QuerySort =
  | 'domainName'
  | 'registrar'
  | 'expirationDate'
  | 'createdDate'
  | 'renewalPrice';

/**
 * Which names a query covers, as the Domains page's Owned / Archive switch:
 * what you hold, what you no longer own, or both.
 */
export type OwnershipFilter = 'owned' | 'archive' | 'all';

/** The filter/sort/page inputs, already parsed (all optional). */
export interface QueryArgs {
  /** Default `owned`. */
  ownership?: OwnershipFilter;
  accountId?: string;
  registrar?: string;
  /** `registrar`: synced from an account. `imported`: added from a file or
   *  by name, and no account reports it. */
  source?: DomainSource;
  tld?: string;
  folder?: string;
  nameContains?: string;
  nameserverContains?: string;
  /** Only names listed on this market (any status), per the last market sync. */
  listedOn?: string;
  /** Only names not listed on this market. */
  notListedOn?: string;
  /** Only names whose asking price has any of these (as the Domains Pricing
   *  filter). */
  askingPrice?: AskingKind[];
  /** BIN price, minimum offer and floor bounds, whole amounts. A bound needs the
   *  name to have that amount. */
  binMin?: number;
  binMax?: number;
  minOfferMin?: number;
  minOfferMax?: number;
  floorMin?: number;
  floorMax?: number;
  /** The bounds only match prices in this currency. */
  priceCurrency?: string;
  autoRenew?: boolean;
  locked?: boolean;
  privacy?: boolean;
  status?: string;
  expiresBefore?: string;
  expiresAfter?: string;
  expiringWithinDays?: number;
  sort?: QuerySort;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/** What you paid for a name: its latest acquisition. */
export interface PaidSummary {
  date: string | null;
  amount: string | null;
  currency: string | null;
  /** Hand-registered or bought. */
  kind: 'registered' | 'purchased';
}

/** What a name sold for. */
export interface SoldSummary {
  date: string | null;
  amount: string | null;
  currency: string | null;
}

/** Your asking (BIN) price and offer thresholds. `floor` is never shown to
 *  buyers. */
export interface AskingPrice {
  amount: string | null;
  minOffer: string | null;
  floor: string | null;
  currency: string;
}

/** DomBot's estimated yearly renewal price and where it came from (as
 *  domain_renewal_price). */
export interface RenewalEstimate {
  amount: number;
  currency: string;
  source: PriceSource;
}

/** The per-name data DomBot keeps beside the registrar's, keyed as the
 *  services key it: by `toAscii(name)`, and pricing by `domainKey(row)`. */
export interface RowExtras {
  purchases?: Record<string, DomainPurchase>;
  listPrices?: Record<string, ListPrice>;
  pricing?: Record<string, RenewalPricing>;
  /** Each listed name's markets, keyed by `toAscii(name)`. */
  listedMarkets?: Map<string, Set<string>>;
  /** The registration lookup's cached answers (Archive's Deleted). */
  registered?: Map<string, boolean>;
}

/** Only the fields an agent needs for a row — drops `syncedAt`/`deleted`, adds
 *  the domain's folder name (user-assigned grouping) when it has one, and
 *  whether it's still yours. */
export interface QueryRow {
  /** null for an imported name, or a name in Archive whose last account is
   *  unknown. */
  accountId: string | null;
  accountLabel: string | null;
  registrar: string | null;
  /** An imported name's registrar as you typed it, when DomBot doesn't know
   *  it (e.g. "Epik"); null otherwise. */
  registrarLabel: string | null;
  /** `registrar`: synced from an account. `imported`: added by you; no
   *  account reports it, so the registrar tools can't act on it. */
  source: DomainSource;
  domainName: string;
  /** `archive`: no longer yours (docs/owned-and-archive.md). */
  ownership: 'owned' | 'archive';
  /**
   * Why it's in Archive: `sold`, `deleted` (the lookup says nobody holds
   * it), `expired` (it left after its expiry), or `removed` (it left early
   * with no sale recorded; the one to review).
   */
  archiveLabel: ArchiveLabel | null;
  /** Owned, auto-renew off, and expiring within 30 days. */
  expiring: boolean;
  /** A sale recorded on a name you still hold: the buyer hasn't taken it. */
  salePending: boolean;
  /** Whether an account still reports it. When false, the fields an account
   *  reports are empty and the registrar is the last one it was seen at. */
  inAccount: boolean;
  status: string;
  createdDate: Date | null;
  expirationDate: Date | null;
  renewalDate: Date | null;
  /** null for a name no account reports. */
  autoRenew: boolean | null;
  locked: boolean | null;
  /** null where the registrar doesn't report privacy, or no account reports
   *  the name. */
  privacy: boolean | null;
  nameservers: string[];
  folder: string | null;
  paid: PaidSummary | null;
  sold: SoldSummary | null;
  /** Your note on the name; null when there's none. */
  notes: string | null;
  askingPrice: AskingPrice | null;
  /** null when DomBot has no estimate. */
  renewalPrice: RenewalEstimate | null;
}

/** A per-registrar sync failure — a registrar whose last sync errored. */
export interface SyncError {
  registrar: string;
  message: string;
}

/** Sync health for the cache being queried, so a caller can tell the result is
 *  complete (or which registrar is missing/stale). */
export interface QueryMeta {
  /** Headline "last synced" (ms epoch), or null when nothing has synced. */
  fetchedAt: number | null;
  /** Registrar ids whose last sync succeeded (their domains are in the result). */
  registrars: string[];
  /** Registrars whose last sync errored — their domains may be missing/stale. */
  errors: SyncError[];
  /** Active accounts whose own last sync is missing or past the staleness
   *  threshold, even when another account synced since. */
  staleAccounts?: StaleAccount[];
}

/** An active account whose domains may be out of date. */
export interface StaleAccount {
  registrar: string;
  accountId?: string;
  lastSyncedAt: number | null;
}

export interface QueryResult extends QueryMeta {
  /** Total matches before paging. */
  total: number;
  /** True when the data is missing, past the staleness threshold, or any
   *  active account is (see staleAccounts). */
  stale: boolean;
  staleAccounts: StaleAccount[];
  rows: QueryRow[];
}

/** A folder definition — only the fields the query needs. */
export interface FolderRef {
  id: string;
  name: string;
}

/** ms epoch → true when missing or older than the staleness threshold. */
export function isStaleAt(fetchedAt: number | null): boolean {
  return fetchedAt == null || Date.now() - fetchedAt >= STALE_AFTER_MS;
}

/** Active (configured, enabled) accounts whose own last sync is missing or past
 *  the staleness threshold. The headline fetchedAt is the newest sync, so one
 *  account syncing would otherwise hide the rest going stale. A failed account
 *  is left out: it's already reported in `errors`. */
export function staleAccounts(meta: RegistrarMeta[]): StaleAccount[] {
  return meta
    .filter(
      (r) =>
        r.configured &&
        r.enabled &&
        r.sync.lastError == null &&
        isStaleAt(r.sync.lastSyncedAt),
    )
    .map((r) => ({
      registrar: r.name,
      accountId: r.accountId,
      lastSyncedAt: r.sync.lastSyncedAt,
    }));
}

/** Normalizes a TLD filter ("com" / ".com" / "example.com" → the suffix to match). */
function tldSuffix(tld: string): string {
  const t = tld.trim().toLowerCase().replace(/^\./, '');
  return `.${t}`;
}

/** Resolves a folder filter (name / id) to the folderId to match, or null
 *  when it names no known folder (→ the query returns no rows). */
export function resolveFolderId(
  param: string,
  folders: FolderRef[],
): string | null {
  const lower = param.trim().toLowerCase();
  const match =
    folders.find((f) => f.id === param) ??
    folders.find((f) => f.name.toLowerCase() === lower);
  return match ? match.id : null;
}

/**
 * Filters, sorts, and pages the merged portfolio. `domains` is the cached
 * portfolio overlaid with any cached per-domain detail, plus the Archive rows
 * for names no account reports (`archiveRows`); `assignments` maps a domain
 * name → folderId; `ownership` is each name's Owned / Archive state. Every
 * filter is optional and ANDed; dates sort with nulls always last.
 */
export function queryPortfolio(
  domains: Domain[],
  folders: FolderRef[],
  assignments: Record<string, string>,
  meta: QueryMeta,
  args: QueryArgs,
  ownership: Map<string, Ownership> = new Map(),
  extras: RowExtras = {},
): QueryResult {
  const now = Date.now();
  const standing = new Map<Domain, Standing>();
  const standingFor = (d: Domain): Standing => {
    let s = standing.get(d);
    if (!s) {
      const key = toAscii(d.domainName);
      s = standingOf(d, ownership.get(key), extras.registered?.get(key), now);
      standing.set(d, s);
    }
    return s;
  };
  const labelOf = (d: Domain): ArchiveLabel | null => standingFor(d).label;
  const scope = args.ownership ?? 'owned';
  const folderNameFor = (d: Domain): string | null => {
    const id = assignments[toAscii(d.domainName)];
    if (!id) return null;
    return folders.find((f) => f.id === id)?.name ?? null;
  };

  // Resolve the folder filter once; an unknown name matches nothing.
  const folderId =
    args.folder != null ? resolveFolderId(args.folder, folders) : undefined;
  const suffix = args.tld != null ? tldSuffix(args.tld) : undefined;
  const nameNeedle = args.nameContains?.trim().toLowerCase();
  const nsNeedle = args.nameserverContains?.trim().toLowerCase();
  const statusNeedle = args.status?.trim().toLowerCase();
  const before =
    args.expiresBefore != null ? Date.parse(args.expiresBefore) : undefined;
  const after =
    args.expiresAfter != null ? Date.parse(args.expiresAfter) : undefined;
  const asking: AskingFilter = {
    kinds: args.askingPrice,
    bin: { min: args.binMin ?? null, max: args.binMax ?? null },
    minOffer: { min: args.minOfferMin ?? null, max: args.minOfferMax ?? null },
    floor: { min: args.floorMin ?? null, max: args.floorMax ?? null },
    currency: args.priceCurrency?.toUpperCase(),
  };
  const askingSet = !!args.askingPrice?.length || hasAskingRange(asking);
  const withinCutoff =
    args.expiringWithinDays != null
      ? Date.now() + args.expiringWithinDays * 86_400_000
      : undefined;

  const renewalOf = (d: Domain): RenewalEstimate | null => {
    const p = extras.pricing?.[domainKey(d)];
    return p && p.renewal != null
      ? { amount: p.renewal, currency: p.currency, source: p.source }
      : null;
  };

  const filtered = domains.filter((d) => {
    // Owned vs Archive, as on the Domains page: a name an account holds is
    // always Owned.
    const label = labelOf(d);
    if (scope === 'owned' && label) return false;
    if (scope === 'archive' && !label) return false;
    // An imported name is at no account, even when its registrar id matches
    // a legacy account id.
    if (
      args.accountId &&
      (d.source === 'imported' ||
        (d.accountId ?? d.registrar) !== args.accountId)
    )
      return false;
    if (args.registrar != null && d.registrar !== args.registrar) return false;
    if (args.source != null && d.source !== args.source) return false;
    if (suffix != null && !d.domainName.toLowerCase().endsWith(suffix))
      return false;
    if (folderId !== undefined) {
      if (assignments[toAscii(d.domainName)] !== folderId) return false;
    }
    if (nameNeedle && !d.domainName.toLowerCase().includes(nameNeedle))
      return false;
    if (
      nsNeedle &&
      !d.nameservers.some((ns) => ns.toLowerCase().includes(nsNeedle))
    )
      return false;
    if (args.listedOn != null || args.notListedOn != null) {
      const markets = extras.listedMarkets?.get(toAscii(d.domainName));
      if (args.listedOn != null && !markets?.has(args.listedOn)) return false;
      if (args.notListedOn != null && markets?.has(args.notListedOn))
        return false;
    }
    if (
      askingSet &&
      !matchesAsking(extras.listPrices?.[toAscii(d.domainName)], asking)
    )
      return false;
    // A name no account reports has no settings to match, except an imported
    // name's auto-renew when you've said what it is.
    const reported = !d.departed && d.source !== 'imported';
    if (!reported && (args.locked != null || args.privacy != null))
      return false;
    if (
      args.autoRenew != null &&
      (d.departed || (d.source === 'imported' && d.autoRenewUnknown))
    )
      return false;
    if (args.autoRenew != null && d.autoRenew !== args.autoRenew) return false;
    if (args.locked != null && d.locked !== args.locked) return false;
    if (
      args.privacy != null &&
      (!reportsPrivacy(d.registrar) || d.privacy !== args.privacy)
    )
      return false;
    if (statusNeedle && !d.status.toLowerCase().includes(statusNeedle))
      return false;

    const exp = d.expirationDate ? d.expirationDate.getTime() : null;
    if (before != null && !Number.isNaN(before)) {
      if (exp == null || exp >= before) return false;
    }
    if (after != null && !Number.isNaN(after)) {
      if (exp == null || exp < after) return false;
    }
    if (withinCutoff != null) {
      if (exp == null || exp > withinCutoff) return false;
    }
    return true;
  });

  // Sort. Dates sort with nulls always last regardless of direction; string
  // fields sort case-insensitively.
  const sort = args.sort ?? 'expirationDate';
  const dir = args.order === 'desc' ? -1 : 1;
  const numberVal = (
    d: Domain,
    field: 'expirationDate' | 'createdDate' | 'renewalPrice',
  ) =>
    field === 'renewalPrice'
      ? (renewalOf(d)?.amount ?? null)
      : d[field]
        ? d[field]!.getTime()
        : null;
  filtered.sort((a, b) => {
    if (
      sort === 'expirationDate' ||
      sort === 'createdDate' ||
      sort === 'renewalPrice'
    ) {
      const av = numberVal(a, sort);
      const bv = numberVal(b, sort);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last
      if (bv == null) return -1;
      return (av - bv) * dir;
    }
    const av = (
      sort === 'registrar' ? a.registrar : a.domainName
    ).toLowerCase();
    const bv = (
      sort === 'registrar' ? b.registrar : b.domainName
    ).toLowerCase();
    return av < bv ? -dir : av > bv ? dir : 0;
  });

  const total = filtered.length;
  const offset = args.offset ?? 0;
  const limit = args.limit ?? DEFAULT_LIMIT;
  const rows: QueryRow[] = filtered.slice(offset, offset + limit).map((d) => {
    const label = labelOf(d);
    const imported = d.source === 'imported';
    const inAccount = !d.departed && !imported;
    // An Archive row whose last account is gone has no registrar, and an
    // imported name may have only the text you typed.
    const registrar = d.registrar || null;
    const key = toAscii(d.domainName);
    const purchase = extras.purchases?.[key];
    const asking = extras.listPrices?.[key];
    return {
      registrar,
      accountId: imported ? null : (d.accountId ?? registrar),
      accountLabel: imported
        ? null
        : (d.accountLabel ?? (registrar ? 'Default' : null)),
      registrarLabel: d.importedRegistrarLabel || null,
      source: d.source,
      domainName: d.domainName,
      ownership: label ? 'archive' : 'owned',
      archiveLabel: label,
      expiring: standingFor(d).expiring,
      salePending: standingFor(d).salePending,
      inAccount,
      status: d.status,
      createdDate: d.createdDate,
      expirationDate: d.expirationDate,
      renewalDate: d.renewalDate,
      // An imported name's auto-renew is what you told DomBot, if anything.
      autoRenew:
        inAccount || (imported && !d.autoRenewUnknown) ? d.autoRenew : null,
      locked: inAccount ? d.locked : null,
      privacy: inAccount && reportsPrivacy(d.registrar) ? d.privacy : null,
      nameservers: d.nameservers,
      folder: folderNameFor(d),
      paid:
        purchase?.purchaseType || purchase?.purchaseDate || purchase?.amount
          ? {
              date: purchase.purchaseDate,
              amount: purchase.amount,
              currency: purchase.currency,
              kind: purchase.purchaseType ?? 'purchased',
            }
          : null,
      sold:
        purchase?.saleDate || purchase?.saleAmount
          ? {
              date: purchase.saleDate ?? null,
              amount: purchase.saleAmount ?? null,
              currency: purchase.saleCurrency ?? null,
            }
          : null,
      notes: purchase?.notes || null,
      askingPrice: asking
        ? {
            amount: asking.amount,
            minOffer: asking.minOffer ?? null,
            floor: asking.floor ?? null,
            currency: asking.currency,
          }
        : null,
      renewalPrice: renewalOf(d),
    };
  });

  return {
    total,
    fetchedAt: meta.fetchedAt,
    registrars: meta.registrars,
    errors: meta.errors,
    stale: isStaleAt(meta.fetchedAt) || (meta.staleAccounts?.length ?? 0) > 0,
    staleAccounts: meta.staleAccounts ?? [],
    rows,
  };
}
