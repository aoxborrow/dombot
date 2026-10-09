import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getReleaseFeed, resetReleaseFeed } from './releases';

const feed = {
  releases: [
    { version: '1.4.0', tag: 'v1.4.0', notes: 'four' },
    { version: '1.5.0', tag: 'v1.5.0', notes: 'five' },
  ],
};

describe('getReleaseFeed', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    resetReleaseFeed();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fetches, sorts and caches until forced', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(feed)));
    const first = await getReleaseFeed();
    expect(first.releases.map((r) => r.version)).toEqual(['1.5.0', '1.4.0']);
    expect(first.error).toBeNull();
    expect(first.checkedAt).not.toBeNull();

    await getReleaseFeed();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getReleaseFeed(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good releases when a refetch fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(feed)));
    await getReleaseFeed();
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503 }));
    const after = await getReleaseFeed(true);
    expect(after.releases).toHaveLength(2);
    expect(after.error).toBe('dombot.ai answered 503');
  });

  it('retries after a failure instead of serving it from cache', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect((await getReleaseFeed()).error).toBe('offline');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(feed)));
    expect((await getReleaseFeed()).error).toBeNull();
  });
});
