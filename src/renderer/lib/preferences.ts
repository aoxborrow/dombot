import { create } from 'zustand';

/**
 * Per-device display preferences (Settings → General), persisted in
 * localStorage like the theme — they describe how this window should look, not
 * portfolio data, so they stay out of the main-process settings file and work
 * the same on desktop, web, and the demo.
 */
export interface Preferences {
  /** Rows per page the Domains table opens with. */
  pageSize: number;
  /** Column key the Domains table opens sorted by. */
  sortKey: string;
  sortDir: 'asc' | 'desc';
  /** Domains table density. `compact` is the phone layout's tighter spacing
   * and smaller type; phones always use it regardless. */
  density: 'normal' | 'compact';
}

export const PAGE_SIZES = [25, 50, 100, 250];

/** Sortable Domains columns, in table order. Keys match the table's columns. */
export const SORT_COLUMNS: { key: string; label: string }[] = [
  { key: 'domainName', label: 'Domain' },
  { key: 'folder', label: 'Folder' },
  { key: 'registrar', label: 'Registrar' },
  { key: 'createdDate', label: 'Created' },
  { key: 'purchaseDate', label: 'Purchased' },
  { key: 'purchaseAmount', label: 'Paid' },
  { key: 'purchaseNotes', label: 'Notes' },
  { key: 'expirationDate', label: 'Expires' },
  { key: 'renewal', label: 'Renewal' },
  { key: 'autoRenew', label: 'Auto-renew' },
  { key: 'privacy', label: 'Privacy' },
  { key: 'locked', label: 'Locked' },
  { key: 'nameservers', label: 'Nameservers' },
];

export const DEFAULT_PREFERENCES: Preferences = {
  pageSize: 50,
  sortKey: 'domainName',
  sortDir: 'asc',
  density: 'normal',
};

const STORAGE_KEY = 'dombot-preferences';

/** Validates a stored blob field by field, so a stale or hand-edited value
 * falls back to its default instead of breaking the table. */
export function parsePreferences(raw: string | null): Preferences {
  let v: Partial<Record<keyof Preferences, unknown>> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') v = parsed;
  } catch {
    // Corrupt JSON — use the defaults.
  }
  const d = DEFAULT_PREFERENCES;
  return {
    pageSize: PAGE_SIZES.includes(v.pageSize as number)
      ? (v.pageSize as number)
      : d.pageSize,
    sortKey: SORT_COLUMNS.some((c) => c.key === v.sortKey)
      ? (v.sortKey as string)
      : d.sortKey,
    sortDir:
      v.sortDir === 'asc' || v.sortDir === 'desc' ? v.sortDir : d.sortDir,
    density:
      v.density === 'normal' || v.density === 'compact' ? v.density : d.density,
  };
}

function readStored(): Preferences {
  try {
    return parsePreferences(localStorage.getItem(STORAGE_KEY));
  } catch {
    // localStorage may be unavailable; fall back to the defaults.
    return DEFAULT_PREFERENCES;
  }
}

interface PreferencesState extends Preferences {
  setPreferences: (patch: Partial<Preferences>) => void;
}

export const usePreferences = create<PreferencesState>((set, get) => ({
  ...readStored(),
  setPreferences: (patch) => {
    set(patch);
    const { pageSize, sortKey, sortDir, density } = get();
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ pageSize, sortKey, sortDir, density }),
      );
    } catch {
      // Persisting is best-effort; the in-memory state still updates.
    }
  },
}));
