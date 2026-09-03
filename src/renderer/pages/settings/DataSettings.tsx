import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '../../store/app';
import { SettingsCard } from './SettingsCard';

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

/**
 * Data & cache settings. DomBot caches your portfolio, per-domain detail,
 * aftermarket, and renewal prices on disk (timestamped) so the app opens fully
 * populated with no network calls. This tab also controls the background sync
 * that keeps that cache fresh, and clearing the cache.
 */
export default function DataSettings() {
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

  const interval = settings?.autoSyncIntervalMinutes ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold">Cache</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          DomBot caches your portfolio, domain detail, marketplace listings, and
          renewal prices on disk so it opens instantly. It re-syncs in the
          background on the schedule below; you can also refresh any time from
          the Domains or Renewals page.
        </p>
      </div>

      <SettingsCard title="Auto-sync" contentClassName="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          How often DomBot re-syncs your whole portfolio from every configured
          registrar in the background, so the app — and any connected AI agent —
          keeps fresh data without a manual Sync. Larger portfolios may prefer a
          longer interval or Off; data older than the interval (24 hours by
          default) is flagged as stale.
        </p>
        <div className="flex items-center gap-3">
          <Select
            value={interval == null ? undefined : String(interval)}
            onValueChange={(v) => void setAutoSyncInterval(Number(v))}
          >
            <SelectTrigger className="w-52">
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
              Auto-sync is off — refresh manually or via the agent’s sync tools.
            </span>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="Cached data" contentClassName="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Clear every on-disk cache and reset the loaded portfolio. Your saved
          registrar credentials, manual prices, and folders are kept. The next
          “Sync domains” re-fetches everything fresh.
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
