import { Check } from 'lucide-react';
import type { Folder } from '../../../shared/ipc';
import { folderColorStyle, NO_FOLDER } from '../../lib/folders';
import { FolderIcon } from '../icons/FolderIcon';
import { FolderOffIcon } from '../icons/FolderOffIcon';
import { cn } from '@/lib/utils';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';

/**
 * The shared body of every folder-assignment menu: the user's folders, then
 * None. The row menu and the bulk Folder submenu use the same list. The
 * caller supplies the surrounding menu so it keeps its own width and trigger.
 *
 * Pass `selected` (a folder id, or `null` for None) to
 * mark the current assignment with a check — the bulk menu passes it only when
 * every selected name shares one, and omits it otherwise. The bulk menu also
 * passes `counts`, how many of the selection each folder holds, shown beside
 * it. Pass `emptyState` to show a "No folders yet" hint when the user has none
 * (again, the bulk menu).
 */
export function FolderMenuItems({
  folders,
  selected,
  counts,
  emptyState = false,
  onAssign,
}: {
  folders: Folder[];
  /** Current assignment, or omit to render without checks (bulk). */
  selected?: string | null;
  /** Names per folder id (`NO_FOLDER` for None) in a bulk selection. */
  counts?: Readonly<Record<string, number>>;
  /** Show a "No folders yet" hint when there are no folders. */
  emptyState?: boolean;
  onAssign: (folderId: string | null) => void;
}) {
  // Distinguishes "no selection to check" (bulk, prop omitted) from "None is the
  // selection" (`selected === null`).
  const showChecks = selected !== undefined;

  return (
    <>
      {folders.map((f) => (
        <DropdownMenuItem
          key={f.id}
          className="gap-2.5"
          onSelect={() => onAssign(f.id)}
        >
          <FolderIcon
            className={cn('size-4 shrink-0', folderColorStyle(f.color).text)}
            aria-hidden
          />
          <span className="flex-1 truncate">{f.name}</span>
          <Count n={counts?.[f.id]} />
          {showChecks && f.id === selected && (
            <Check className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </DropdownMenuItem>
      ))}
      {folders.length === 0 && emptyState && (
        <div className="px-2 py-1.5 text-sm text-muted-foreground">
          No folders yet
        </div>
      )}
      <DropdownMenuItem className="gap-2.5" onSelect={() => onAssign(null)}>
        <FolderOffIcon
          className="size-4 shrink-0 text-muted-foreground/50"
          aria-hidden
        />
        <span className="flex-1">None</span>
        <Count n={counts?.[NO_FOLDER]} />
        {showChecks && selected === null && (
          <Check className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </DropdownMenuItem>
    </>
  );
}

/** How many selected names a folder holds, beside it; nothing for none. */
function Count({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {n.toLocaleString('en-US')}
    </span>
  );
}
