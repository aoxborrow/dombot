import {
  HIDDEN_FOLDER_ID,
  isHiddenFolder,
  type Folder,
  type FolderInput,
  type FolderPatch,
  type FoldersSnapshot,
} from '../../shared/ipc';
import { assertDomainName } from '../../shared/domain-name';
import { Namespace } from '../storage/namespace';

// Folders: user-defined groupings of domains, plus each domain's assignment.
// Definitions live in `folders` (one `folders` key, the whole list); the
// assignment lives in `domain-folders`, one entry per domain keyed by
// `toAscii(name)`, so a domain keeps its folder when it moves between
// registrar accounts. A handful of folders and a few hundred assignments, so
// rewriting the definitions list is cheap.
//
// Unlike the caches in cache.ts, neither is cleared by "Clear cache" — they're
// user-authored, like credentials and manual prices.

const store = new Namespace<unknown>('folders');
const assignments = new Namespace<string>('domain-folders');

function loadFolders(): Folder[] {
  const folders = store.get('folders');
  // Defend against a hand-edited or partial store.
  return Array.isArray(folders) ? (folders as Folder[]) : [];
}

function persistFolders(folders: Folder[]): void {
  void store.set('folders', folders);
}

/** The folder definitions plus the domain→folder map, for launch hydration. */
export function getFolders(): FoldersSnapshot {
  return { folders: loadFolders(), assignments: assignments.all() };
}

/** Creates a folder (assigning its id) and returns it. */
export function createFolder(input: FolderInput): Folder {
  const folder: Folder = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    color: input.color,
  };
  persistFolders([...loadFolders(), folder]);
  return folder;
}

/** Patches an existing folder's editable fields. No-op if the id is unknown. */
export function updateFolder(id: string, patch: FolderPatch): void {
  persistFolders(
    loadFolders().map((f) => (f.id === id ? { ...f, ...patch } : f)),
  );
}

/** Deletes a folder and drops every assignment pointing at it. */
export function deleteFolder(id: string): void {
  if (isHiddenFolder(id)) return;
  persistFolders(loadFolders().filter((f) => f.id !== id));
  for (const [key, folderId] of Object.entries(assignments.all())) {
    if (folderId === id) void assignments.delete(key);
  }
}

/**
 * Assigns a domain to a folder, or clears its assignment with a null folderId.
 * An unknown folderId is treated as an unassign, defensively.
 */
export function assignFolder(
  domainName: string,
  folderId: string | null,
): void {
  const key = assertDomainName(domainName);
  const valid =
    folderId !== null &&
    (folderId === HIDDEN_FOLDER_ID ||
      loadFolders().some((f) => f.id === folderId));
  if (valid) void assignments.set(key, folderId);
  else void assignments.delete(key);
}
