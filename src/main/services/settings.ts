import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { AppSettings } from '../../shared/ipc';

// User-adjustable settings, persisted as one JSON file under `userData` — the
// same pattern as folders.ts and the pricing overrides: lazily loaded into a
// module cache, rewritten wholesale on each change. Like those (and unlike the
// caches in cache.ts), this is user data and is never cleared by "Clear cache".

const DEFAULTS: AppSettings = {
  autoSyncIntervalMinutes: 24 * 60, // 24 hours
};

let store: AppSettings | null = null;

function storeFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

/** Merge over defaults and coerce to valid values, defending against a
 *  hand-edited or partial file. */
function normalize(raw: Partial<AppSettings>): AppSettings {
  const minutes = Number(raw.autoSyncIntervalMinutes);
  return {
    autoSyncIntervalMinutes:
      Number.isFinite(minutes) && minutes >= 0
        ? Math.floor(minutes)
        : DEFAULTS.autoSyncIntervalMinutes,
  };
}

function load(): AppSettings {
  if (store) return store;
  try {
    store = normalize(
      JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as Partial<AppSettings>,
    );
  } catch {
    // Missing or corrupt file — start from defaults, like the other stores.
    store = { ...DEFAULTS };
  }
  return store;
}

function persist(next: AppSettings): void {
  store = next;
  try {
    fs.writeFileSync(storeFile(), JSON.stringify(next), 'utf8');
  } catch {
    // A failed write just means the change won't survive a restart; not fatal.
  }
}

/** The current settings (defaults merged in). */
export function getSettings(): AppSettings {
  return { ...load() };
}

/** Patches settings (coercing to valid values) and returns the result. */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = normalize({ ...load(), ...patch });
  persist(next);
  return next;
}
