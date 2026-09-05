import {
  ChevronDown,
  EyeOff,
  FileSpreadsheet,
  Loader2,
  Lock,
  RefreshCw,
  X,
} from 'lucide-react';
import { HIDDEN_FOLDER_ID } from '../../../shared/ipc';
import type { Domain, Folder } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import { bulkOpTitle, type FlagKind } from '../../lib/bulk';
import { folderColorStyle } from '../../lib/folders';
import { FolderIcon } from '../icons/FolderIcon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The contextual bar above the table once rows are selected: the selection
 * summary, Clear, and the Bulk actions menu. The menu is a flat list of the
 * things you can change; the dialog it opens is where you pick the value
 * (on/off, a nameserver set, …) and see what the selection's current state
 * is. Registrar-backed items disable while a job is running. While a job
 * runs the bar also shows a compact progress pill with a View button, even
 * with nothing selected.
 */
export function BulkBar({
  domains,
  folders,
  onClear,
  onExport,
  onAssignFolder,
  onKind,
  onViewJob,
}: {
  /** The selected domains (merged rows). */
  domains: Domain[];
  folders: Folder[];
  onClear: () => void;
  onExport: () => void;
  onAssignFolder: (folderId: string | null) => void;
  /** Open the bulk dialog for a flag kind (the value is chosen there). */
  onKind: (kind: FlagKind) => void;
  onViewJob: () => void;
}) {
  const bulk = useAppStore((s) => s.bulk);
  const running = bulk?.status === 'running';

  const registrarCount = new Set(domains.map((d) => d.registrar)).size;

  if (domains.length === 0 && !running) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-3 text-sm">
        {domains.length > 0 ? (
          <>
            <span className="font-medium">
              {domains.length} selected
              {registrarCount > 1 && (
                <span className="font-normal text-muted-foreground">
                  {' '}
                  · {registrarCount} registrars
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-muted-foreground"
              onClick={onClear}
            >
              <X />
              Clear
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">Bulk action running</span>
        )}
        {bulk && running && (
          <button
            type="button"
            onClick={onViewJob}
            className="inline-flex items-center gap-2 rounded-full border bg-background px-2.5 py-0.5 text-xs hover:bg-accent"
          >
            <Loader2 className="size-3 animate-spin" aria-hidden />
            {bulkOpTitle(bulk.op)} · {bulk.results.length}/{bulk.total}
            <span className="text-muted-foreground">View</span>
          </button>
        )}
      </div>

      {domains.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Bulk actions
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderIcon className="text-muted-foreground" />
                Assign to folder
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[320px] w-52 overflow-y-auto">
                {folders.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    className="gap-2.5"
                    onSelect={() => onAssignFolder(f.id)}
                  >
                    <FolderIcon
                      className={`size-4 shrink-0 ${folderColorStyle(f.color).text}`}
                      aria-hidden
                    />
                    <span className="flex-1 truncate">{f.name}</span>
                  </DropdownMenuItem>
                ))}
                {folders.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No folders yet
                  </div>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2.5"
                  onSelect={() => onAssignFolder(null)}
                >
                  <span className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1">None</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => onAssignFolder(HIDDEN_FOLDER_ID)}>
              <EyeOff className="text-muted-foreground" />
              Hidden
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={running}
              onSelect={() => onKind('autoRenew')}
            >
              <RefreshCw className="text-muted-foreground" />
              Auto-renew…
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={running}
              onSelect={() => onKind('privacy')}
            >
              <EyeOff className="text-muted-foreground" />
              WHOIS privacy…
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={running}
              onSelect={() => onKind('lock')}
            >
              <Lock className="text-muted-foreground" />
              Transfer lock…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onExport}>
              <FileSpreadsheet className="text-muted-foreground" />
              Export selected CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
