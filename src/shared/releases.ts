// The release feed: every published DomBot release, served as a static file
// from the website (site/public/releases.json, written by the release
// workflow). Both hosts read it to tell the user a newer version exists; the
// notes themselves stay on GitHub. Pure helpers here; fetching lives in
// src/core/services/releases.ts.

/** Where the hosts fetch the feed from. */
export const RELEASES_URL = 'https://dombot.ai/releases.json';

export interface Release {
  /** `1.5.0` — the tag without its `v`. */
  version: string;
  tag: string;
  name: string;
  /** ISO timestamp. */
  publishedAt: string;
  /** The release page on GitHub. */
  url: string;
}

export interface ReleaseFeed {
  /** Newest first. Empty when the feed hasn't been fetched successfully. */
  releases: Release[];
  /** When the feed was last fetched successfully; null if never. */
  checkedAt: string | null;
  /** The last fetch's failure, if it failed. Earlier releases are kept. */
  error: string | null;
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Orders two `x.y.z` versions (a leading `v` allowed); a pre-release sorts
 *  before its release. Unparseable versions sort below every real one. */
export function compareVersions(a: string, b: string): number {
  const pa = VERSION.exec(a.trim());
  const pb = VERSION.exec(b.trim());
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return Math.sign(d);
  }
  if (pa[4] === pb[4]) return 0;
  if (!pa[4]) return 1;
  if (!pb[4]) return -1;
  return pa[4] < pb[4] ? -1 : 1;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Reads a fetched feed, dropping entries it can't use rather than failing
 *  the whole thing, and sorts newest first. */
export function parseReleaseFeed(json: unknown): Release[] {
  const list = (json as { releases?: unknown } | null)?.releases;
  if (!Array.isArray(list)) return [];
  const out: Release[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const tag = str(r.tag);
    const version = str(r.version) || tag.replace(/^v/, '');
    if (!VERSION.test(version)) continue;
    const url = str(r.url);
    out.push({
      version,
      tag: tag || `v${version}`,
      name: str(r.name) || `DomBot ${version}`,
      publishedAt: str(r.publishedAt),
      url: /^https:\/\//.test(url)
        ? url
        : `https://github.com/aoxborrow/dombot/releases/tag/v${version}`,
    });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

/** A build from main between releases (`dev+a1b2c3d`, the demo), not a
 *  release version. */
export function isDevVersion(version: string): boolean {
  return /^dev(\+|$)/.test(version);
}

/** Releases newer than `version`, newest first. None for a dev build, which
 *  is ahead of every release. */
export function releasesNewerThan(
  releases: Release[],
  version: string,
): Release[] {
  if (isDevVersion(version)) return [];
  return releases.filter((r) => compareVersions(r.version, version) > 0);
}

/** How old a stored list can be before Settings → About fetches it again on
 *  opening. The weekly background check can leave a device a release behind;
 *  someone looking at About wants today's list. */
export const ABOUT_REFRESH_MS = 24 * 60 * 60 * 1000;

/** Whether `feed` was never fetched, or was fetched more than `maxAgeMs` ago. */
export function feedIsStale(
  feed: Pick<ReleaseFeed, 'checkedAt'> | null,
  maxAgeMs: number = ABOUT_REFRESH_MS,
  now: number = Date.now(),
): boolean {
  const at = feed?.checkedAt ? Date.parse(feed.checkedAt) : NaN;
  return !Number.isFinite(at) || now - at > maxAgeMs;
}
