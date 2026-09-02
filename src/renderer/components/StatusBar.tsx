import { useEffect, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAppStore } from '../store/app';
import { timeAgo } from '../lib/time';

/**
 * App-wide bottom status bar (VS Code style): a thin bar fixed across the
 * viewport bottom, with page content scrolling underneath it. Surfaces the
 * embedded MCP server's status on the left (a link into MCP settings) and the
 * last-synced time plus a Sync Domains link on the right. Shown on every route.
 */
export default function StatusBar() {
  const mcpInfo = useAppStore((s) => s.mcpInfo);
  const loadMcpInfo = useAppStore((s) => s.loadMcpInfo);
  const portfolioLoadedAt = useAppStore((s) => s.portfolioLoadedAt);
  const registrars = useAppStore((s) => s.registrars);
  const loadRegistrars = useAppStore((s) => s.loadRegistrars);
  const navigate = useNavigate();

  // Fetch the MCP endpoint once; it's static for the app's lifetime.
  useEffect(() => {
    if (mcpInfo === null) void loadMcpInfo();
  }, [mcpInfo, loadMcpInfo]);

  // Learn the registrar metadata so the pill reflects config/sync state
  // immediately (e.g. right after one is set up in Settings) and never shows
  // cached portfolio stats when nothing is actually configured.
  useEffect(() => {
    if (registrars === null) void loadRegistrars();
  }, [registrars, loadRegistrars]);

  // Re-render every 30s so the relative "last synced" label stays current even
  // when nothing else changes.
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (portfolioLoadedAt === null) return;
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [portfolioLoadedAt]);

  const mcpRunning = mcpInfo?.running ?? false;
  // Show just host:port from the endpoint (drop the scheme and /mcp path).
  const mcpEndpoint = mcpInfo?.url
    ? mcpInfo.url.replace(/^\w+:\/\//, '').replace(/\/.*$/, '')
    : null;

  // Sync status per the shared registrar metadata. A registrar counts as synced
  // when it's configured and its last sync succeeded (lastSyncedAt set, no
  // lastError). `null` = metadata not yet known.
  const configured = registrars?.filter((r) => r.configured) ?? [];
  const configuredCount = configured.length;
  const syncedCount = configured.filter(
    (r) => r.sync.lastSyncedAt != null && r.sync.lastError == null,
  ).length;
  const noneConfigured = registrars !== null && configuredCount === 0;
  const allSynced = configuredCount > 0 && syncedCount === configuredCount;
  // Show the sync pill once we know the metadata (0/0 amber when nothing is
  // configured); hide it only while that's still loading.
  const showSync = registrars !== null;
  // The "Last synced X ago" caption only makes sense once real data has loaded.
  const showRefreshed = portfolioLoadedAt !== null && configuredCount > 0;

  return (
    <footer className="fixed inset-x-0 bottom-0 z-40 flex h-[29px] items-center justify-between gap-4 border-t bg-background px-4 text-xs text-muted-foreground select-none">
      <button
        type="button"
        onClick={() => navigate('/settings?tab=mcp')}
        className="inline-flex items-center gap-1.5 rounded-sm hover:text-foreground"
        title={
          mcpRunning
            ? `MCP server listening at ${mcpInfo?.url} — open MCP settings`
            : 'MCP server is not running — open MCP settings'
        }
      >
        <span
          className={cn(
            'size-2 rounded-full',
            mcpRunning ? 'bg-[#7ac28d]' : 'bg-muted-foreground/30',
          )}
          aria-hidden
        />
        {mcpRunning && mcpEndpoint ? `MCP ${mcpEndpoint}` : 'MCP off'}
      </button>

      {(showRefreshed || showSync) && (
        <div className="flex items-center gap-3">
          {showRefreshed && (
            <span
              title={`Last synced ${new Date(portfolioLoadedAt).toLocaleString()}`}
            >
              Last synced {timeAgo(portfolioLoadedAt)}
            </span>
          )}
          {showSync && (
            <button
              type="button"
              onClick={() => navigate('/settings?tab=registrars')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-sm hover:text-foreground',
                !allSynced && 'text-amber-600 dark:text-amber-400',
              )}
              title={
                noneConfigured
                  ? 'No registrars configured — open registrar settings'
                  : allSynced
                    ? 'All configured registrars synced — open registrar settings'
                    : `${configuredCount - syncedCount} registrar(s) not synced — open registrar settings`
              }
            >
              <span
                className={cn(
                  'size-2 rounded-full',
                  allSynced ? 'bg-[#7ac28d]' : 'bg-amber-500 dark:bg-amber-400',
                )}
                aria-hidden
              />
              {syncedCount}/{configuredCount} registrars synced
            </button>
          )}
        </div>
      )}
    </footer>
  );
}
