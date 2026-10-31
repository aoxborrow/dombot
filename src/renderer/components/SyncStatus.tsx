import { CircleAlert, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isStale, type SyncLevel, type SyncSummary } from '../lib/sync-state';
import { timeAgo } from '../lib/time';

// The sync status as the status bar shows it, shared with Settings → Sync so
// the two always read the same.

/** Text colour for each level; muted stays the surrounding colour. */
export const SYNC_TONE: Record<SyncLevel, string> = {
  ok: '',
  warn: 'text-amber-500 dark:text-amber-400',
  error: 'text-destructive',
};

/**
 * The light: a spinner while syncing, an alert icon when an account failed,
 * otherwise a dot, green when every account synced and amber when not.
 */
export function SyncLight({
  level,
  syncing = false,
}: {
  level: SyncLevel;
  syncing?: boolean;
}) {
  if (syncing) return <RefreshCw className="size-3 animate-spin" aria-hidden />;
  if (level === 'error')
    return <CircleAlert className="size-3.5 shrink-0" aria-hidden />;
  return (
    <span
      className={cn(
        'size-2 shrink-0 rounded-full',
        level === 'ok' ? 'bg-brand' : 'bg-amber-500 dark:bg-amber-400',
      )}
      aria-hidden
    />
  );
}

/**
 * The light and its words ("14/14 accounts synced"). With `short`, the words
 * drop to the summary's short form below lg, where the status bar is tight.
 */
export function SyncStatusLabel({
  summary,
  syncing,
  short = false,
}: {
  summary: SyncSummary;
  syncing: boolean;
  short?: boolean;
}) {
  const label = syncing ? 'Syncing…' : summary.label;
  return (
    <>
      <SyncLight level={summary.level} syncing={syncing} />
      {short ? (
        <>
          <span className="hidden lg:inline">{label}</span>
          <span className="lg:hidden">{syncing ? label : summary.short}</span>
        </>
      ) : (
        <span>{label}</span>
      )}
    </>
  );
}

/** "· 3 mins ago", amber once even the newest sync is over a week old. */
export function SyncTime({
  at,
  className,
}: {
  at: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        isStale(at) && 'text-amber-500 dark:text-amber-400',
        className,
      )}
      title={`Last synced ${new Date(at).toLocaleString()}`}
    >
      <span aria-hidden className="mr-1.5 text-muted-foreground">
        ·
      </span>
      {timeAgo(at)}
    </span>
  );
}
