import { Check, EyeOff } from 'lucide-react';
import { HIDDEN_FOLDER_ID, type Folder } from '../../../shared/ipc';
import { folderColorStyle } from '../../lib/folders';
import { FolderIcon } from '../icons/FolderIcon';
import { FolderOffIcon } from '../icons/FolderOffIcon';
import { cn } from '@/lib/utils';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

/**
 * The shared body of every folder-assignment menu: the user's folders, then
 * None, then the built-in Hidden folder. The row menu and the bulk Folder
 * submenu use the same list. The caller supplies the surrounding menu so it
 * keeps its own width and trigger. Sold, Dropped, and Archived aren't folders:
 * they're ownership actions in the row menu.
 *
 * Pass `selected` (a folder id, {@link HIDDEN_FOLDER_ID}, or `null` for None) to
 * mark the current assignment with a check — omit it for the bulk menu, where
 * there is no single current value. Pass `emptyState` to show a "No folders yet"
 * hint when the user has none (again, the bulk menu).
 */
export function FolderMenuItems({
  folders,
  selected,
  emptyState = false,
  onAssign,
}: {
  folders: Folder[];
  /** Current assignment, or omit to render without checks (bulk). */
  selected?: string | null;
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
        {showChecks && selected === null && (
          <Check className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="gap-2.5"
        onSelect={() => onAssign(HIDDEN_FOLDER_ID)}
      >
        <EyeOff className="size-4 shrink-0" aria-hidden />
        <span className="flex-1">Hidden</span>
        {showChecks && selected === HIDDEN_FOLDER_ID && (
          <Check className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </DropdownMenuItem>
    </>
  );
}
