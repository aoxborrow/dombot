import { multiAccountRegistrars } from '../lib/registrar-accounts';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { CircleAlert, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '../store/app';
import { timeAgo } from '../lib/time';
import { useSyncState } from '../lib/sync-state';
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

/**
 * The sync status, with one light for all of it: how many enabled accounts
 * synced (a link to Settings → Registrars), when, and the manual Sync button.
 * Red with an alert icon when an account failed, amber while some haven't
 * synced or the data is stale. On phones the words shorten and the button
 * moves to the menu.
 */
function SyncStatus() {
  const navigate = useNavigate();
  const registrars = useAppStore((s) => s.registrars);
  const state = useSyncState();
  const { sync, syncing, disabled, title, lastSyncedAt, stale } = state;

  // The desktop app menu's Sync Now does what the button does, or says why
  // it can't (just synced, a bulk job running, nothing set up).
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
  useEffect(
    () =>
      window.api.onSyncRequested(() => {
        const now = latest.current;
        if (now.syncing) return;
        if (now.disabled) toast.info(now.title);
        else now.sync();
      }),
    [],
  );

  // Hidden until the registrar metadata is known.
  if (registrars === null) return null;

  // Only enabled accounts count: a disabled one keeps its credentials but
  // never syncs. One counts as synced when its last sync succeeded.
  const enabled = registrars.filter((r) => r.configured && r.enabled);
  const unit =
    multiAccountRegistrars(registrars).size > 0 ? 'accounts' : 'registrars';
  const synced = enabled.filter(
    (r) => r.sync.lastSyncedAt != null && r.sync.lastError == null,
  ).length;
  const failed = enabled.filter((r) => r.sync.lastError != null).length;
  const one = (n: number) => (n === 1 ? unit.replace(/s$/, '') : unit);
  const tone =
    failed > 0
      ? 'text-destructive hover:text-destructive hover:brightness-125'
      : (enabled.length === 0 || synced < enabled.length) &&
        'text-amber-600 hover:text-amber-600 hover:brightness-125 dark:text-amber-400 dark:hover:text-amber-400';

  let light = (
    <span
      className={cn(
        'size-2 rounded-full',
        enabled.length > 0 && synced === enabled.length
          ? 'bg-brand'
          : 'bg-amber-500 dark:bg-amber-400',
      )}
      aria-hidden
    />
  );
  if (syncing)
    light = <RefreshCw className="size-3 animate-spin" aria-hidden />;
  else if (failed > 0) light = <CircleAlert className="size-3.5" aria-hidden />;

  const label = syncing
    ? 'Syncing…'
    : enabled.length === 0
      ? `No ${unit} to sync`
      : failed > 0
        ? `${failed} of ${enabled.length} ${one(enabled.length)} failed`
        : `${synced}/${enabled.length} ${unit} synced`;
  const short = syncing
    ? 'Syncing…'
    : enabled.length === 0
      ? `No ${unit}`
      : failed > 0
        ? `${failed} failed`
        : `${synced}/${enabled.length} synced`;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => navigate('/settings?tab=registrars')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-sm hover:text-foreground',
          !syncing && tone,
        )}
        title={
          enabled.length === 0
            ? `No ${unit} set up — open registrar settings`
            : failed > 0
              ? `${failed} ${one(failed)} failed to sync — open registrar settings`
              : synced === enabled.length
                ? `All ${unit} synced — open registrar settings`
                : `${enabled.length - synced} ${one(enabled.length - synced)} not synced yet — open registrar settings`
        }
      >
        {light}
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">{short}</span>
      </button>
      {lastSyncedAt !== null && enabled.length > 0 && !syncing && (
        <span
          className={cn(
            '-ml-1.5',
            stale && 'text-amber-600 dark:text-amber-400',
          )}
          title={`Last synced ${new Date(lastSyncedAt).toLocaleString()}`}
        >
          <span aria-hidden className="mr-1.5 text-muted-foreground">
            ·
          </span>
          {timeAgo(lastSyncedAt)}
        </span>
      )}
      {enabled.length > 0 && (
        <button
          type="button"
          onClick={sync}
          disabled={disabled}
          title={title}
          className={cn(
            'hidden h-6 items-center gap-1.5 rounded-md border px-2 font-medium text-foreground outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 sm:inline-flex dark:hover:bg-accent/50',
            stale &&
              'border-amber-500/50 text-amber-700 dark:border-amber-500/40 dark:text-amber-400',
          )}
        >
          <RefreshCw className={cn('size-3', syncing && 'animate-spin')} />
          Sync
        </button>
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
