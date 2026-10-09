import { useEffect } from 'react';
import { create } from 'zustand';
import {
  parseReleaseFeed,
  releasesNewerThan,
  type Release,
  type ReleaseFeed,
} from '../../shared/releases';
import { isDemo, isWeb } from './platform';
import { useAppStore } from '../store/app';

// The release feed in the renderer, plus what this device remembers between
// launches: the last list fetched, when it last checked on its own, and the
// newest release dismissed from the bell. All in localStorage like the other
// display preferences: they're about this window, not the instance.

/** Where a self-hoster reads how to update their setup. */
export const SELF_HOST_UPDATE_DOCS =
  'https://github.com/aoxborrow/dombot/blob/main/docs/self-hosting.md#choosing-a-setup';

/** Every release, with notes, on GitHub. */
export const RELEASES_PAGE = 'https://github.com/aoxborrow/dombot/releases';

/** How often a device checks on its own. "Check now" ignores it. */
export const AUTO_CHECK_MS = 7 * 24 * 60 * 60 * 1000;

/** How often an open window asks whether its weekly check is due. */
const POLL_MS = 6 * 60 * 60 * 1000;

const FEED_KEY = 'dombot-release-feed';
const AUTO_CHECKED_KEY = 'dombot-update-checked';
const DISMISSED_KEY = 'dombot-update-dismissed';

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
  /** The newest release version dismissed from the bell on this device. */
  dismissed: string | null;
  /** Fetch the feed now (`force` skips the host's few-hour cache). */
  check: (force?: boolean) => Promise<void>;
  /** Check if this device hasn't in a week; otherwise do nothing. */
  autoCheck: () => Promise<void>;
  dismiss: (version: string) => void;
}

export const useUpdates = create<UpdatesState>((set, get) => ({
  feed: readFeed(),
  checking: false,
  dismissed: read(DISMISSED_KEY),
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
}));

/** Runs the weekly check for as long as the app is open (not in the demo,
 *  and not with update checks turned off). Mounted once, in App. */
export function useWeeklyUpdateCheck(): void {
  const updateChecks = useAppStore((s) => s.settings?.updateChecks);
  const appInfo = useAppStore((s) => s.appInfo);
  const loadAppInfo = useAppStore((s) => s.loadAppInfo);
  const autoCheck = useUpdates((s) => s.autoCheck);
  // The running version, to compare releases against.
  useEffect(() => {
    if (!appInfo) void loadAppInfo();
  }, [appInfo, loadAppInfo]);
  useEffect(() => {
    if (isDemo() || !updateChecks) return;
    void autoCheck();
    const timer = setInterval(() => void autoCheck(), POLL_MS);
    return () => clearInterval(timer);
  }, [updateChecks, autoCheck]);
}

/** A newer release than the one running. Null in the demo, with update
 *  checks off, or when this is the latest. */
export function useAvailableUpdate(): {
  current: string;
  latest: Release;
  newer: Release[];
} | null {
  const current = useAppStore((s) => s.appInfo?.version);
  const updateChecks = useAppStore((s) => s.settings?.updateChecks);
  const releases = useUpdates((s) => s.feed?.releases);
  if (isDemo() || !updateChecks || !current || !releases) return null;
  const newer = releasesNewerThan(releases, current);
  return newer.length ? { current, latest: newer[0], newer } : null;
}

/** The release notes worth reading: the one release if there's one, every
 *  release otherwise. */
export function releaseNotesUrl(newer: Release[]): string {
  return newer.length === 1 ? newer[0].url : RELEASES_PAGE;
}

/** Opens what "update" means on this host: the release download on the
 *  desktop, the self-hosting instructions on the web. */
export function openUpdate(release: Release): void {
  void window.api.openExternal(isWeb() ? SELF_HOST_UPDATE_DOCS : release.url);
}
