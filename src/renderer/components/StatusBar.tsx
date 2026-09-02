import { useEffect, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAppStore } from '../store/app';
import { timeAgo } from '../lib/time';

/**
 * App-wide bottom status bar (VS Code style): a thin bar fixed across the
 * viewport bottom, with page content scrolling underneath it. Surfaces the
 * embedded MCP server's status on the left (a link into MCP settings) and the
 * last-refreshed time plus a Refresh Domains link on the right. Shown on every
 * route.
 */
export default function StatusBar() {
  const mcpInfo = useAppStore((s) => s.mcpInfo);
  const loadMcpInfo = useAppStore((s) => s.loadMcpInfo);
  const portfolioLoadedAt = useAppStore((s) => s.portfolioLoadedAt);
  const portfolioRegistrars = useAppStore((s) => s.portfolioRegistrars);
  const portfolioErrors = useAppStore((s) => s.portfolioErrors);
  const hasConfiguredRegistrars = useAppStore((s) => s.hasConfiguredRegistrars);
  const loadRegistrarConfigured = useAppStore((s) => s.loadRegistrarConfigured);
  const navigate = useNavigate();

  // Fetch the MCP endpoint once; it's static for the app's lifetime.
  useEffect(() => {
    if (mcpInfo === null) void loadMcpInfo();
  }, [mcpInfo, loadMcpInfo]);

  // Learn whether any registrar is configured so we never show cached portfolio
  // stats (last-refreshed, N/N connected) when nothing is actually connected.
  useEffect(() => {
    if (hasConfiguredRegistrars === null) void loadRegistrarConfigured();
  }, [hasConfiguredRegistrars, loadRegistrarConfigured]);

  // Re-render every 30s so the relative "refreshed" label stays current even
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

  // Registrar connection status: every configured (queried) registrar minus the
  // ones that errored on the last load. When nothing is configured we force the
  // display to 0/0 (amber) — the cached portfolioRegistrars are orphaned.
  const noneConfigured = hasConfiguredRegistrars === false;
  const erroredIds = new Set(portfolioErrors.map((e) => e.registrar));
  const configuredCount = noneConfigured ? 0 : portfolioRegistrars.length;
  const connectedCount = noneConfigured
    ? 0
    : portfolioRegistrars.filter((r) => !erroredIds.has(r)).length;
  const allConnected = !noneConfigured && connectedCount === configuredCount;
  // Show the connection pill whenever we know the config state: 0/0 when nothing
  // is configured, else the live N/N. Hide only while config is still unknown.
  const showConnection = noneConfigured || configuredCount > 0;
  // The "Refreshed X ago" caption only makes sense once real data has loaded.
  const showRefreshed = portfolioLoadedAt !== null && !noneConfigured;

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

      {(showRefreshed || showConnection) && (
        <div className="flex items-center gap-3">
          {showRefreshed && (
            <span
              title={`Refreshed ${new Date(portfolioLoadedAt).toLocaleString()}`}
            >
              Refreshed {timeAgo(portfolioLoadedAt)}
            </span>
          )}
          {showConnection && (
            <button
              type="button"
              onClick={() => navigate('/settings?tab=registrars')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-sm hover:text-foreground',
                !allConnected && 'text-amber-600 dark:text-amber-400',
              )}
              title={
                noneConfigured
                  ? 'No registrars configured — open registrar settings'
                  : allConnected
                    ? 'All configured registrars connected — open registrar settings'
                    : `${configuredCount - connectedCount} registrar(s) failed to connect — open registrar settings`
              }
            >
              <span
                className={cn(
                  'size-2 rounded-full',
                  allConnected
                    ? 'bg-[#7ac28d]'
                    : 'bg-amber-500 dark:bg-amber-400',
                )}
                aria-hidden
              />
              {connectedCount}/{configuredCount} registrars connected
            </button>
          )}
        </div>
      )}
    </footer>
  );
}
