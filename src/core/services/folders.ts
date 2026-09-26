import {
  ARCHIVE_FOLDER_ID,
  DROPPED_FOLDER_ID,
  SOLD_FOLDER_ID,
  isHiddenFolder,
  type Folder,
  type FolderInput,
  type FolderPatch,
  type FoldersSnapshot,
} from '../../shared/ipc';
import { Namespace } from '../storage/namespace';

// The Archive folder's id was historically stored as this literal; assignments
// carrying it are migrated to ARCHIVE_FOLDER_ID on load (see `load`).
const LEGACY_ARCHIVE_FOLDER_ID = '__hidden__';

// Folders: user-defined groupings of domains, plus the per-domain assignment.
// Persisted in the `folders` namespace under two keys — `folders` (the
// definitions) and `assignments` (domainKey → folderId). The whole thing is a
// handful of folders and a few hundred assignments, so a full rewrite is cheap.
//
// Unlike the caches in cache.ts, this is never cleared by "Clear cache" — it's
// user-authored, like credentials and manual prices.

interface FoldersStore {
  folders: Folder[];
  /** domainKey (`${registrar}:${domainName}`) → folderId. */
  assignments: Record<string, string>;
}

const store = new Namespace<unknown>('folders');

function load(): FoldersStore {
  const folders = store.get('folders');
  const assignments = store.get('assignments');
  // Defend against a hand-edited or partial store.
  const raw =
    assignments && typeof assignments === 'object'
      ? (assignments as Record<string, string>)
      : {};
  // Migrate the Archive folder's legacy id (`__hidden__`) to ARCHIVE_FOLDER_ID
  // so domains archived before the rename stay archived.
  let migrated = false;
  const normalized: Record<string, string> = {};
  for (const [key, folderId] of Object.entries(raw)) {
    if (folderId === LEGACY_ARCHIVE_FOLDER_ID) {
      normalized[key] = ARCHIVE_FOLDER_ID;
      migrated = true;
    } else {
      normalized[key] = folderId;
    }
  }
  const result: FoldersStore = {
    folders: Array.isArray(folders) ? (folders as Folder[]) : [],
    assignments: normalized,
  };
  // Persist once so the legacy value is rewritten on disk, not re-migrated each
  // load.
  if (migrated) persist(result);
  return result;
}

function persist(next: FoldersStore): void {
  void store.set('folders', next.folders);
  void store.set('assignments', next.assignments);
}

/** The folder definitions plus the domain→folder map, for launch hydration. */
export function getFolders(): FoldersSnapshot {
  const { folders, assignments } = load();
  return { folders, assignments };
}

/** Creates a folder (assigning its id) and returns it. */
export function createFolder(input: FolderInput): Folder {
  const current = load();
  const folder: Folder = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    color: input.color,
  };
  persist({ ...current, folders: [...current.folders, folder] });
  return folder;
}

/** Patches an existing folder's editable fields. No-op if the id is unknown. */
export function updateFolder(id: string, patch: FolderPatch): void {
  const current = load();
  const folders = current.folders.map((f) =>
    f.id === id ? { ...f, ...patch } : f,
  );
  persist({ ...current, folders });
}

/** Deletes a folder and drops every assignment pointing at it. */
export function deleteFolder(id: string): void {
  if (isHiddenFolder(id)) return;
  const current = load();
  const folders = current.folders.filter((f) => f.id !== id);
  const assignments: Record<string, string> = {};
  for (const [key, folderId] of Object.entries(current.assignments)) {
    if (folderId !== id) assignments[key] = folderId;
  }
  persist({ folders, assignments });
}

/**
 * Assigns a domain to a folder, or clears its assignment with a null folderId.
 * An unknown folderId is treated as an unassign, defensively.
 */
export function assignFolder(domainKey: string, folderId: string | null): void {
  const current = load();
  const assignments = { ...current.assignments };
  const valid =
    folderId !== null &&
    (folderId === ARCHIVE_FOLDER_ID ||
      folderId === SOLD_FOLDER_ID ||
      folderId === DROPPED_FOLDER_ID ||
      current.folders.some((f) => f.id === folderId));
  if (valid) {
    assignments[domainKey] = folderId;
  } else {
    delete assignments[domainKey];
  }
  persist({ ...current, assignments });
}
