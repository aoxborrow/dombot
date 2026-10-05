import { useEffect, useReducer } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../store/app';
import { isDemo } from './platform';

/** Minimum gap between manual syncs — the button is disabled during it so a fresh
 * pull can't be hammered (every sync re-queries every registrar). */
const SYNC_COOLDOWN_MS = 60 * 1000; // 1 minute

/** How old the portfolio can get before the sync status turns amber to nudge a
 * refresh. Separate from the cache TTL (shared STALE_AFTER_MS) — this is purely
 * the UI cue and shouldn't affect how long cached data is kept. */
const SYNC_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** At/past the staleness threshold — highlight the control to nudge a manual sync. */
function isStale(fetchedAt: number): boolean {
  return Date.now() - fetchedAt >= SYNC_STALE_AFTER_MS;
}
/** Still within the cooldown window after the last sync. */
function onCooldown(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < SYNC_COOLDOWN_MS;
}

/** Syncs every enabled account, then sums up how it went in a toast: the
 * count synced, how many failed (their errors are on their cards in Settings →
 * Registrars), or why the whole sync failed. */
async function syncAndReport() {
  await useAppStore.getState().loadPortfolio();
  const { portfolioError, portfolioErrors, portfolio, registrars } =
    useAppStore.getState();
  const count = (registrars ?? []).filter(
    (r) => r.configured && r.enabled,
  ).length;
  const unit = `registrar${count === 1 ? '' : 's'}`;
  if (portfolioError) toast.error(`Sync failed: ${portfolioError}`);
  else if (portfolioErrors.length > 0)
    toast.warning(
      `${portfolioErrors.length} of ${count} failed to sync. The error is on ${portfolioErrors.length === 1 ? 'its card' : 'their cards'}.`,
    );
  else
    toast.success(
      `Synced ${count} ${unit}: ${portfolio.length.toLocaleString('en-US')} domains`,
    );
}

/**
 * Shared sync state + action, so the status bar, Settings → Registrars, and the
 * phone menu item all agree. Includes a self-contained ticker that
 * re-renders every 30s (to keep the relative "last synced" label current) and
 * once more the moment the cooldown lifts (to re-enable the control on its own).
 */
export function useSyncState() {
  const portfolioLoading = useAppStore((s) => s.portfolioLoading);
  const portfolioLoadedAt = useAppStore((s) => s.portfolioLoadedAt);
  const portfolioSource = useAppStore((s) => s.portfolioSource);
  const portfolioError = useAppStore((s) => s.portfolioError);
  const portfolioErrors = useAppStore((s) => s.portfolioErrors);
  const registrars = useAppStore((s) => s.registrars);
  // A sync mid-job would race the job's per-row cache patches for no benefit.
  const bulkRunning = useAppStore((s) => s.bulk?.status === 'running');

  const noneConfigured =
    registrars !== null && registrars.every((r) => !r.configured);
  const stale = portfolioLoadedAt !== null && isStale(portfolioLoadedAt);
  // The demo syncs as it boots (and Reset demo reloads), so the first visit
  // would open on a cooldown nobody caused. Its boot result is read from the
  // cache: let that one sync again straight away.
  const bootSync = isDemo() && portfolioSource === 'cache';
  const tooSoon =
    portfolioLoadedAt !== null && onCooldown(portfolioLoadedAt) && !bootSync;

  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (portfolioLoadedAt === null) return;
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [portfolioLoadedAt]);
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
      ? 'Configure a registrar in Settings first'
      : portfolioLoadedAt !== null
        ? `Last synced ${new Date(portfolioLoadedAt).toLocaleString()}${
            tooSoon
              ? ' — just synced, try again in a minute'
              : stale
                ? ' — data may be stale, click to sync'
                : ' — click to sync'
          }`
        : 'Click to sync your portfolio';

  // Why a sync can't run now, short enough for a toast.
  const reason = bulkRunning
    ? 'A bulk action is running. Sync when it finishes.'
    : noneConfigured
      ? 'Add a registrar in Settings first.'
      : tooSoon
        ? 'Just synced. Try again in a minute.'
        : null;
  // The same, in a couple of words for a menu row.
  const shortReason = bulkRunning
    ? 'Bulk action running'
    : noneConfigured
      ? 'No registrars'
      : tooSoon
        ? 'Just synced'
        : null;

  return {
    sync: () => void syncAndReport(),
    reason,
    shortReason,
    tooSoon,
    syncing: portfolioLoading,
    disabled: portfolioLoading || tooSoon || noneConfigured || bulkRunning,
    title,
    lastSyncedAt: portfolioLoadedAt,
    stale,
    noneConfigured,
    // A whole-portfolio failure, or one/more accounts that failed in the last
    // pull — surfaced as a compact error state alongside the last-synced time.
    failed: portfolioError != null,
    errorMessage: portfolioError,
    partialFail: portfolioError == null && portfolioErrors.length > 0,
  };
}
