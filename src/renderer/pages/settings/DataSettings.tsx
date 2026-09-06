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

/** "90 min", "2 h", "36 h" — for an interval that isn't a preset. */
function formatMinutes(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} min`;
  return `${minutes / 60} h`;
}

/**
 * Data & cache settings. DomBot caches your portfolio, per-domain detail, and
 * renewal prices on disk (timestamped) so the app opens fully populated with no
 * network calls. This tab also controls the background sync
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
  // A value set outside the UI (the MCP tools, a hand-edited store) may not be
  // one of the presets; show it as-is rather than an empty select.
  const options =
    interval != null && !INTERVAL_OPTIONS.some((o) => o.minutes === interval)
      ? [
          ...INTERVAL_OPTIONS,
          { label: `Custom (${formatMinutes(interval)})`, minutes: interval },
        ]
      : INTERVAL_OPTIONS;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold">Cache</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          DomBot caches your portfolio info to avoid slow or too-frequent API
          calls.
        </p>
      </div>

      <SettingsCard title="Auto-sync" contentClassName="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          How often DomBot re-syncs your whole portfolio in the background.
          Larger portfolios may prefer a longer interval or Off.
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
              {options.map((opt) => (
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
