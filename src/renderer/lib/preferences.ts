import { create } from 'zustand';
import type { ColumnLayout } from '../components/data-table/column-layout';

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
  /** Each table's chosen columns and their order, by table id (e.g.
   * `domains.active`). Fitted to the table's columns when it is drawn. */
  columnLayouts: Record<string, ColumnLayout>;
}

export const PAGE_SIZES = [25, 50, 100, 250];

/** Sortable Domains columns, in table order. Keys match the table's columns. */
export const SORT_COLUMNS: { key: string; label: string }[] = [
  { key: 'domainName', label: 'Domain' },
  { key: 'folder', label: 'Folder' },
  { key: 'registrar', label: 'Registrar' },
  { key: 'createdDate', label: 'Created' },
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
  columnLayouts: {},
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
    columnLayouts: parseColumnLayouts(v.columnLayouts),
  };
}

/** Keeps entries shaped like a layout. Which keys are valid is up to each
 * table, which fits its entry to its columns when it draws. */
function parseColumnLayouts(raw: unknown): Record<string, ColumnLayout> {
  const out: Record<string, ColumnLayout> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const strings = (a: unknown): a is string[] =>
    Array.isArray(a) && a.every((k) => typeof k === 'string');
  for (const [id, layout] of Object.entries(raw)) {
    const l = layout as Partial<ColumnLayout> | null;
    if (l && strings(l.order) && strings(l.hidden))
      out[id] = { order: l.order, hidden: l.hidden };
  }
  return out;
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
    const { pageSize, sortKey, sortDir, density, columnLayouts } = get();
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          pageSize,
          sortKey,
          sortDir,
          density,
          columnLayouts,
        }),
      );
    } catch {
      // Persisting is best-effort; the in-memory state still updates.
    }
  },
}));
