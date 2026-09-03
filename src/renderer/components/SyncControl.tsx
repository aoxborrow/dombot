import { useEffect, useReducer } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAppStore } from '../store/app';
import { timeAgo } from '../lib/time';

/** Minimum gap between manual syncs — the button is disabled during it so a fresh
 * pull can't be hammered (every sync re-queries every registrar). */
const SYNC_COOLDOWN_MS = 60 * 1000; // 1 minute

/** How old the portfolio can get before the Sync button turns amber to nudge a
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

/**
 * The global "Sync domains" control, shown in the top navbar: syncs every
 * configured registrar (outlined button, amber past the staleness threshold)
 * with the last-synced time just below it. Reads/acts entirely through the store
 * so it works from any route.
 */
export default function SyncControl() {
  const portfolioLoading = useAppStore((s) => s.portfolioLoading);
  const portfolioLoadedAt = useAppStore((s) => s.portfolioLoadedAt);
  const registrars = useAppStore((s) => s.registrars);
  const loadPortfolio = useAppStore((s) => s.loadPortfolio);

  const noneConfigured =
    registrars !== null && registrars.every((r) => !r.configured);
  const stale = portfolioLoadedAt !== null && isStale(portfolioLoadedAt);
  const tooSoon = portfolioLoadedAt !== null && onCooldown(portfolioLoadedAt);

  // Re-render every 30s so the relative "Last synced" label stays current, and
  // once more the moment the cooldown lifts so the button re-enables on its own.
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

  return (
    <div className="flex items-center gap-2.5">
      {portfolioLoadedAt !== null && (
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[11px] text-muted-foreground/60',
            stale && 'text-amber-600 dark:text-amber-400',
          )}
          title={`Last synced ${new Date(portfolioLoadedAt).toLocaleString()}`}
        >
          <Clock className="size-3" aria-hidden />
          {timeAgo(portfolioLoadedAt)}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => void loadPortfolio()}
        disabled={portfolioLoading || tooSoon || noneConfigured}
        title={
          noneConfigured
            ? 'Configure a registrar in Settings first'
            : portfolioLoadedAt !== null
              ? `Last synced ${new Date(portfolioLoadedAt).toLocaleString()}${
                  tooSoon
                    ? ' — just synced, try again in a minute'
                    : stale
                      ? ' — data may be stale, click to sync'
                      : ' — click to sync'
                }`
              : 'Click to sync your portfolio'
        }
        className={cn(
          stale &&
            'border-amber-500/50 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-950/60 dark:hover:text-amber-300',
        )}
      >
        <RefreshCw className={cn(portfolioLoading && 'animate-spin')} />
        {portfolioLoading ? 'Syncing…' : 'Sync'}
      </Button>
    </div>
  );
}
