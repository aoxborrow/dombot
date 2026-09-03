import { getConfiguredRegistrars, getPortfolio } from './registrars';
import { getSettings } from './settings';
import { broadcastPortfolioChanged } from '../events';

// Periodic background portfolio sync. The UI never auto-refreshes on staleness
// (the user hits Sync), but an MCP-only user may never open the window, so the
// cache the MCP tools serve would otherwise only refresh when an agent
// explicitly calls portfolio_sync / registrar_sync. This timer keeps that cache
// warm on its own while the app runs, and broadcasts portfolioChanged so an open
// Domains table reflects each refresh too.
//
// The interval is the `autoSyncIntervalMinutes` setting (default 24h; 0
// disables), adjustable live in Settings → Cache. DOMBOT_SYNC_INTERVAL_MINUTES,
// when set, overrides the setting (a dev/testing escape hatch). Conservative by
// design — one pass across every configured registrar is real API traffic.

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

/** Effective interval in ms, or 0 when disabled. The env override wins when set;
 *  otherwise the persisted setting drives it. */
function intervalMs(): number {
  const env = process.env.DOMBOT_SYNC_INTERVAL_MINUTES;
  const minutes =
    env != null && env !== ''
      ? Number(env)
      : getSettings().autoSyncIntervalMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return minutes * 60_000;
}

/** One best-effort refresh: sync every configured registrar and notify windows.
 *  Skips when nothing is configured, and won't stack onto a still-running pass. */
async function syncNow(): Promise<void> {
  if (inFlight) return;
  if (getConfiguredRegistrars().length === 0) return;
  inFlight = true;
  try {
    await getPortfolio(true);
    broadcastPortfolioChanged();
    console.log('[auto-sync] portfolio refreshed');
  } catch (err) {
    // Best-effort — the next tick retries.
    console.error('[auto-sync] failed', err);
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
  timer = setInterval(() => void syncNow(), ms);
  timer.unref();
  console.log(`[auto-sync] every ${Math.round(ms / 60_000)} min`);
}

/** Starts the periodic sync (call once at app startup). */
export function startAutoSync(): void {
  schedule();
}

/** Re-reads the interval and reschedules — call after the setting changes so a
 *  new interval (or Off) takes effect without a relaunch. */
export function restartAutoSync(): void {
  schedule();
}

/** Stops the periodic sync (for app teardown). */
export function stopAutoSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
