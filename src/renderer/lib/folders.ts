import type { FolderColor } from '../../shared/ipc';

// The folder color palette. Main stores only the palette key (see
// shared/ipc.ts); the renderer owns how each key looks. Every class string is a
// full literal so Tailwind's scanner keeps it — never build these by
// interpolation. Mirrors the LIFECYCLE_TONE pattern in Domains.tsx.

interface FolderColorStyle {
  /** Human label for the color picker. */
  label: string;
  /** Soft filled badge for the table chip (light + dark). */
  chip: string;
  /** Solid dot for the picker and the assign menu. */
  swatch: string;
}

export const FOLDER_COLOR_STYLES: Record<FolderColor, FolderColorStyle> = {
  gray: {
    label: 'Gray',
    chip: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    swatch: 'bg-gray-500',
  },
  red: {
    label: 'Red',
    chip: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    swatch: 'bg-red-500',
  },
  orange: {
    label: 'Orange',
    chip: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
    swatch: 'bg-orange-500',
  },
  amber: {
    label: 'Amber',
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    swatch: 'bg-amber-500',
  },
  green: {
    label: 'Green',
    chip: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
    swatch: 'bg-green-500',
  },
  teal: {
    label: 'Teal',
    chip: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
    swatch: 'bg-teal-500',
  },
  blue: {
    label: 'Blue',
    chip: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
    swatch: 'bg-blue-500',
  },
  indigo: {
    label: 'Indigo',
    chip: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
    swatch: 'bg-indigo-500',
  },
  violet: {
    label: 'Violet',
    chip: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
    swatch: 'bg-violet-500',
  },
  pink: {
    label: 'Pink',
    chip: 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300',
    swatch: 'bg-pink-500',
  },
};

/** The palette entry for a color, falling back to gray for an unknown key so a
 *  hand-edited folders.json never breaks rendering. */
export function folderColorStyle(color: FolderColor): FolderColorStyle {
  return FOLDER_COLOR_STYLES[color] ?? FOLDER_COLOR_STYLES.gray;
}
