import {
  Check,
  ChevronDown,
  CircleAlert,
  Plug2,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
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
 * shared sync state: green when a sync can start, otherwise neutral — spinning
 * mid-sync, "Synced" for the minute after one, and plain when a bulk job or
 * missing setup blocks it, where a click explains instead of syncing. The chevron stays usable throughout.
 * On phones the sync half drops to its icon.
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
  // Picked with the pointer: don't hand focus back to the chevron, where it
  // would show a focus ring. A keyboard pick still returns there.
  const byPointer = useRef(false);
  const {
    sync,
    syncing,
    disabled,
    title,
    reason,
    shortReason,
    tooSoon,
    lastSyncedAt,
    stale,
    partialFail,
  } = useSyncState();
  // Can't sync right now, and not because one is running: a click says why
  // instead of syncing. Either way the button goes neutral rather than fading.
  const blocked = disabled && !syncing;
  const variant = disabled ? 'outline' : 'default';
  // Snap between green and neutral: the button's colour fade would show a
  // washed-out green for a moment each time the state flips.

  function onSync() {
    if (syncing) return;
    if (blocked) toast.info(reason ?? title);
    else sync();
  }

  return (
    <div className="flex shrink-0 items-center gap-3">
      {/* Just after a sync the button itself says so. */}
      {lastSyncedAt !== null && !syncing && !tooSoon && (
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
          variant={variant}
          onClick={onSync}
          aria-disabled={disabled}
          title={title}
          aria-label={syncing ? 'Syncing' : tooSoon ? 'Synced' : 'Sync now'}
          className={cn(
            'rounded-r-none transition-none max-sm:w-9 max-sm:px-0!',
            syncing &&
              'cursor-default hover:bg-background dark:hover:bg-input/30',
          )}
        >
          {tooSoon && !syncing ? (
            // Some accounts failed: no check. The banner under the title
            // names them.
            partialFail ? (
              <CircleAlert className="text-destructive" />
            ) : (
              <Check className="text-brand" />
            )
          ) : (
            <RefreshCw className={cn(syncing && 'animate-spin')} />
          )}
          <span className="max-sm:sr-only">
            {syncing ? 'Syncing…' : tooSoon ? 'Synced' : 'Sync now'}
          </span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={variant}
              aria-label="More data actions"
              className={cn(
                'w-8 rounded-l-none px-0 transition-none',
                disabled
                  ? '-ml-px'
                  : 'border-l border-brand-400 dark:border-brand-700',
              )}
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-60"
            onPointerDown={() => (byPointer.current = true)}
            onCloseAutoFocus={(e) => {
              if (byPointer.current) e.preventDefault();
              byPointer.current = false;
            }}
          >
            <DropdownMenuItem disabled={disabled} onSelect={sync}>
              <RefreshCw className={cn(syncing && 'animate-spin')} />
              {syncing ? 'Syncing…' : 'Sync now'}
              {(shortReason ?? registrarCount > 0) && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {shortReason ??
                    `${registrarCount} registrar${registrarCount === 1 ? '' : 's'}`}
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => navigate('/settings?tab=registrars')}
            >
              {/* Plug2 draws small: a size up matches the refresh icon above,
                  pulled in so the label stays in line. */}
              <Plug2 className="-mx-px size-[18px]" />
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
