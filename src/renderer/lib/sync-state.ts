import { useEffect, useReducer } from 'react';
import { toast } from 'sonner';
import type { RegistrarMeta } from '../../shared/ipc';
import type { MarketAccountView, MarketInfo } from '../../shared/markets';
import { marketAccountName, marketSyncError } from '../../shared/notifications';
import { useAppStore } from '../store/app';
import { accountName } from './domain-history';
import { isDemo } from './platform';
import { multiAccountRegistrars } from './registrar-accounts';

/** Minimum gap between manual syncs — the button is disabled during it so a fresh
 * pull can't be hammered (every sync re-queries every registrar). */
const SYNC_COOLDOWN_MS = 60 * 1000; // 1 minute

/** How old the portfolio can get before the sync status turns amber to nudge a
 * refresh. Separate from the cache TTL (shared STALE_AFTER_MS) — this is purely
 * the UI cue and shouldn't affect how long cached data is kept. */
const SYNC_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** At/past the staleness threshold — highlight the control to nudge a manual sync. */
export function isStale(fetchedAt: number): boolean {
  return Date.now() - fetchedAt >= SYNC_STALE_AFTER_MS;
}

/** One account a Sync covers, registrar or market alike. */
export interface SyncAccount {
  kind: 'registrar' | 'market';
  id: string;
  /** As its card names it. */
  name: string;
  /** Its last good sync (ms epoch), or null when it never synced. */
  lastSyncedAt: number | null;
  lastError: string | null;
  /** Its last attempt, good or failed (ms epoch): what a sync's progress
   *  watches change. Null when it never tried. */
  lastAttemptAt: number | null;
}

/**
 * What a Sync covers: every enabled registrar account, and every enabled
 * market account with saved keys. A disabled account keeps its credentials
 * but never syncs.
 */
export function syncAccounts(
  registrars: RegistrarMeta[] | null,
  markets: MarketAccountView[] | null,
  catalog: MarketInfo[] = [],
): SyncAccount[] {
  return [
    ...(registrars ?? [])
      .filter((r) => r.configured && r.enabled)
      .map((r) => ({
        kind: 'registrar' as const,
        id: r.accountId ?? r.name,
        name: accountName(registrars, r.accountId ?? r.name) ?? r.displayName,
        lastSyncedAt: r.sync.lastSyncedAt,
        lastError: r.sync.lastError,
        lastAttemptAt:
          Math.max(r.sync.lastSyncedAt ?? 0, r.sync.lastErrorAt ?? 0) || null,
      })),
    ...(markets ?? [])
      .filter((a) => a.configured && a.enabled)
      .map((a) => ({
        kind: 'market' as const,
        id: a.id,
        name: marketAccountName(a, catalog),
        // A market account's `at` is its last attempt, good or not.
        lastSyncedAt: a.sync && a.sync.lastError == null ? a.sync.at : null,
        lastError: marketSyncError(a),
        lastAttemptAt: a.sync?.at ?? null,
      })),
  ];
}

/** Where a running Sync is: accounts done of the accounts it covers. */
export interface SyncProgress {
  done: number;
  total: number;
}

/** An account's key in a sync's baseline. */
const baselineKey = (a: SyncAccount) => `${a.kind}:${a.id}`;

/**
 * Each account's last attempt as a Sync starts. An account is done once its
 * last attempt has moved on: compared, not timed, so a server whose clock
 * differs from the browser's (the web host) counts the same.
 */
export function syncBaseline(
  accounts: SyncAccount[],
): Record<string, number | null> {
  return Object.fromEntries(
    accounts.map((a) => [baselineKey(a), a.lastAttemptAt]),
  );
}

export function syncProgress(
  accounts: SyncAccount[],
  baseline: Record<string, number | null>,
): SyncProgress {
  const covered = accounts.filter((a) => baselineKey(a) in baseline);
  return {
    done: covered.filter(
      (a) =>
        a.lastAttemptAt != null && a.lastAttemptAt !== baseline[baselineKey(a)],
    ).length,
    total: Object.keys(baseline).length,
  };
}

/** "Syncing 15/17 accounts…", or "Syncing 15/17…" with no unit; "Syncing…"
 *  when there's no count to show. */
export function syncingText(
  progress: SyncProgress | null,
  unit?: string,
): string {
  if (!progress || progress.total === 0) return 'Syncing…';
  return `Syncing ${progress.done}/${progress.total}${unit ? ` ${unit}` : ''}…`;
}

/** Accounts whose own last successful sync is past the threshold. The
 * portfolio's fetchedAt is the newest sync, so syncing one account would
 * otherwise hide the rest going stale. Failed and never-synced accounts are
 * counted separately. */
export function staleAccounts(accounts: SyncAccount[]): SyncAccount[] {
  return accounts.filter(
    (a) =>
      a.lastError == null && a.lastSyncedAt != null && isStale(a.lastSyncedAt),
  );
}

/** What the accounts are called in a count: "registrars" while that's all
 * there is, one account each; "accounts" once a registrar has several or
 * markets join them. */
export function syncUnit(
  registrars: RegistrarMeta[] | null,
  accounts: SyncAccount[],
): 'accounts' | 'registrars' {
  return accounts.some((a) => a.kind === 'market') ||
    multiAccountRegistrars(registrars ?? []).size > 0
    ? 'accounts'
    : 'registrars';
}

/** How one account's sync stands: failed, good but over a week old, never
 * synced, or synced. */
export function accountSyncState(
  a: SyncAccount,
): 'failed' | 'stale' | 'unsynced' | 'synced' {
  if (a.lastError != null) return 'failed';
  if (a.lastSyncedAt == null) return 'unsynced';
  return isStale(a.lastSyncedAt) ? 'stale' : 'synced';
}

/** Green when every account synced, red when one failed, amber otherwise. */
export type SyncLevel = 'ok' | 'warn' | 'error';

export interface SyncSummary {
  total: number;
  synced: number;
  failed: number;
  stale: number;
  level: SyncLevel;
  /** "14/14 accounts synced", "1 of 14 accounts failed", … */
  label: string;
  /** The same in a word or two, for a narrow status bar. */
  short: string;
  /** A sentence for a tooltip. */
  title: string;
}

/**
 * How the accounts' syncs stand, in one light and a few words: the status
 * bar's and Settings → Sync's. An account counts as synced when its last
 * sync succeeded within the staleness window; syncing one account doesn't
 * vouch for the others.
 */
export function syncSummary(
  accounts: SyncAccount[],
  unit: 'accounts' | 'registrars',
): SyncSummary {
  const count = (state: ReturnType<typeof accountSyncState>) =>
    accounts.filter((a) => accountSyncState(a) === state).length;
  const total = accounts.length;
  const failed = count('failed');
  const stale = count('stale');
  const synced = count('synced');
  const one = (n: number) => (n === 1 ? unit.replace(/s$/, '') : unit);
  const level: SyncLevel =
    failed > 0 ? 'error' : total > 0 && synced === total ? 'ok' : 'warn';
  return {
    total,
    synced,
    failed,
    stale,
    level,
    label:
      total === 0
        ? `No ${unit} to sync`
        : failed > 0
          ? `${failed} of ${total} ${one(total)} failed`
          : stale > 0
            ? `${stale} of ${total} ${one(total)} stale`
            : `${synced}/${total} ${unit} synced`,
    short:
      total === 0
        ? `No ${unit}`
        : failed > 0
          ? `${failed} failed`
          : stale > 0
            ? `${stale} stale`
            : `${synced}/${total} synced`,
    title:
      total === 0
        ? `No ${unit} set up`
        : failed > 0
          ? `${failed} ${one(failed)} failed to sync`
          : stale > 0
            ? `${stale} ${one(stale)} not synced in over a week`
            : synced === total
              ? `All ${unit} synced`
              : `${total - synced} ${one(total - synced)} not synced yet`,
  };
}

/** Still within the cooldown window after the last sync. */
function onCooldown(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < SYNC_COOLDOWN_MS;
}

const plural = (n: number, noun: string) =>
  `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;

/** What a Sync covers: everything (Sync now), or one Settings page's Sync all. */
type SyncScope = 'all' | 'registrars' | 'markets';

/** Syncs every enabled account in scope, registrars first so a market sale's
 * "still held?" check sees the fresh portfolio, then sums up how it went in a
 * toast: the count synced, how many failed (their errors are on their cards
 * in Settings), or why the whole sync failed. */
async function syncAndReport(scope: SyncScope) {
  const {
    loadPortfolio,
    loadRegistrars,
    syncMarkets,
    registrars: registrarsBefore,
    marketAccounts,
    marketCatalog,
  } = useAppStore.getState();
  const withMarkets =
    scope !== 'registrars' && syncAccounts(null, marketAccounts).length > 0;
  // What this Sync covers, as each account last tried, for its progress.
  const covered = syncAccounts(
    scope === 'markets' ? [] : registrarsBefore,
    withMarkets ? marketAccounts : [],
    marketCatalog,
  );
  // Up front, so the pass reads as one sync: nothing looks done between the
  // registrars and the markets.
  useAppStore.setState({
    syncBaseline: syncBaseline(covered),
    ...(withMarkets && { marketsSyncing: true }),
  });
  // Registrars sync all at once in core, each saving its own result as it
  // finishes: re-read them meanwhile so the count moves. Market accounts
  // sync one at a time from here, each landing as it's done.
  const watch =
    scope !== 'markets'
      ? setInterval(() => void loadRegistrars().catch(() => {}), 1000)
      : null;
  let marketsError: string | null = null;
  try {
    if (scope !== 'markets') await loadPortfolio();
    if (watch) clearInterval(watch);
    if (withMarkets)
      await syncMarkets().catch((err) => {
        marketsError = err instanceof Error ? err.message : String(err);
      });
  } finally {
    if (watch) clearInterval(watch);
    useAppStore.setState({ marketsSyncing: false, syncBaseline: null });
  }

  const state = useAppStore.getState();
  const registrars =
    scope === 'markets'
      ? []
      : (state.registrars ?? []).filter((r) => r.configured && r.enabled);
  const markets = withMarkets
    ? (state.marketAccounts ?? []).filter((a) => a.configured && a.enabled)
    : [];
  const count = registrars.length + markets.length;
  const failed =
    (scope === 'markets' ? 0 : state.portfolioErrors.length) +
    markets.filter((a) => a.sync?.lastError).length;
  const listings = markets.reduce((n, a) => n + (a.sync?.listings ?? 0), 0);
  const unit =
    scope === 'markets'
      ? 'market account'
      : markets.length > 0
        ? 'account'
        : 'registrar';
  const synced = [
    registrars.length > 0 && plural(state.portfolio.length, 'domain'),
    markets.length > 0 && plural(listings, 'listing'),
  ].filter(Boolean);

  if (scope !== 'markets' && state.portfolioError)
    toast.error(`Sync failed: ${state.portfolioError}`);
  else if (marketsError) toast.error(`Market sync failed: ${marketsError}`);
  else if (failed > 0)
    toast.warning(
      `${failed} of ${count} failed to sync. The error is on ${failed === 1 ? 'its card' : 'their cards'}.`,
    );
  else
    toast.success(
      `Synced ${plural(count, unit)}${synced.length ? `: ${synced.join(', ')}` : ''}`,
    );
}

/**
 * Shared sync state + action, so the status bar, the Domains Sync button,
 * Settings → Registrars and Markets, and the phone menu item all agree. A
 * Sync covers every enabled registrar and market account. Includes a
 * self-contained ticker that re-renders every 30s (to keep the relative
 * "last synced" label current) and once more the moment the cooldown lifts
 * (to re-enable the control on its own).
 */
export function useSyncState() {
  const portfolioLoading = useAppStore((s) => s.portfolioLoading);
  const marketsSyncing = useAppStore((s) => s.marketsSyncing);
  const portfolioLoadedAt = useAppStore((s) => s.portfolioLoadedAt);
  const portfolioSource = useAppStore((s) => s.portfolioSource);
  const portfolioError = useAppStore((s) => s.portfolioError);
  const portfolioErrors = useAppStore((s) => s.portfolioErrors);
  const registrars = useAppStore((s) => s.registrars);
  const marketAccounts = useAppStore((s) => s.marketAccounts);
  const marketCatalog = useAppStore((s) => s.marketCatalog);
  // A sync mid-job would race the job's per-row cache patches for no benefit.
  const bulkRunning = useAppStore((s) => s.bulk?.status === 'running');
  const baseline = useAppStore((s) => s.syncBaseline);

  const accounts = syncAccounts(registrars, marketAccounts, marketCatalog);
  const unit = syncUnit(registrars, accounts);
  const noneConfigured =
    registrars !== null &&
    registrars.every((r) => !r.configured) &&
    !(marketAccounts ?? []).some((a) => a.configured);
  const staleCount = staleAccounts(accounts).length;
  const marketFailed = accounts.some(
    (a) => a.kind === 'market' && a.lastError != null,
  );
  // The newest good sync of any account: the portfolio's, or a market
  // account's (synced on its own, or with no registrar at all).
  const newest = Math.max(
    portfolioLoadedAt ?? 0,
    ...accounts.map((a) => (a.kind === 'market' ? (a.lastSyncedAt ?? 0) : 0)),
  );
  const lastSyncedAt = newest > 0 ? newest : null;
  const stale =
    (lastSyncedAt !== null && isStale(lastSyncedAt)) || staleCount > 0;
  // The demo syncs as it boots (and Reset demo reloads), so the first visit
  // would open on a cooldown nobody caused. Its boot result is read from the
  // cache: let that one sync again straight away.
  const bootSync = isDemo() && portfolioSource === 'cache';
  const tooSoon =
    portfolioLoadedAt !== null && onCooldown(portfolioLoadedAt) && !bootSync;
  const syncing = portfolioLoading || marketsSyncing;
  // A Sync's count of accounts done; a single account's sync has none.
  const progress =
    syncing && baseline ? syncProgress(accounts, baseline) : null;

  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (lastSyncedAt === null) return;
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [lastSyncedAt]);
  useEffect(() => {
    if (portfolioLoadedAt === null) return;
    const remaining = SYNC_COOLDOWN_MS - (Date.now() - portfolioLoadedAt);
    if (remaining <= 0) return;
    const t = setTimeout(tick, remaining + 50);
    return () => clearTimeout(t);
  }, [portfolioLoadedAt]);

  const title = bulkRunning
    ? 'A bulk action is running — sync when it finishes'
    : noneConfigured
      ? 'Add a registrar or market account in Settings first'
      : lastSyncedAt !== null
        ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}${
            tooSoon
              ? ' — just synced, try again in a minute'
              : staleCount > 0
                ? ` — ${staleCount} ${staleCount === 1 ? 'account' : 'accounts'} not synced in over a week, click to sync`
                : stale
                  ? ' — data may be stale, click to sync'
                  : ' — click to sync'
          }`
        : 'Click to sync your portfolio';

  // Why a sync can't run now, short enough for a toast.
  const reason = bulkRunning
    ? 'A bulk action is running. Sync when it finishes.'
    : noneConfigured
      ? 'Add a registrar or market account in Settings first.'
      : tooSoon
        ? 'Just synced. Try again in a minute.'
        : null;
  // The same, in a couple of words for a menu row.
  const shortReason = bulkRunning
    ? 'Bulk action running'
    : noneConfigured
      ? 'No accounts'
      : tooSoon
        ? 'Just synced'
        : null;

  return {
    /** Every enabled registrar, then every enabled market account. */
    sync: () => void syncAndReport('all'),
    /** Settings → Registrars' Sync all: the registrars alone. */
    syncRegistrars: () => void syncAndReport('registrars'),
    /** Settings → Markets' Sync all: the market accounts alone. */
    syncMarkets: () => void syncAndReport('markets'),
    reason,
    shortReason,
    tooSoon,
    syncing,
    /** A running Sync's accounts done of its total; null otherwise. */
    progress,
    /** "Syncing 15/17 accounts…" (or "Syncing…"), for a status line. */
    syncingLabel: syncingText(progress, unit),
    /** "Syncing 15/17…", for a button or a tight spot. */
    syncingShort: syncingText(progress),
    /** Registrars or markets, as their own cards show it. */
    registrarsSyncing: portfolioLoading,
    marketsSyncing,
    bulkRunning,
    disabled: syncing || tooSoon || noneConfigured || bulkRunning,
    title,
    lastSyncedAt,
    stale,
    staleCount,
    noneConfigured,
    /** The accounts a Sync covers, and what to call them in a count. */
    accounts,
    unit,
    /** Both kinds of account have loaded, so counts won't jump. */
    loaded: registrars !== null && marketAccounts !== null,
    // A whole-portfolio failure, or one/more accounts that failed in the last
    // pull — surfaced as a compact error state alongside the last-synced time.
    failed: portfolioError != null,
    errorMessage: portfolioError,
    partialFail:
      portfolioError == null && (portfolioErrors.length > 0 || marketFailed),
  };
}
