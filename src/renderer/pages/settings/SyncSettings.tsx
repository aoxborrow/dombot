import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  accountSyncState,
  syncSummary,
  useSyncState,
  type SyncAccount,
} from '../../lib/sync-state';
import { timeAgo } from '../../lib/time';
import { useAppStore } from '../../store/app';
import {
  SYNC_TONE,
  SyncLight,
  SyncStatusLabel,
  SyncTime,
} from '../../components/SyncStatus';
import { SettingsCard, SettingsField } from './SettingsCard';

/** Auto-sync interval choices (minutes). `0` disables the background sync. */
const INTERVAL_OPTIONS: { label: string; minutes: number }[] = [
  { label: 'Every hour', minutes: 60 },
  { label: 'Every 6 hours', minutes: 360 },
  { label: 'Every 12 hours', minutes: 720 },
  { label: 'Every 24 hours', minutes: 1440 },
  { label: 'Every 48 hours', minutes: 2880 },
  { label: 'Every 7 days', minutes: 10080 },
  { label: 'Off', minutes: 0 },
];

const DEFAULT_INTERVAL_MINUTES = 1440;

/**
 * Sync settings. DomBot caches your portfolio, per-domain detail, renewal
 * prices, and market listings on disk (timestamped) so the app opens fully
 * populated with no network calls. This tab syncs every registrar and market
 * account now, shows how they stand (the status bar links here), sets the
 * background sync that keeps the cache fresh, and clears the cache.
 */
export default function SyncSettings() {
  const clearAllCaches = useAppStore((s) => s.clearAllCaches);
  const settings = useAppStore((s) => s.settings);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const setAutoSyncInterval = useAppStore((s) => s.setAutoSyncInterval);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const onClear = async () => {
    setClearing(true);
    setCleared(false);
    try {
      await clearAllCaches();
      setCleared(true);
    } finally {
      setClearing(false);
    }
  };

  const stored = settings?.autoSyncIntervalMinutes ?? null;
  // A value that isn't a preset (only reachable outside the UI) shows as the
  // default rather than an empty select.
  const interval =
    stored != null && !INTERVAL_OPTIONS.some((o) => o.minutes === stored)
      ? DEFAULT_INTERVAL_MINUTES
      : stored;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold">Sync</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          DomBot keeps a copy of your portfolio and refreshes it from your
          registrars and markets on a schedule, so it opens instantly and their
          APIs aren&apos;t hit more often than needed.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <SyncAllRow />
        <NeedsAttention />
      </div>

      <SettingsCard title="Auto-sync">
        <SettingsField
          label="Sync frequency"
          htmlFor="auto-sync-interval"
          description="How often DomBot re-syncs every registrar and market account in the background, registrars first. Larger portfolios may prefer a longer interval or Off."
        >
          <div className="flex items-center gap-3">
            <Select
              value={interval == null ? undefined : String(interval)}
              onValueChange={(v) => void setAutoSyncInterval(Number(v))}
            >
              <SelectTrigger id="auto-sync-interval" className="w-52">
                <SelectValue placeholder="Loading…" />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.minutes} value={String(opt.minutes)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {interval === 0 && (
              <span className="text-sm text-muted-foreground">
                Auto-sync is off — use Sync now, or the agent’s sync tools.
              </span>
            )}
          </div>
        </SettingsField>
      </SettingsCard>

      <SettingsCard title="Cached data" contentClassName="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Clear the cached portfolio and market listings and start over. Your
          saved registrar and market keys, manual prices, and folders are kept.
          The next Sync now re-fetches everything fresh.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="destructive"
            onClick={() => void onClear()}
            disabled={clearing}
          >
            {clearing ? 'Clearing…' : 'Clear cache'}
          </Button>
          {cleared && (
            <span className="text-sm text-muted-foreground">
              Cache cleared.
            </span>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}

/**
 * Sync every enabled account now, as Sync now on the Domains page does,
 * beside how they stand: the status bar's light and words. Above the cards,
 * where Registrars and Markets keep their own Sync all.
 */
function SyncAllRow() {
  const {
    sync,
    syncing,
    disabled,
    title,
    accounts,
    unit,
    lastSyncedAt,
    loaded,
  } = useSyncState();
  const summary = syncSummary(accounts, unit);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button
        variant="outline"
        onClick={sync}
        disabled={disabled}
        title={title}
      >
        <RefreshCw className={cn(syncing && 'animate-spin')} />
        {syncing ? 'Syncing…' : 'Sync all accounts'}
      </Button>
      {/* The button spins; the words keep the counts. */}
      {loaded && (
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span
            className={cn(
              'inline-flex items-center gap-1.5',
              SYNC_TONE[summary.level],
            )}
            title={summary.title}
          >
            <SyncStatusLabel summary={summary} syncing={false} />
          </span>
          {lastSyncedAt !== null && summary.total > 0 && !syncing && (
            <SyncTime at={lastSyncedAt} />
          )}
        </span>
      )}
    </div>
  );
}

const ATTENTION_ORDER = { failed: 0, stale: 1, unsynced: 2, synced: 3 };

/**
 * The accounts that keep the light from going green: failed, not synced in
 * over a week, or never synced, each with a link to its card.
 */
function NeedsAttention() {
  const { accounts } = useSyncState();
  const rows = accounts
    .map((account) => ({ account, state: accountSyncState(account) }))
    .filter((r) => r.state !== 'synced')
    .sort((a, b) => ATTENTION_ORDER[a.state] - ATTENTION_ORDER[b.state]);
  if (rows.length === 0) return null;
  return (
    <SettingsCard title="Needs attention" contentClassName="py-1">
      <ul className="divide-y">
        {rows.map(({ account, state }) => (
          <AttentionRow
            key={`${account.kind}:${account.id}`}
            account={account}
            state={state}
          />
        ))}
      </ul>
    </SettingsCard>
  );
}

function AttentionRow({
  account,
  state,
}: {
  account: SyncAccount;
  state: ReturnType<typeof accountSyncState>;
}) {
  const level = state === 'failed' ? 'error' : 'warn';
  const detail =
    state === 'failed'
      ? (account.lastError ?? 'Sync failed')
      : state === 'stale'
        ? `Last synced ${timeAgo(account.lastSyncedAt!)}`
        : 'Not synced yet';
  const market = account.kind === 'market';
  return (
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 py-2.5 text-sm">
      <span
        className={cn('flex w-3.5 shrink-0 justify-center', SYNC_TONE[level])}
      >
        <SyncLight level={level} />
      </span>
      <span className="shrink-0 font-medium">{account.name}</span>
      {/* Under the name on phones, beside it from sm up. */}
      <span
        className="min-w-0 text-muted-foreground max-sm:order-last max-sm:basis-full max-sm:pl-6 sm:flex-1 sm:truncate"
        title={detail}
      >
        {detail}
      </span>
      <Link
        to={`/settings?tab=${market ? 'markets' : 'registrars'}`}
        className="ml-auto shrink-0 text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        {market ? 'Market settings' : 'Registrar settings'}
      </Link>
    </li>
  );
}
