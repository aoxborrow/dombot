import { useEffect, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAppStore } from '../store/app';
import { timeAgo } from '../lib/time';
import { isWeb, signOut, webAuthMode } from '../lib/platform';

/**
 * App-wide bottom status bar (VS Code style): a thin bar fixed across the
 * viewport bottom, with page content scrolling underneath it. Surfaces the
 * embedded MCP server's status on the left (a link into MCP settings) — on the
 * web build, preceded by the session status and a sign-out link — and the
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

  // Sync status per the shared registrar metadata. Only active registrars
  // (configured AND enabled) count here — a disabled one keeps its credentials
  // but never syncs, so it shouldn't drag the pill to "not synced". A registrar
  // counts as synced when its last sync succeeded (lastSyncedAt set, no
  // lastError). `null` = metadata not yet known.
  const configured = registrars?.filter((r) => r.configured && r.enabled) ?? [];
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
      <div className="flex items-center gap-4">
        {isWeb() && <SessionStatus />}
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
      </div>

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

/**
 * Web build only: how this browser is signed in, and the way out. Password
 * mode ends the session here; Cloudflare Access signs out at Access's own
 * endpoint; an external gate has nothing to sign out of from inside the app.
 */
function SessionStatus() {
  const mode = webAuthMode();
  const dot = <span className="size-2 rounded-full bg-[#7ac28d]" aria-hidden />;
  const link = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
    >
      {label}
    </button>
  );
  if (mode === 'cloudflare-access') {
    return (
      <span className="inline-flex items-center gap-1.5">
        {dot}
        Cloudflare Access ·{' '}
        {link('Sign out', () => {
          window.location.assign('/cdn-cgi/access/logout');
        })}
      </span>
    );
  }
  if (mode === 'external') {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        title="Access is controlled by a gate in front of this instance"
      >
        {dot}
        Gated externally
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {dot}
      {link('Sign out', () => void signOut())}
    </span>
  );
}
