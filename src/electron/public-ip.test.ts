import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicIp } from './public-ip';

const answer = (status: number, body: string) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(body, { status }));

describe('publicIp', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the address ipify reports', async () => {
    const fetch = answer(200, '203.0.113.7\n');
    await expect(publicIp()).resolves.toBe('203.0.113.7');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.ipify.org',
      expect.anything(),
    );
  });

  it('rejects anything that isn’t an IP address', async () => {
    answer(200, '<html>blocked</html>');
    await expect(publicIp()).rejects.toThrow(/no IP address/);
    answer(503, '');
    await expect(publicIp()).rejects.toThrow(/503/);
  });
});
