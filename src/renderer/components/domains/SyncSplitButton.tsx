import { ChevronDown, Plug, RefreshCw, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useSyncState } from '../../lib/sync-state';
import { timeAgo } from '../../lib/time';

/** A muted, right-aligned count in a menu row. */
function Count({ n }: { n: number }) {
  return (
    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
      {n.toLocaleString('en-US')}
    </span>
  );
}

/**
 * The Domains header's data actions: "Sync now" joined to a chevron that opens
 * the rest (registrar settings, import, CSV export). The sync half follows the
 * shared sync state (spinning and disabled mid-sync, cooling down after one);
 * the chevron stays usable throughout. On phones the sync half drops to its
 * icon.
 */
export function SyncSplitButton({
  registrarCount,
  viewCount,
  allCount,
  onImport,
  onExportView,
  onExportAll,
}: {
  registrarCount: number;
  /** Rows in the current filtered view / in the whole list, for export. */
  viewCount: number;
  allCount: number;
  onImport: () => void;
  onExportView: () => void;
  onExportAll: () => void;
}) {
  const navigate = useNavigate();
  const { sync, syncing, disabled, title, lastSyncedAt, stale } =
    useSyncState();

  return (
    <div className="flex shrink-0 items-center gap-3">
      {lastSyncedAt !== null && !syncing && (
        <span
          className={cn(
            'hidden text-xs text-muted-foreground sm:inline',
            stale && 'text-amber-600 dark:text-amber-400',
          )}
          title={`Last synced ${new Date(lastSyncedAt).toLocaleString()}`}
        >
          Synced {timeAgo(lastSyncedAt)}
        </span>
      )}
      <div className="flex">
        <Button
          onClick={sync}
          disabled={disabled}
          title={title}
          aria-label={syncing ? 'Syncing' : 'Sync now'}
          className="rounded-r-none max-sm:w-9 max-sm:px-0!"
        >
          <RefreshCw className={cn(syncing && 'animate-spin')} />
          <span className="max-sm:sr-only">
            {syncing ? 'Syncing…' : 'Sync now'}
          </span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="More data actions"
              className="w-8 rounded-l-none border-l border-primary-foreground/25 px-0"
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem disabled={disabled} onSelect={sync}>
              <RefreshCw className={cn(syncing && 'animate-spin')} />
              {syncing ? 'Syncing…' : 'Sync now'}
              {registrarCount > 0 && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {registrarCount} registrar{registrarCount === 1 ? '' : 's'}
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => navigate('/settings?tab=registrars')}
            >
              <Plug />
              Registrar settings…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onImport}>
              <Upload />
              Import domains…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Export CSV
            </DropdownMenuLabel>
            <DropdownMenuItem
              disabled={viewCount === 0}
              onSelect={onExportView}
            >
              This view
              <Count n={viewCount} />
            </DropdownMenuItem>
            <DropdownMenuItem disabled={allCount === 0} onSelect={onExportAll}>
              Everything
              <Count n={allCount} />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
