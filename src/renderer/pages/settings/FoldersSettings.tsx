import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Folder, FolderColor, FolderInput } from '../../../shared/ipc';
import { FOLDER_COLORS } from '../../../shared/ipc';
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { useAppStore } from '../../store/app';
import { folderColorStyle } from '../../lib/folders';
import { FolderIcon } from '../../components/icons/FolderIcon';

/**
 * Settings → Folders: create, edit, and delete the folders used to organize
 * domains. Assignment happens on the Domains table; this page owns the
 * definitions (name, description, color) and shows how many domains each holds.
 */
export default function FoldersSettings() {
  const folders = useAppStore((s) => s.folders);
  const assignments = useAppStore((s) => s.folderAssignments);
  const createFolder = useAppStore((s) => s.createFolder);
  const updateFolder = useAppStore((s) => s.updateFolder);
  const deleteFolder = useAppStore((s) => s.deleteFolder);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Folder | null>(null);
  const [deleting, setDeleting] = useState<Folder | null>(null);

  // Domains assigned to each folder id.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const id of Object.values(assignments)) c[id] = (c[id] ?? 0) + 1;
    return c;
  }, [assignments]);

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Folders</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Organize your domains into named, colored groups. Assign a domain to
            a folder from the Domains table. Folders are stored on this device.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setCreating(true)}>
          <Plus />
          New folder
        </Button>
      </div>

      {folders.length === 0 ? (
        <Empty className="rounded-lg border border-dashed">
          <EmptyHeader>
            <EmptyTitle>No folders yet</EmptyTitle>
            <EmptyDescription>
              Create your first folder to start organizing your domains.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {folders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              count={counts[f.id] ?? 0}
              onEdit={() => setEditing(f)}
              onDelete={() => setDeleting(f)}
            />
          ))}
        </div>
      )}

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
          count={counts[deleting.id] ?? 0}
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

function FolderRow({
  folder,
  count,
  onEdit,
  onDelete,
}: {
  folder: Folder;
  count: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const style = folderColorStyle(folder.color);
  return (
    <Card className="flex-row items-center gap-3 px-4 py-3">
      <FolderIcon className={cn('size-7 shrink-0', style.text)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{folder.name}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {count} domain{count === 1 ? '' : 's'}
          </span>
        </div>
        {folder.description && (
          <p className="truncate text-sm text-muted-foreground">
            {folder.description}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onEdit}
        aria-label={`Edit ${folder.name}`}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDelete}
        aria-label={`Delete ${folder.name}`}
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
