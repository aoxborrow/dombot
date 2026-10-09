import { create } from 'zustand';
import {
  compareVersions,
  parseReleaseFeed,
  releasesNewerThan,
  type Release,
  type ReleaseFeed,
} from '../../shared/releases';
import { isWeb } from './platform';

// The release feed in the renderer, plus what this device remembers between
// launches: the last list fetched, when it last checked on its own, the
// newest release whose banner was dismissed, and the version it last ran.
// All in localStorage like the other display preferences: they're about this
// window, not the instance.

/** Where a self-hoster reads how to update their setup. */
export const SELF_HOST_UPDATE_DOCS =
  'https://github.com/aoxborrow/dombot/blob/main/docs/self-hosting.md#choosing-a-setup';

/** How often a device checks on its own. "Check now" ignores it. */
export const AUTO_CHECK_MS = 7 * 24 * 60 * 60 * 1000;

const FEED_KEY = 'dombot-release-feed';
const AUTO_CHECKED_KEY = 'dombot-update-checked';
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
    // Storage unavailable — this device just forgets between launches.
  }
}

/** The last successfully fetched list, so a known update still shows
 *  between weekly checks. Re-validated, since it's only a stored blob. */
function readFeed(): ReleaseFeed | null {
  try {
    const stored = JSON.parse(read(FEED_KEY) ?? 'null') as {
      releases?: unknown;
      checkedAt?: unknown;
    } | null;
    if (!stored || typeof stored.checkedAt !== 'string') return null;
    return {
      releases: parseReleaseFeed(stored),
      checkedAt: stored.checkedAt,
      error: null,
    };
  } catch {
    return null;
  }
}

interface UpdatesState {
  feed: ReleaseFeed | null;
  checking: boolean;
  /** The newest release version whose banner was dismissed here. */
  dismissed: string | null;
  /** The version this device last ran, for the "updated" note. */
  lastSeen: string | null;
  /** Fetch the feed now (`force` skips the host's few-hour cache). */
  check: (force?: boolean) => Promise<void>;
  /** Check if this device hasn't in a week; otherwise do nothing. */
  autoCheck: () => Promise<void>;
  dismiss: (version: string) => void;
  markSeen: (version: string) => void;
}

export const useUpdates = create<UpdatesState>((set, get) => ({
  feed: readFeed(),
  checking: false,
  dismissed: read(DISMISSED_KEY),
  lastSeen: read(LAST_SEEN_KEY),
  check: async (force = false) => {
    set({ checking: true });
    try {
      const feed = await window.api.getReleaseFeed(force);
      set({ feed });
      if (!feed.error && feed.checkedAt)
        write(
          FEED_KEY,
          JSON.stringify({
            releases: feed.releases,
            checkedAt: feed.checkedAt,
          }),
        );
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
  autoCheck: async () => {
    const last = Number(read(AUTO_CHECKED_KEY));
    if (Number.isFinite(last) && Date.now() - last < AUTO_CHECK_MS) return;
    // Recorded before the fetch, so an offline device waits a week too
    // rather than retrying on every launch.
    write(AUTO_CHECKED_KEY, String(Date.now()));
    await get().check();
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
