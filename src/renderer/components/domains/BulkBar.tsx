import { useMemo } from 'react';
import {
  Check,
  ChevronDown,
  EyeOff,
  FileSpreadsheet,
  Loader2,
  Lock,
  LockOpen,
  RefreshCw,
  X,
} from 'lucide-react';
import { HIDDEN_FOLDER_ID } from '../../../shared/ipc';
import type { Domain, DomainOp, Folder } from '../../../shared/ipc';
import { useAppStore } from '../../store/app';
import { bucketSelection, bulkOpTitle } from '../../lib/bulk';
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
 * summary, Clear, and the Bulk actions menu. Registrar-backed items show how
 * many of the selected domains they'd actually touch and disable when none
 * would (or while a job is running). While a job runs the bar also shows a
 * compact progress pill with a View button, even with nothing selected.
 */
export function BulkBar({
  domains,
  folders,
  onClear,
  onExport,
  onAssignFolder,
  onOp,
  onViewJob,
}: {
  /** The selected domains (merged rows). */
  domains: Domain[];
  folders: Folder[];
  onClear: () => void;
  onExport: () => void;
  onAssignFolder: (folderId: string | null) => void;
  onOp: (op: DomainOp) => void;
  onViewJob: () => void;
}) {
  const bulk = useAppStore((s) => s.bulk);
  const registrars = useAppStore((s) => s.registrars);
  const enriched = useAppStore((s) => s.enriched);
  const running = bulk?.status === 'running';

  const registrarCount = new Set(domains.map((d) => d.registrar)).size;
  const isEnriched = (d: Domain) =>
    `${d.registrar}:${d.domainName}` in enriched;

  // Eligible counts per op, for the menu labels and disabling.
  const ops = useMemo(() => {
    const list: DomainOp[] = [
      { kind: 'autoRenew', enabled: true },
      { kind: 'autoRenew', enabled: false },
      { kind: 'privacy', enabled: true },
      { kind: 'privacy', enabled: false },
      { kind: 'lock', locked: true },
      { kind: 'lock', locked: false },
    ];
    return list.map((op) => ({
      op,
      eligible: bucketSelection(domains, op, registrars, isEnriched).eligible
        .length,
    }));
    // enriched only affects "already in state", so it's folded into isEnriched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domains, registrars, enriched]);

  const item = (op: DomainOp, icon: React.ReactNode, label: string) => {
    const eligible = ops.find((o) => o.op === op)?.eligible ?? 0;
    return (
      <DropdownMenuItem
        disabled={running || eligible === 0}
        onSelect={() => onOp(op)}
      >
        {icon}
        <span className="flex-1">{label}</span>
        <span className="ml-3 text-xs tabular-nums text-muted-foreground">
          {eligible}
        </span>
      </DropdownMenuItem>
    );
  };
  const opOf = (i: number) => ops[i]?.op ?? ({ kind: 'authCode' } as DomainOp);

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
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <RefreshCw className="text-muted-foreground" />
                Auto-renew
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                {item(
                  opOf(0),
                  <Check className="text-muted-foreground" />,
                  'On',
                )}
                {item(opOf(1), <X className="text-muted-foreground" />, 'Off')}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <EyeOff className="text-muted-foreground" />
                WHOIS privacy
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                {item(
                  opOf(2),
                  <Check className="text-muted-foreground" />,
                  'On',
                )}
                {item(opOf(3), <X className="text-muted-foreground" />, 'Off')}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Lock className="text-muted-foreground" />
                Transfer lock
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                {item(
                  opOf(4),
                  <Lock className="text-muted-foreground" />,
                  'Lock',
                )}
                {item(
                  opOf(5),
                  <LockOpen className="text-muted-foreground" />,
                  'Unlock',
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
