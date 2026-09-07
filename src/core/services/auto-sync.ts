import {
  getActiveRegistrars,
  getCachedPortfolio,
  getPortfolio,
} from './registrars';
import { getSettings } from './settings';
import { broadcastPortfolioChanged } from '../events';
import { isBulkRunning } from './bulk-jobs';

// Periodic background portfolio sync. The UI never auto-refreshes on staleness
// (the user hits Sync), but an MCP-only user may never open the window, so the
// cache the MCP tools serve would otherwise only refresh when an agent
// explicitly calls portfolio_sync / registrar_sync. This timer keeps that cache
// warm on its own while the app runs, and broadcasts portfolioChanged so an open
// Domains table reflects each refresh too.
//
// The interval is the `autoSyncIntervalMinutes` setting (default 24h; 0
// disables), adjustable live in Settings → Sync. DOMBOT_SYNC_INTERVAL_MINUTES,
// when set, overrides the setting (a dev/testing escape hatch). Conservative by
// design — one pass across every configured registrar is real API traffic.

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
// Only a host that called startAutoSync owns a timer; restartAutoSync is a
// no-op elsewhere (the web host syncs from a cron trigger instead).
let started = false;

/** Effective interval in ms, or 0 when disabled. The env override wins when set;
 *  otherwise the persisted setting drives it. */
function intervalMs(): number {
  // Read defensively: core also runs where `process` doesn't exist (Workers).
  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.DOMBOT_SYNC_INTERVAL_MINUTES;
  const minutes =
    env != null && env !== ''
      ? Number(env)
      : getSettings().autoSyncIntervalMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return minutes * 60_000;
}

/**
 * One best-effort refresh of every configured registrar, then notify windows.
 * Skips when nothing is configured, while a bulk job is patching caches, or
 * (with `ifOlderThanMs`) when the cache is already fresher than that — which
 * is how a fixed-cadence scheduler (the web host's hourly cron) honors a
 * longer configured interval. Won't stack onto a still-running pass.
 * Returns true when a sync actually ran.
 */
export async function syncAll(ifOlderThanMs?: number): Promise<boolean> {
  if (inFlight) return false;
  if (getActiveRegistrars().length === 0) return false;
  // Don't race a bulk job's per-item cache patches; the next tick retries.
  if (isBulkRunning()) return false;
  if (ifOlderThanMs !== undefined) {
    const fetchedAt = getCachedPortfolio()?.fetchedAt ?? 0;
    if (Date.now() - fetchedAt < ifOlderThanMs) return false;
  }
  inFlight = true;
  try {
    await getPortfolio(true);
    broadcastPortfolioChanged();
    console.log('[auto-sync] portfolio refreshed');
    return true;
  } catch (err) {
    // Best-effort — the next tick retries.
    console.error('[auto-sync] failed', err);
    return false;
  } finally {
    inFlight = false;
  }
}

/** (Re)schedules the timer from the current interval, clearing any existing one.
 *  A no-op interval (disabled) just leaves it stopped. The timer is unref'd so
 *  it never keeps the process alive on its own. */
function schedule(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const ms = intervalMs();
  if (ms === 0) {
    console.log('[auto-sync] disabled');
    return;
  }
  timer = setInterval(() => void syncAll(), ms);
  // Node: don't let the timer keep the process alive on its own.
  (timer as { unref?: () => void }).unref?.();
  console.log(`[auto-sync] every ${Math.round(ms / 60_000)} min`);
}

/** Starts the periodic sync (call once at app startup). */
export function startAutoSync(): void {
  started = true;
  schedule();
}

/** Re-reads the interval and reschedules — call after the setting changes so a
 *  new interval (or Off) takes effect without a relaunch. */
export function restartAutoSync(): void {
  if (started) schedule();
}

/** Stops the periodic sync (for app teardown). */
export function stopAutoSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
