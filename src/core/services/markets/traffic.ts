import {
  searchesOf,
  type DomainTrafficTotals,
  type MarketId,
  type MarketListing,
  type MarketStatsDay,
  type MarketTraffic,
  type SearchCounts,
} from '../../../shared/markets';
import { localDay } from '../../../shared/domain-events';
import { getAppIdentity } from '../../app-info';
import {
  MARKET_DOMAIN_STATS_NAMESPACE,
  MARKET_SEARCH_SNAPSHOTS_NAMESPACE,
} from '../../storage/names';
import { Namespace } from '../../storage/namespace';
import type { AnyMarketAdapter } from './registry';

// Per-domain traffic for reporting (docs/afternic-api.md, "Reporting").
//
// Views and leads per name cost one API call each, which for a 10,000-name
// portfolio is over an hour of Afternic's rate limit. So each sync fetches a
// slice: names never fetched first, then the stalest, a year of history the
// first time and the last week after that. Only days with traffic are kept;
// most names have none on most days.
//
// Search counts (Discount Domain Club Domain Pro) are rolling 30/90/365-day
// numbers that come with the listing. A weekly snapshot of them shows how
// demand moves.

/** One name's stored traffic: `[views, leads]` per day that had any. */
export interface DomainTraffic {
  /** ms epoch of the last fetch. */
  fetchedAt: number;
  /** YYYY-MM-DD, the last day the fetch covered. */
  through: string;
  days: Record<string, [views: number, leads: number]>;
}

export type SearchSnapshot = { total: SearchCounts; unique: SearchCounts };

const traffic = new Namespace<DomainTraffic>(MARKET_DOMAIN_STATS_NAMESPACE);
const searches = new Namespace<Record<string, SearchSnapshot>>(
  MARKET_SEARCH_SNAPSHOTS_NAMESPACE,
);

const DAY = 86_400_000;
/** Kept a little over a year, so a 365-day total is always whole. */
const KEEP_DAYS = 400;
const FIRST_DAYS = 365;
const LATER_DAYS = 7;
/** A name fetched this recently waits for the next rotation. */
const REFRESH_AFTER = 20 * 3_600_000;
const SNAPSHOT_EVERY_DAYS = 7;

/**
 * Names per sync. The web host's Worker is limited in how many requests one
 * invocation makes, so it takes smaller slices more often.
 */
export function trafficBudget(): number {
  return getAppIdentity().platform === 'web' ? 40 : 300;
}

const key = (accountId: string, name: string) => `${accountId}:${name}`;

function dayBefore(day: string, n: number): string {
  return new Date(Date.parse(day) - n * DAY).toISOString().slice(0, 10);
}

/** The names to fetch this sync, stalest first, never-fetched before all. */
export function trafficQueue(
  accountId: string,
  listings: readonly MarketListing[],
  budget: number,
  now: number = Date.now(),
): string[] {
  return listings
    .map((l) => ({
      name: l.name,
      at: traffic.get(key(accountId, l.name))?.fetchedAt ?? 0,
    }))
    .filter((n) => now - n.at >= REFRESH_AFTER)
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
    .slice(0, budget)
    .map((n) => n.name);
}

/**
 * Fetch the next slice of names' traffic. Stops at the first failure (most
 * likely the rate limit) and keeps what it has; the next sync carries on.
 * Returns how many names it fetched and the error that stopped it, if any.
 */
export async function syncDomainTraffic(
  adapter: AnyMarketAdapter,
  listings: readonly MarketListing[],
  budget = trafficBudget(),
  now: number = Date.now(),
): Promise<{ fetched: number; error: string | null }> {
  if (!adapter.domainStats) return { fetched: 0, error: null };
  const today = localDay(now);
  let fetched = 0;
  for (const name of trafficQueue(adapter.accountId, listings, budget, now)) {
    const k = key(adapter.accountId, name);
    const kept = traffic.get(k);
    let rows;
    try {
      rows = await adapter.domainStats(name, kept ? LATER_DAYS : FIRST_DAYS);
    } catch (error) {
      return {
        fetched,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const days = { ...(kept?.days ?? {}) };
    for (const r of rows) {
      const views = r.views ?? 0;
      const leads = r.leads ?? 0;
      if (views || leads) days[r.date] = [views, leads];
      else delete days[r.date];
    }
    const oldest = dayBefore(today, KEEP_DAYS);
    for (const d of Object.keys(days)) if (d < oldest) delete days[d];
    void traffic.set(k, { fetchedAt: now, through: today, days });
    fetched++;
  }
  return { fetched, error: null };
}

/** Take a weekly snapshot of each listing's search counts, when it has them. */
export function snapshotSearches(
  accountId: string,
  listings: readonly MarketListing[],
  today: string = localDay(),
): void {
  const writes: [string, Record<string, SearchSnapshot>][] = [];
  for (const l of listings) {
    const counts = searchesOf(l);
    if (!counts) continue;
    const k = key(accountId, l.name);
    const kept = searches.get(k) ?? {};
    const last = Object.keys(kept).sort().at(-1);
    if (
      last &&
      Date.parse(today) - Date.parse(last) < SNAPSHOT_EVERY_DAYS * DAY
    )
      continue;
    const next = { ...kept, [today]: counts };
    const oldest = dayBefore(today, KEEP_DAYS);
    for (const d of Object.keys(next)) if (d < oldest) delete next[d];
    writes.push([k, next]);
  }
  if (writes.length) void searches.setMany(writes);
}

export interface TrafficTotals {
  views: number;
  leads: number;
  /** False until the name's traffic has been fetched at least once. */
  known: boolean;
}

/** Each name's views and leads over the last `days`, by `toAscii` name. */
export function trafficTotals(
  accountIds: ReadonlySet<string>,
  days: number,
  today: string = localDay(),
): Map<string, TrafficTotals> {
  const since = dayBefore(today, days - 1);
  const out = new Map<string, TrafficTotals>();
  for (const [k, t] of Object.entries(traffic.all())) {
    const split = k.indexOf(':');
    if (!accountIds.has(k.slice(0, split))) continue;
    const name = k.slice(split + 1);
    const total = out.get(name) ?? { views: 0, leads: 0, known: true };
    for (const [d, [views, leads]] of Object.entries(t.days)) {
      if (d < since) continue;
      total.views += views;
      total.leads += leads;
    }
    out.set(name, total);
  }
  return out;
}

/** A name's search snapshots, oldest first. */
export function searchHistory(
  accountId: string,
  name: string,
): { date: string; counts: SearchSnapshot }[] {
  return Object.entries(searches.get(key(accountId, name)) ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, counts }));
}

/** Drop an account's traffic and snapshots (it was removed). */
export function dropAccountTraffic(accountId: string): void {
  for (const ns of [traffic, searches] as Namespace<unknown>[]) {
    for (const k of Object.keys(ns.all())) {
      if (k.startsWith(`${accountId}:`)) void ns.delete(k);
    }
  }
}

/** Traffic for the Markets page and MCP, over the enabled accounts. */
export function marketTraffic(
  /** Account id → its market, for every account to count. */
  accounts: ReadonlyMap<string, MarketId>,
  accountDays: MarketStatsDay[],
  today: string = localDay(),
): MarketTraffic {
  const domains: MarketTraffic['domains'] = {};
  const byMarket: MarketTraffic['byMarket'] = {};
  for (const market of new Set(accounts.values())) {
    const ids = new Set(
      [...accounts].filter(([, m]) => m === market).map(([id]) => id),
    );
    const d30 = trafficTotals(ids, 30, today);
    const out: Record<string, DomainTrafficTotals> = {};
    for (const [name, year] of trafficTotals(ids, 365, today)) {
      const t = {
        views30: d30.get(name)?.views ?? 0,
        leads30: d30.get(name)?.leads ?? 0,
        views365: year.views,
        leads365: year.leads,
      };
      out[name] = t;
      const all = domains[name];
      domains[name] = all
        ? {
            views30: all.views30 + t.views30,
            leads30: all.leads30 + t.leads30,
            views365: all.views365 + t.views365,
            leads365: all.leads365 + t.leads365,
          }
        : { ...t };
    }
    byMarket[market] = out;
  }
  return {
    accountDays: [...accountDays].sort((a, b) => a.date.localeCompare(b.date)),
    domains,
    byMarket,
  };
}
