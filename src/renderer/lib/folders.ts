import { toAscii } from '../../shared/domain-name';
import type { Domain, Folder, FolderColor } from '../../shared/ipc';

// The folder color palette. Main stores only the palette key (see
// shared/ipc.ts); the renderer owns how each key looks. Every class string is a
// full literal so Tailwind's scanner keeps it — never build these by
// interpolation. Mirrors the LIFECYCLE_TONE pattern in Domains.tsx.

interface FolderColorStyle {
  /** Human label for the color picker. */
  label: string;
  /** Soft filled badge (light + dark) — kept for any chip-style use. */
  chip: string;
  /** Solid dot for the picker and the assign menu. */
  swatch: string;
  /** Text/stroke color for the folder icon in the table (light + dark). */
  text: string;
}

export const FOLDER_COLOR_STYLES: Record<FolderColor, FolderColorStyle> = {
  gray: {
    label: 'Gray',
    chip: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    swatch: 'bg-gray-500',
    text: 'text-gray-500 dark:text-gray-400',
  },
  red: {
    label: 'Red',
    chip: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    swatch: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
  },
  orange: {
    label: 'Orange',
    chip: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
    swatch: 'bg-orange-500',
    text: 'text-orange-600 dark:text-orange-400',
  },
  amber: {
    label: 'Amber',
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    swatch: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
  },
  green: {
    label: 'Green',
    chip: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
    swatch: 'bg-green-500',
    text: 'text-green-600 dark:text-green-400',
  },
  teal: {
    label: 'Teal',
    chip: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
    swatch: 'bg-teal-500',
    text: 'text-teal-600 dark:text-teal-400',
  },
  blue: {
    label: 'Blue',
    chip: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
    swatch: 'bg-blue-500',
    text: 'text-blue-600 dark:text-blue-400',
  },
  indigo: {
    label: 'Indigo',
    chip: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
    swatch: 'bg-indigo-500',
    text: 'text-indigo-600 dark:text-indigo-400',
  },
  violet: {
    label: 'Violet',
    chip: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
    swatch: 'bg-violet-500',
    text: 'text-violet-600 dark:text-violet-400',
  },
  pink: {
    label: 'Pink',
    chip: 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300',
    swatch: 'bg-pink-500',
    text: 'text-pink-600 dark:text-pink-400',
  },
};

/** The palette entry for a color, falling back to gray for an unknown key so a
 *  hand-edited folders.json never breaks rendering. */
export function folderColorStyle(color: FolderColor): FolderColorStyle {
  return FOLDER_COLOR_STYLES[color] ?? FOLDER_COLOR_STYLES.gray;
}

/** Folder filter value for names in no folder (the "None" bucket). */
export const NO_FOLDER = '__none__';

/**
 * A name's Folder filter bucket: its folder, or None. An assignment to a
 * folder that's been deleted counts as None.
 */
export function folderBucket(
  id: string | undefined,
  folders: Folder[],
): string {
  return id && folders.some((f) => f.id === id) ? id : NO_FOLDER;
}

export interface FolderCounts {
  /** Owned rows per bucket (a folder id, or None). */
  owned: Record<string, number>;
  /** Archive rows per bucket. */
  archive: Record<string, number>;
}

/**
 * Rows per Folder filter bucket, in Owned and in Archive, as the Domains
 * table counts them. A name in Archive keeps its folder. An assignment for a
 * name with no row (one DomBot doesn't show any more) isn't counted.
 */
export function countFolders(
  rows: Domain[],
  /** Whether the row is in Archive (shared/ownership.ts, `standingOf`). */
  archived: (d: Domain) => boolean,
  assignments: Record<string, string>,
  folders: Folder[],
): FolderCounts {
  const counts: FolderCounts = { owned: {}, archive: {} };
  for (const d of rows) {
    const key = toAscii(d.domainName);
    const view = archived(d) ? counts.archive : counts.owned;
    const bucket = folderBucket(assignments[key], folders);
    view[bucket] = (view[bucket] ?? 0) + 1;
  }
  return counts;
}
