import { create } from 'zustand';
import {
  compareVersions,
  releasesNewerThan,
  type Release,
  type ReleaseFeed,
} from '../../shared/releases';
import { isWeb } from './platform';

// The release feed in the renderer, plus the two per-device memories the
// update banner needs. Both live in localStorage like the other display
// preferences: dismissing a banner is about this window, not the instance.

/** Where a self-hoster reads how to update their setup. */
export const SELF_HOST_UPDATE_DOCS =
  'https://github.com/aoxborrow/dombot/blob/main/docs/self-hosting.md#choosing-a-setup';

const DISMISSED_KEY = 'dombot-update-dismissed';
const LAST_SEEN_KEY = 'dombot-last-seen-version';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — the banner just comes back next launch.
  }
}

interface UpdatesState {
  feed: ReleaseFeed | null;
  checking: boolean;
  /** The newest release version whose banner was dismissed here. */
  dismissed: string | null;
  /** The version this device last ran, for the "updated" note. */
  lastSeen: string | null;
  check: (force?: boolean) => Promise<void>;
  dismiss: (version: string) => void;
  markSeen: (version: string) => void;
}

export const useUpdates = create<UpdatesState>((set) => ({
  feed: null,
  checking: false,
  dismissed: read(DISMISSED_KEY),
  lastSeen: read(LAST_SEEN_KEY),
  check: async (force = false) => {
    set({ checking: true });
    try {
      set({ feed: await window.api.getReleaseFeed(force) });
    } catch (err) {
      set((s) => ({
        feed: {
          releases: s.feed?.releases ?? [],
          checkedAt: s.feed?.checkedAt ?? null,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    } finally {
      set({ checking: false });
    }
  },
  dismiss: (version) => {
    write(DISMISSED_KEY, version);
    set({ dismissed: version });
  },
  markSeen: (version) => {
    write(LAST_SEEN_KEY, version);
    set({ lastSeen: version });
  },
}));

/** What the banner should say, if anything. */
export type BannerState =
  | { kind: 'available'; latest: Release; newer: Release[] }
  | { kind: 'updated'; version: string }
  | null;

export function bannerState(
  current: string | undefined,
  releases: Release[],
  dismissed: string | null,
  lastSeen: string | null,
): BannerState {
  if (!current) return null;
  const newer = releasesNewerThan(releases, current);
  if (newer.length && newer[0].version !== dismissed)
    return { kind: 'available', latest: newer[0], newer };
  if (lastSeen && compareVersions(current, lastSeen) > 0)
    return { kind: 'updated', version: current };
  return null;
}

/** Opens what "update" means on this host: the release download on the
 *  desktop, the self-hosting instructions on the web. */
export function openUpdate(release: Release): void {
  void window.api.openExternal(isWeb() ? SELF_HOST_UPDATE_DOCS : release.url);
}
