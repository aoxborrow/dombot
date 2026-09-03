// Pure query logic for the MCP `portfolio_query` tool — filtering, sorting, and
// paging over the merged portfolio. Kept free of Electron and the MCP SDK so it
// can be unit-tested in isolation; tools.ts owns the zod schema and feeds this
// the cache reads (merged domains, folders, assignments).

import type { Domain } from '@aoxborrow/registrar-client';
import { HIDDEN_FOLDER_ID, STALE_AFTER_MS } from '../../shared/ipc';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

/** Fields portfolio_query can sort by. */
export type QuerySort =
  'domainName' | 'registrar' | 'expirationDate' | 'createdDate';

/** The filter/sort/page inputs, already parsed (all optional). */
export interface QueryArgs {
  registrar?: string;
  tld?: string;
  folder?: string;
  nameContains?: string;
  nameserverContains?: string;
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

/** Only the fields an agent needs for a row — drops `syncedAt`/`deleted`, adds
 *  the domain's folder name (user-assigned grouping) when it has one. */
export interface QueryRow {
  registrar: string;
  domainName: string;
  status: string;
  createdDate: Date | null;
  expirationDate: Date | null;
  renewalDate: Date | null;
  autoRenew: boolean;
  locked: boolean;
  privacy: boolean;
  nameservers: string[];
  folder: string | null;
}

export interface QueryResult {
  /** Total matches before paging. */
  total: number;
  /** Headline "last synced" (ms epoch), or null when nothing has synced. */
  fetchedAt: number | null;
  /** True when the data is missing or past the staleness threshold. */
  stale: boolean;
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

/** Normalizes a TLD filter ("com" / ".com" / "example.com" → the suffix to match). */
function tldSuffix(tld: string): string {
  const t = tld.trim().toLowerCase().replace(/^\./, '');
  return `.${t}`;
}

/** Resolves a folder filter (name / id / "Hidden") to the folderId to match, or
 *  null when it names no known folder (→ the query returns no rows). */
function resolveFolderId(param: string, folders: FolderRef[]): string | null {
  const p = param.trim();
  if (param === HIDDEN_FOLDER_ID || p.toLowerCase() === 'hidden')
    return HIDDEN_FOLDER_ID;
  const lower = p.toLowerCase();
  const match =
    folders.find((f) => f.id === param) ??
    folders.find((f) => f.name.toLowerCase() === lower);
  return match ? match.id : null;
}

/**
 * Filters, sorts, and pages the merged portfolio. `domains` is the cached
 * portfolio overlaid with any cached per-domain detail; `assignments` maps
 * `${registrar}:${domainName}` → folderId. Every filter is optional and ANDed;
 * dates sort with nulls always last.
 */
export function queryPortfolio(
  domains: Domain[],
  folders: FolderRef[],
  assignments: Record<string, string>,
  fetchedAt: number | null,
  args: QueryArgs,
): QueryResult {
  const folderNameFor = (d: Domain): string | null => {
    const id = assignments[`${d.registrar}:${d.domainName}`];
    if (!id) return null;
    if (id === HIDDEN_FOLDER_ID) return 'Hidden';
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
  const withinCutoff =
    args.expiringWithinDays != null
      ? Date.now() + args.expiringWithinDays * 86_400_000
      : undefined;

  const filtered = domains.filter((d) => {
    if (args.registrar != null && d.registrar !== args.registrar) return false;
    if (suffix != null && !d.domainName.toLowerCase().endsWith(suffix))
      return false;
    if (folderId !== undefined) {
      if (assignments[`${d.registrar}:${d.domainName}`] !== folderId)
        return false;
    }
    if (nameNeedle && !d.domainName.toLowerCase().includes(nameNeedle))
      return false;
    if (
      nsNeedle &&
      !d.nameservers.some((ns) => ns.toLowerCase().includes(nsNeedle))
    )
      return false;
    if (args.autoRenew != null && d.autoRenew !== args.autoRenew) return false;
    if (args.locked != null && d.locked !== args.locked) return false;
    if (args.privacy != null && d.privacy !== args.privacy) return false;
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
  const dateVal = (d: Domain, field: 'expirationDate' | 'createdDate') =>
    d[field] ? d[field]!.getTime() : null;
  filtered.sort((a, b) => {
    if (sort === 'expirationDate' || sort === 'createdDate') {
      const av = dateVal(a, sort);
      const bv = dateVal(b, sort);
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
  const rows: QueryRow[] = filtered.slice(offset, offset + limit).map((d) => ({
    registrar: d.registrar,
    domainName: d.domainName,
    status: d.status,
    createdDate: d.createdDate,
    expirationDate: d.expirationDate,
    renewalDate: d.renewalDate,
    autoRenew: d.autoRenew,
    locked: d.locked,
    privacy: d.privacy,
    nameservers: d.nameservers,
    folder: folderNameFor(d),
  }));

  return { total, fetchedAt, stale: isStaleAt(fetchedAt), rows };
}
