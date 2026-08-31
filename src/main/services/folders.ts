import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type {
  Folder,
  FolderInput,
  FolderPatch,
  FoldersSnapshot,
} from '../../shared/ipc';

// Folders are user data — the folder definitions and the domain→folder map. They
// live beside the manual price overrides (pricing-overrides.json) under
// `userData`, and follow the same pattern: one JSON file, lazily loaded into a
// module cache, rewritten wholesale on each mutation. The dataset is a handful
// of folders and at most a few hundred assignments, so a full rewrite is cheap.
//
// Unlike the caches in cache.ts, this file is never cleared by "Clear cache" —
// it's user-authored, like credentials and manual prices.

interface FoldersStore {
  folders: Folder[];
  /** domainKey (`${registrar}:${domainName}`) → folderId. */
  assignments: Record<string, string>;
}

let store: FoldersStore | null = null;

function storeFile(): string {
  return path.join(app.getPath('userData'), 'folders.json');
}

function load(): FoldersStore {
  if (store) return store;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(storeFile(), 'utf8'),
    ) as Partial<FoldersStore>;
    // Defend against a hand-edited or partial file.
    store = {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      assignments:
        parsed.assignments && typeof parsed.assignments === 'object'
          ? parsed.assignments
          : {},
    };
  } catch {
    // Missing or corrupt file — start empty, exactly like the other stores.
    store = { folders: [], assignments: {} };
  }
  return store;
}

function persist(next: FoldersStore): void {
  store = next;
  try {
    fs.writeFileSync(storeFile(), JSON.stringify(next), 'utf8');
  } catch {
    // A failed write just means the change won't survive a restart; not fatal.
  }
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
    id: randomUUID(),
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
    folderId !== null && current.folders.some((f) => f.id === folderId);
  if (valid) {
    assignments[domainKey] = folderId;
  } else {
    delete assignments[domainKey];
  }
  persist({ ...current, assignments });
}
