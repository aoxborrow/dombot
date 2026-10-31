import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAppStore } from '../store/app';
import { syncSummary, useSyncState, type SyncLevel } from '../lib/sync-state';
import { SYNC_TONE, SyncStatusLabel, SyncTime } from './SyncStatus';
import { ModeToggle } from './mode-toggle';
import {
  isDemo,
  isLocalWeb,
  isWeb,
  signOut,
  webAuthMode,
} from '../lib/platform';

/**
 * App-wide bottom status bar (VS Code style): a thin bar across the bottom of
 * the window, below the scrolling page area. Surfaces the
 * embedded MCP server's status on the left (a link into MCP settings) — on the
 * web build, preceded by the session status and a sign-out link — and the sync
 * status plus the manual Sync button on the right. Shown on every route.
 */
export default function StatusBar() {
  const mcpInfo = useAppStore((s) => s.mcpInfo);
  const loadMcpInfo = useAppStore((s) => s.loadMcpInfo);
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

  const mcpRunning = mcpInfo?.running ?? false;
  // Show just host:port from the endpoint (drop the scheme and /mcp path).
  const mcpEndpoint = mcpInfo?.url
    ? mcpInfo.url.replace(/^\w+:\/\//, '').replace(/\/.*$/, '')
    : null;

  return (
    <footer className="relative z-40 flex h-8 shrink-0 items-center justify-between gap-4 border-t bg-background px-4 text-xs text-muted-foreground select-none">
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
              mcpRunning ? 'bg-brand' : 'bg-muted-foreground/30',
            )}
            aria-hidden
          />
          {mcpRunning && mcpEndpoint ? `MCP ${mcpEndpoint}` : 'MCP off'}
        </button>
      </div>

      {/* Centered on the bar itself, independent of the side groups' widths.
          Hidden on phones, where the side groups already fill the bar. */}
      <ModeToggle
        bare
        className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 sm:inline-flex"
      />

      <SyncStatus />
    </footer>
  );
}

/** A warning keeps its colour on hover, a touch brighter. */
const TONE_HOVER: Record<SyncLevel, string> = {
  ok: '',
  warn: 'hover:text-amber-500 hover:brightness-125 dark:hover:text-amber-400',
  error: 'hover:text-destructive hover:brightness-125',
};

/**
 * The sync status, with one light for all of it: how many enabled registrar
 * and market accounts synced (a link to Settings → Sync, which lists any
 * that need you) and when. Syncing itself is on the Domains page and in
 * Settings (and the menu on phones). Red with an alert icon when an account
 * failed, amber while some haven't synced yet or not in over a week. The
 * time is the latest sync of any account, amber only once even that is old.
 * Below lg the words shorten so they clear the centered theme toggle.
 */
function SyncStatus() {
  const navigate = useNavigate();
  const state = useSyncState();
  const { syncing, lastSyncedAt, accounts, unit, loaded } = state;

  // The desktop app menu's Sync Now does what the Domains page's Sync does,
  // or says why it can't (just synced, a bulk job running, nothing set up).
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
  useEffect(
    () =>
      window.api.onSyncRequested(() => {
        const now = latest.current;
        if (now.syncing) return;
        if (now.disabled) toast.info(now.reason ?? now.title);
        else now.sync();
      }),
    [],
  );

  // Hidden until both kinds of account are known, so the count doesn't jump.
  if (!loaded) return null;

  const summary = syncSummary(accounts, unit);
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => navigate('/settings?tab=sync')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-sm hover:text-foreground',
          !syncing && [SYNC_TONE[summary.level], TONE_HOVER[summary.level]],
        )}
        title={`${summary.title} — open sync settings`}
      >
        <SyncStatusLabel summary={summary} syncing={syncing} short />
      </button>
      {lastSyncedAt !== null && summary.total > 0 && !syncing && (
        <SyncTime at={lastSyncedAt} className="-ml-1.5" />
      )}
    </div>
  );
}

/**
 * Web build only: how this browser is signed in, and the way out. Password
 * mode ends the session here; Cloudflare Access signs out at Access's own
 * endpoint; an external gate has nothing to sign out of from inside the app.
 */
function SessionStatus() {
  const mode = webAuthMode();
  const dot = <span className="size-2 rounded-full bg-brand" aria-hidden />;
  const link = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
    >
      {label}
    </button>
  );
  if (isDemo()) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {dot}
        Demo mode
      </span>
    );
  }
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
  if (mode === 'external' && isLocalWeb()) {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        title="Served from this computer with no login"
      >
        {dot}
        Local dev mode
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
