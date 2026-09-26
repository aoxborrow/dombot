import { useEffect, useReducer } from 'react';
import { Clock, RefreshCw, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAppStore } from '../store/app';
import { timeAgo } from '../lib/time';
import { ActivityBell } from './activity/ActivityBell';

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
 * Shared sync state + action, so the desktop control, the mobile status caption,
 * and the mobile menu item all agree. Includes a self-contained ticker that
 * re-renders every 30s (to keep the relative "last synced" label current) and
 * once more the moment the cooldown lifts (to re-enable the control on its own).
 */
export function useSyncState() {
  const portfolioLoading = useAppStore((s) => s.portfolioLoading);
  const portfolioLoadedAt = useAppStore((s) => s.portfolioLoadedAt);
  const portfolioError = useAppStore((s) => s.portfolioError);
  const portfolioErrors = useAppStore((s) => s.portfolioErrors);
  const registrars = useAppStore((s) => s.registrars);
  const loadPortfolio = useAppStore((s) => s.loadPortfolio);
  // A sync mid-job would race the job's per-row cache patches for no benefit.
  const bulkRunning = useAppStore((s) => s.bulk?.status === 'running');

  const noneConfigured =
    registrars !== null && registrars.every((r) => !r.configured);
  const stale = portfolioLoadedAt !== null && isStale(portfolioLoadedAt);
  const tooSoon = portfolioLoadedAt !== null && onCooldown(portfolioLoadedAt);

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

  return {
    sync: () => void loadPortfolio(),
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

/**
 * The global "Sync domains" control, shown in the top navbar on desktop: syncs
 * every configured registrar (outlined button, amber past the staleness
 * threshold) with the last-synced time just below it. On phones the header shows
 * `SyncStatusMini` instead and the action lives in the hamburger menu.
 */
export default function SyncControl() {
  const { sync, syncing, disabled, title, lastSyncedAt, stale } =
    useSyncState();

  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <ActivityBell />
      {/* The "ago" caption is dropped between sm and md, where the header has
          no room for it beside the nav (the Sync button's tooltip still has the
          timestamp). */}
      {lastSyncedAt !== null && (
        <span
          className={cn(
            'hidden items-center gap-1 text-[11px] whitespace-nowrap text-muted-foreground/60 md:inline-flex',
            stale && 'text-amber-600 dark:text-amber-400',
          )}
          title={`Last synced ${new Date(lastSyncedAt).toLocaleString()}`}
        >
          <Clock className="size-3" aria-hidden />
          {timeAgo(lastSyncedAt)}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={sync}
        disabled={disabled}
        title={title}
        className={cn(
          stale &&
            'border-amber-500/50 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-950/60 dark:hover:text-amber-300',
        )}
      >
        <RefreshCw className={cn(syncing && 'animate-spin')} />
        {syncing ? 'Syncing…' : 'Sync'}
      </Button>
    </div>
  );
}

/**
 * Phone-only compact sync status, shown right-justified to the left of the
 * hamburger. Reflects the live state: "Syncing…" while a pull runs, a red
 * "Sync failed" when the last pull errored, otherwise the relative last-synced
 * time (amber when stale or some accounts failed). The action itself is in the
 * hamburger menu.
 */
export function SyncStatusMini({ className }: { className?: string }) {
  const { syncing, lastSyncedAt, stale, failed, errorMessage, partialFail } =
    useSyncState();

  const base =
    'inline-flex items-center gap-1 text-[11px] whitespace-nowrap text-muted-foreground/70';

  if (syncing) {
    return (
      <span className={cn(base, className)}>
        <RefreshCw className="size-3 animate-spin" aria-hidden />
        Syncing…
      </span>
    );
  }
  if (failed) {
    return (
      <span
        className={cn(base, 'text-destructive', className)}
        title={errorMessage ?? undefined}
      >
        <TriangleAlert className="size-3" aria-hidden />
        Sync failed
      </span>
    );
  }
  if (lastSyncedAt === null) return null;
  return (
    <span
      className={cn(
        base,
        (stale || partialFail) && 'text-amber-600 dark:text-amber-400',
        className,
      )}
      title={
        partialFail
          ? `Last synced ${new Date(lastSyncedAt).toLocaleString()} — some accounts failed`
          : `Last synced ${new Date(lastSyncedAt).toLocaleString()}`
      }
    >
      <Clock className="size-3" aria-hidden />
      {timeAgo(lastSyncedAt)}
    </span>
  );
}
