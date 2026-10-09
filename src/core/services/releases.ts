import {
  parseReleaseFeed,
  RELEASES_URL,
  type Release,
  type ReleaseFeed,
} from '../../shared/releases';
import { userAgentHeaders } from '../app-info';

// Fetches the release feed for the update banner and Settings → About. Runs on
// the host (Electron main, the Worker), not in the renderer, so neither the
// renderer's CSP nor CORS is involved. The result is kept in memory for a few
// hours: every window, tab and Worker isolate asks about once a day anyway.

const FRESH_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

let cache: { releases: Release[]; checkedAt: string } | null = null;
let lastError: string | null = null;

/** The feed, refetched when older than a few hours or when `force` is set.
 *  A failed fetch keeps the last good releases and reports the error. */
export async function getReleaseFeed(force = false): Promise<ReleaseFeed> {
  const fresh =
    cache && Date.now() - Date.parse(cache.checkedAt) < FRESH_MS && !lastError;
  if (!force && fresh) return { ...cache!, error: null };
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { accept: 'application/json', ...userAgentHeaders() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`dombot.ai answered ${res.status}`);
    cache = {
      releases: parseReleaseFeed(await res.json()),
      checkedAt: new Date().toISOString(),
    };
    lastError = null;
  } catch (err) {
    lastError =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'dombot.ai did not answer in time'
        : err instanceof Error
          ? err.message
          : String(err);
  }
  return {
    releases: cache?.releases ?? [],
    checkedAt: cache?.checkedAt ?? null,
    error: lastError,
  };
}

/** Test hook: forget the cached feed. */
export function resetReleaseFeed(): void {
  cache = null;
  lastError = null;
}
