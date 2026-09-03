import { getConfiguredRegistrars, getPortfolio } from './registrars';
import { broadcastPortfolioChanged } from '../events';

// Periodic background portfolio sync. The UI never auto-refreshes (the user
// hits Sync), but an MCP-only user may never open the window, so the cache the
// MCP tools serve would otherwise only refresh when an agent explicitly calls
// portfolio_sync / registrar_sync. This timer keeps that cache warm on its own
// while the app runs, and broadcasts portfolioChanged so an open Domains table
// reflects each refresh too.
//
// Interval is DOMBOT_SYNC_INTERVAL_MINUTES (default 24h); set it to 0 to
// disable. Conservative by design — one pass across every configured registrar
// is real API traffic. (Distinct from STALE_AFTER_MS, the 14-day threshold that
// flags data as stale and TTLs the per-domain detail cache; a daily refresh
// keeps the cache comfortably inside that window.)

const DEFAULT_INTERVAL_MINUTES = 24 * 60;

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

/** Configured interval in ms, or 0 when disabled (0 / negative / non-numeric). */
function intervalMs(): number {
  const raw = process.env.DOMBOT_SYNC_INTERVAL_MINUTES;
  const minutes =
    raw != null && raw !== '' ? Number(raw) : DEFAULT_INTERVAL_MINUTES;
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

/**
 * Starts the periodic sync. Idempotent, and a no-op when disabled via
 * DOMBOT_SYNC_INTERVAL_MINUTES=0. The timer is unref'd so it never keeps the
 * process alive on its own.
 */
export function startAutoSync(): void {
  if (timer) return;
  const ms = intervalMs();
  if (ms === 0) {
    console.log('[auto-sync] disabled');
    return;
  }
  timer = setInterval(() => void syncNow(), ms);
  timer.unref();
  console.log(`[auto-sync] every ${Math.round(ms / 60_000)} min`);
}

/** Stops the periodic sync (for app teardown). */
export function stopAutoSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
