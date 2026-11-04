import { describe, expect, it } from 'vitest';
import {
  ABOUT_REFRESH_MS,
  compareVersions,
  feedIsStale,
  isDevVersion,
  parseReleaseFeed,
  releasesNewerThan,
} from './releases';

describe('compareVersions', () => {
  it('orders by major, minor, patch', () => {
    expect(compareVersions('1.4.0', '1.5.0')).toBe(-1);
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
  });

  it('puts a pre-release before its release', () => {
    expect(compareVersions('1.5.0-beta.1', '1.5.0')).toBe(-1);
    expect(compareVersions('1.5.0', '1.5.0-beta.1')).toBe(1);
  });

  it('sorts unparseable versions lowest', () => {
    expect(compareVersions('junk', '0.0.1')).toBe(-1);
    expect(compareVersions('0.0.1', 'junk')).toBe(1);
  });
});

describe('parseReleaseFeed', () => {
  it('keeps valid entries newest first and fills defaults', () => {
    const releases = parseReleaseFeed({
      releases: [
        { tag: 'v1.4.0', notes: 'old', url: 'https://example.com/a' },
        { version: '1.5.0', tag: 'v1.5.0', name: 'Five', notes: 'new' },
        { tag: 'nightly' },
        null,
      ],
    });
    expect(releases.map((r) => r.version)).toEqual(['1.5.0', '1.4.0']);
    expect(releases[0]).toMatchObject({
      name: 'Five',
      url: 'https://github.com/aoxborrow/dombot/releases/tag/v1.5.0',
    });
    expect(releases[1]).toMatchObject({
      name: 'DomBot 1.4.0',
      url: 'https://example.com/a',
    });
  });

  it('tolerates a malformed feed', () => {
    expect(parseReleaseFeed(null)).toEqual([]);
    expect(parseReleaseFeed({ releases: 'x' })).toEqual([]);
  });

  it('never keeps a non-https link', () => {
    const [r] = parseReleaseFeed({
      releases: [{ tag: 'v1.0.0', url: 'javascript:alert(1)' }],
    });
    expect(r.url).toMatch(/^https:\/\/github\.com\//);
  });
});

describe('releasesNewerThan', () => {
  it('lists only later versions', () => {
    const releases = parseReleaseFeed({
      releases: [{ tag: 'v1.3.0' }, { tag: 'v1.4.0' }, { tag: 'v1.5.0' }],
    });
    expect(releasesNewerThan(releases, '1.4.0').map((r) => r.version)).toEqual([
      '1.5.0',
    ]);
  });

  it('lists none for a dev build (the demo, built from main)', () => {
    const releases = parseReleaseFeed({ releases: [{ tag: 'v1.5.0' }] });
    expect(releasesNewerThan(releases, 'dev+a1b2c3d')).toEqual([]);
    expect(releasesNewerThan(releases, 'dev')).toEqual([]);
    expect(isDevVersion('1.5.0')).toBe(false);
  });
});

describe('feedIsStale', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  const at = (ms: number) => ({ checkedAt: new Date(now - ms).toISOString() });

  it('is stale when never fetched', () => {
    expect(feedIsStale(null, ABOUT_REFRESH_MS, now)).toBe(true);
    expect(feedIsStale({ checkedAt: null }, ABOUT_REFRESH_MS, now)).toBe(true);
    expect(feedIsStale({ checkedAt: 'garbage' }, ABOUT_REFRESH_MS, now)).toBe(
      true,
    );
  });

  it('is stale only past the limit', () => {
    expect(feedIsStale(at(60 * 60 * 1000), ABOUT_REFRESH_MS, now)).toBe(false);
    expect(feedIsStale(at(ABOUT_REFRESH_MS), ABOUT_REFRESH_MS, now)).toBe(
      false,
    );
    expect(feedIsStale(at(5 * ABOUT_REFRESH_MS), ABOUT_REFRESH_MS, now)).toBe(
      true,
    );
  });
});
