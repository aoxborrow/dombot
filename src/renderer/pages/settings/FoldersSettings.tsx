import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Link } from 'react-router-dom';
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import type {
  Domain,
  Folder,
  FolderColor,
  FolderInput,
} from '../../../shared/ipc';
import { FOLDER_COLORS } from '../../../shared/ipc';
import { importedRows } from '../../../shared/imported-domains';
import {
  archiveRows,
  ownershipByDomain,
  standingOf,
} from '../../../shared/ownership';
import { toAscii } from '../../../shared/domain-name';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState } from '../../components/EmptyState';
import { useAppStore } from '../../store/app';
import { countFolders, folderColorStyle, moveTo } from '../../lib/folders';
import { FolderIcon } from '../../components/icons/FolderIcon';
import { SETTINGS_LINK } from './SettingsCard';

/**
 * Settings → Folders: create, edit, and delete the folders used to organize
 * domains. Assignment happens on the Domains table; this page owns the
 * definitions (name, description, color) and their order, and shows how many
 * domains each holds, counted as the Domains table's Folder filter counts them.
 * Drag a folder's handle (or focus it and press ↑/↓) to move it; that order is
 * the one every folder list in the app shows.
 */
export default function FoldersSettings() {
  const folders = useAppStore((s) => s.folders);
  const assignments = useAppStore((s) => s.folderAssignments);
  const portfolio = useAppStore((s) => s.portfolio);
  const importedDomains = useAppStore((s) => s.importedDomains);
  const domainEvents = useAppStore((s) => s.domainEvents);
  const marketSales = useAppStore((s) => s.marketSales);
  const registrars = useAppStore((s) => s.registrars);
  const lookups = useAppStore((s) => s.registrationLookups);
  const createFolder = useAppStore((s) => s.createFolder);
  const updateFolder = useAppStore((s) => s.updateFolder);
  const deleteFolder = useAppStore((s) => s.deleteFolder);
  const reorderFolders = useAppStore((s) => s.reorderFolders);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Folder | null>(null);
  const [deleting, setDeleting] = useState<Folder | null>(null);

  // Each folder's names in Owned and in Archive: the Domains table's rows,
  // so an assignment left on a name DomBot no longer shows isn't counted.
  const counts = useMemo(() => {
    const ownership = ownershipByDomain(domainEvents, marketSales);
    const live = [...portfolio, ...importedRows(importedDomains, portfolio)];
    const rows = [...live, ...archiveRows(ownership, live, registrars)];
    const archived = (d: Domain) => {
      const key = toAscii(d.domainName);
      return standingOf(d, ownership.get(key), lookups[key]?.registered)
        .archived;
    };
    return countFolders(rows, archived, assignments, folders);
  }, [
    portfolio,
    importedDomains,
    domainEvents,
    marketSales,
    registrars,
    lookups,
    assignments,
    folders,
  ]);

  // Dragging: the order on screen while a handle is held, applied on drop.
  const listRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const byId = new Map(folders.map((f) => [f.id, f]));
  const shown = draft ? draft.flatMap((id) => byId.get(id) ?? []) : folders;
  // Ends a drag; also run on unmount, so leaving mid-drag drops the listeners.
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);

  // ↑/↓ re-renders the list in a new order; keep focus on the moved handle.
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(
        `[data-folder-id="${CSS.escape(id)}"] [data-folder-handle]`,
      )
      ?.focus();
  });

  function onHandlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    const origin = folders.map((f) => f.id);
    let next = origin;
    setDragId(id);
    setDraft(origin);

    // Where the pointer sits among the other rows, read from the rows on
    // screen, so it lands right however the page is scrolled.
    const move = (ev: PointerEvent) => {
      const list = listRef.current;
      if (!list) return;
      const rows = [
        ...list.querySelectorAll<HTMLElement>('[data-folder-id]'),
      ].filter((row) => row.dataset.folderId !== id);
      const above = rows.filter((row) => {
        const r = row.getBoundingClientRect();
        return r.top + r.height / 2 < ev.clientY;
      }).length;
      next = moveTo(origin, id, above);
      setDraft(next);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      stopDrag.current = null;
      setDragId(null);
      setDraft(null);
    };
    const up = () => {
      stop();
      if (next.some((k, i) => k !== origin[i])) void reorderFolders(next);
    };
    stopDrag.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
  }

  function onHandleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const order = folders.map((f) => f.id);
    const from = order.indexOf(id);
    const to = from + (event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= order.length) return;
    refocus.current = id;
    void reorderFolders(moveTo(order, id, to));
  }

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold">Folders</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Organize your domains into named, colored groups. Assign a domain to a
          folder from the Domains table. Drag a folder to change the order
          folders show in everywhere. Folders are saved with your other DomBot
          settings.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {/* The page's action, right-aligned above the list. */}
        <Button className="self-end" onClick={() => setCreating(true)}>
          <Plus />
          New folder
        </Button>
        {folders.length === 0 ? (
          <EmptyState
            boxed
            title="No folders yet"
            description="Folders group your domains so you can filter by them."
          />
        ) : (
          <div
            ref={listRef}
            className={cn('flex flex-col gap-2.5', dragId && 'select-none')}
          >
            {shown.map((f) => (
              <FolderRow
                key={f.id}
                folder={f}
                movable={folders.length > 1}
                dragging={dragId === f.id}
                onHandlePointerDown={(e) => onHandlePointerDown(e, f.id)}
                onHandleKeyDown={(e) => onHandleKeyDown(e, f.id)}
                owned={counts.owned[f.id] ?? 0}
                archived={counts.archive[f.id] ?? 0}
                onEdit={() => setEditing(f)}
                onDelete={() => setDeleting(f)}
              />
            ))}
          </div>
        )}
      </div>

      {(creating || editing) && (
        <FolderFormDialog
          folder={editing}
          onClose={closeForm}
          onSubmit={async (input) => {
            if (editing) await updateFolder(editing.id, input);
            else await createFolder(input);
            closeForm();
          }}
        />
      )}

      {deleting && (
        <DeleteFolderDialog
          folder={deleting}
          count={
            (counts.owned[deleting.id] ?? 0) +
            (counts.archive[deleting.id] ?? 0)
          }
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteFolder(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

/** "3 domains", opening the Domains table on the folder when there are any. */
function CountLink({ count, to }: { count: number; to: string }) {
  const text = `${count} domain${count === 1 ? '' : 's'}`;
  if (count === 0) return text;
  return (
    <Link to={to} className={SETTINGS_LINK}>
      {text}
    </Link>
  );
}

function FolderRow({
  folder,
  movable,
  dragging,
  onHandlePointerDown,
  onHandleKeyDown,
  owned,
  archived,
  onEdit,
  onDelete,
}: {
  folder: Folder;
  /** Shows the drag handle (more than one folder). */
  movable: boolean;
  /** This row is the one being dragged. */
  dragging: boolean;
  onHandlePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onHandleKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Names in this folder in Owned. */
  owned: number;
  /** Names in Archive that keep this folder. */
  archived: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const style = folderColorStyle(folder.color);
  return (
    <Card
      data-folder-id={folder.id}
      className={cn(
        'flex-row items-start gap-3 rounded-md px-4 py-2',
        movable && 'pl-2',
        dragging && 'relative z-10 shadow-md ring-2 ring-ring/40',
      )}
    >
      {movable && (
        <button
          type="button"
          data-folder-handle
          aria-label={`Move ${folder.name}`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          title="Drag to reorder"
          onPointerDown={onHandlePointerDown}
          onKeyDown={onHandleKeyDown}
          className="-mr-1 cursor-grab touch-none self-center rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing dark:text-muted-foreground/60"
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <FolderIcon className={cn('size-7 shrink-0', style.text)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{folder.name}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            <CountLink
              count={owned}
              to={`/?${new URLSearchParams({ folder: folder.id })}`}
            />
            {archived > 0 && (
              <>
                {' · '}
                <Link
                  to={`/?${new URLSearchParams({ view: 'archive', folder: folder.id })}`}
                  className={SETTINGS_LINK}
                >
                  {archived} in Archive
                </Link>
              </>
            )}
          </span>
        </div>
        {folder.description ? (
          <p className="truncate text-sm text-muted-foreground">
            {folder.description}
          </p>
        ) : (
          <p className="truncate text-sm italic text-muted-foreground/60">
            No description
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onEdit}
        aria-label={`Edit ${folder.name}`}
        className="self-center"
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDelete}
        aria-label={`Delete ${folder.name}`}
        className="self-center"
      >
        <Trash2 />
      </Button>
    </Card>
  );
}

function FolderFormDialog({
  folder,
  onClose,
  onSubmit,
}: {
  /** The folder being edited, or null when creating. */
  folder: Folder | null;
  onClose: () => void;
  onSubmit: (input: FolderInput) => Promise<void>;
}) {
  const [name, setName] = useState(folder?.name ?? '');
  const [description, setDescription] = useState(folder?.description ?? '');
  const [color, setColor] = useState<FolderColor>(folder?.color ?? 'blue');
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();

  const submit = async () => {
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSubmit({ name: trimmed, description: description.trim(), color });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{folder ? 'Edit folder' : 'New folder'}</DialogTitle>
          <DialogDescription>
            {folder
              ? 'Update this folder’s name, description, or color.'
              : 'Create a folder to group your domains.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="folder-name">Name</FieldLabel>
            <Input
              id="folder-name"
              value={name}
              placeholder="e.g. For sale"
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="folder-desc">Description</FieldLabel>
            <Input
              id="folder-desc"
              value={description}
              placeholder="Optional"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>Color</FieldLabel>
            <ColorPicker value={color} onChange={setColor} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!trimmed || saving}>
            {saving ? 'Saving…' : folder ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: FolderColor;
  onChange: (color: FolderColor) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {FOLDER_COLORS.map((c) => {
        const style = folderColorStyle(c);
        const selected = c === value;
        return (
          <button
            key={c}
            type="button"
            aria-label={style.label}
            aria-pressed={selected}
            onClick={() => onChange(c)}
            className={cn(
              'size-7 rounded-full ring-offset-2 ring-offset-background transition',
              style.swatch,
              selected ? 'ring-2 ring-ring' : 'opacity-80 hover:opacity-100',
            )}
          />
        );
      })}
    </div>
  );
}

function DeleteFolderDialog({
  folder,
  count,
  onClose,
  onConfirm,
}: {
  folder: Folder;
  count: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{folder.name}”?</DialogTitle>
          <DialogDescription>
            {count > 0
              ? `This folder is assigned to ${count} domain${
                  count === 1 ? '' : 's'
                }. They’ll become unassigned — the domains themselves aren’t affected.`
              : 'This folder has no assigned domains.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                await onConfirm();
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? 'Deleting…' : 'Delete folder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
