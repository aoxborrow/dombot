import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  isSealedBundle,
  openBundle,
  sealBundle,
} from '../../../shared/bundle-seal';
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

const DEFAULT_INTERVAL_MINUTES = 1440;

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
        <h2 className="text-xl font-bold">Sync</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          DomBot keeps a copy of your portfolio and refreshes it from the
          registrars on a schedule, so it opens instantly and registrar APIs
          aren&apos;t hit more often than needed.
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

      <DataBundleCard />

      <SettingsCard title="Cached data" contentClassName="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Clear the cached portfolio and start over. Your saved registrar
          credentials, manual prices, and folders are kept. The next “Sync
          domains” re-fetches everything fresh.
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
 * Export / import of the whole store as one JSON file: the backup for a
 * self-hosted instance (its data is unreadable without the root secret), the
 * way to move from the desktop app to a web instance, and what secret
 * rotation round-trips through. Optionally sealed with a passphrase, since
 * the file holds registrar API keys.
 */
function DataBundleCard() {
  const [exportPass, setExportPass] = useState('');
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{
    name: string;
    text: string;
    sealed: boolean;
  } | null>(null);
  const [importPass, setImportPass] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const onExport = async () => {
    setExporting(true);
    try {
      let text = await window.api.exportData();
      if (exportPass) text = await sealBundle(text, exportPass);
      const stamp = new Date().toISOString().slice(0, 10);
      const result = await window.api.saveTextFile(
        text,
        `dombot-data-${stamp}.json`,
      );
      if (result.saved) toast.success('Data exported');
    } catch (err) {
      toast.error('Export failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setExporting(false);
    }
  };

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setImportPass('');
    setImportError(null);
    setPending({ name: file.name, text, sealed: isSealedBundle(text) });
  };

  const onImport = async () => {
    if (!pending) return;
    setImporting(true);
    setImportError(null);
    try {
      const text = pending.sealed
        ? await openBundle(pending.text, importPass)
        : pending.text;
      const { namespaces, entries } = await window.api.importData(text);
      toast.success(
        `Imported ${entries} item${entries === 1 ? '' : 's'} across ${namespaces} section${namespaces === 1 ? '' : 's'}`,
      );
      setPending(null);
      // Every screen holds derived state; a reload is the honest refresh.
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <SettingsCard
      title="Export & import"
      contentClassName="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Export everything — registrar keys, portfolio, folders, prices,
          settings, and MCP pairings — as one JSON file. Use it as a backup or
          to move to another DomBot. The file contains your API keys, so
          consider a passphrase.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="export-pass" className="text-xs">
              Passphrase (optional)
            </Label>
            <Input
              id="export-pass"
              type="password"
              autoComplete="new-password"
              className="w-56"
              value={exportPass}
              onChange={(e) => setExportPass(e.target.value)}
            />
          </div>
          <Button onClick={() => void onExport()} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export data'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t pt-5">
        <p className="text-sm text-muted-foreground">
          Import a DomBot data file. This <b>replaces</b> everything stored here
          with the file&apos;s contents.
        </p>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              void onPick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            Import data…
          </Button>
        </div>
      </div>

      <Dialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace all data?</DialogTitle>
            <DialogDescription>
              Everything currently stored — registrar keys, portfolio, folders,
              prices, settings, MCP pairings — will be replaced with the
              contents of <span className="font-mono">{pending?.name}</span>.
              This can&apos;t be undone; export first if you want a copy.
            </DialogDescription>
          </DialogHeader>
          {pending?.sealed && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-pass" className="text-xs">
                Passphrase
              </Label>
              <Input
                id="import-pass"
                type="password"
                autoComplete="off"
                value={importPass}
                onChange={(e) => setImportPass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void onImport()}
              />
            </div>
          )}
          {importError && (
            <p className="text-sm text-destructive">{importError}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPending(null)}
              disabled={importing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void onImport()}
              disabled={importing || (pending?.sealed && !importPass)}
            >
              {importing ? 'Importing…' : 'Replace and import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
