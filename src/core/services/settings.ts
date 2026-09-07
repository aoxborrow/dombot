import type { AppSettings } from '../../shared/ipc';
import { Namespace } from '../storage/namespace';

// User-adjustable settings, one storage key per setting in the `settings`
// namespace. Like folders and the pricing overrides (and unlike the caches in
// cache.ts), this is user data and is never cleared by "Clear cache".

const DEFAULTS: AppSettings = {
  autoSyncIntervalMinutes: 24 * 60, // 24 hours
  recentNameservers: [],
};

/** How many recent nameserver sets to keep. */
const MAX_RECENT_NAMESERVERS = 3;

const store = new Namespace<unknown>('settings');

/** Merge over defaults and coerce to valid values, defending against a
 *  hand-edited or partial store. */
function normalize(raw: Partial<AppSettings>): AppSettings {
  const minutes = Number(raw.autoSyncIntervalMinutes);
  const recent = Array.isArray(raw.recentNameservers)
    ? raw.recentNameservers
        .filter(
          (set): set is string[] =>
            Array.isArray(set) &&
            set.length > 0 &&
            set.every((h) => typeof h === 'string'),
        )
        .slice(0, MAX_RECENT_NAMESERVERS)
    : DEFAULTS.recentNameservers;
  return {
    autoSyncIntervalMinutes:
      Number.isFinite(minutes) && minutes >= 0
        ? Math.floor(minutes)
        : DEFAULTS.autoSyncIntervalMinutes,
    recentNameservers: recent,
  };
}

/** The current settings (defaults merged in). */
export function getSettings(): AppSettings {
  return normalize(store.all() as Partial<AppSettings>);
}

/** Patches settings (coercing to valid values) and returns the result. */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next = normalize({ ...getSettings(), ...patch });
  for (const [key, value] of Object.entries(next)) {
    void store.set(key, value);
  }
  return next;
}
