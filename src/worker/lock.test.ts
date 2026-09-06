import { describe, expect, it } from 'vitest';
import { requestLockHeld, withRequestLock } from './lock';

describe('withRequestLock', () => {
  it('runs sections one at a time, in arrival order', async () => {
    const log: string[] = [];
    const slow = withRequestLock(async () => {
      log.push('a:start');
      expect(requestLockHeld()).toBe(true);
      await new Promise((r) => setTimeout(r, 20));
      log.push('a:end');
      return 'a';
    });
    const fast = withRequestLock(async () => {
      log.push('b');
      return 'b';
    });
    expect(requestLockHeld()).toBe(false); // nothing has started yet
    expect(await Promise.all([slow, fast])).toEqual(['a', 'b']);
    expect(log).toEqual(['a:start', 'a:end', 'b']);
    expect(requestLockHeld()).toBe(false);
  });

  it('releases after a failure so the next section still runs', async () => {
    await expect(
      withRequestLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await withRequestLock(async () => 42)).toBe(42);
    expect(requestLockHeld()).toBe(false);
  });
});
