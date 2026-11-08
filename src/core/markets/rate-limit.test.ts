import { describe, expect, it } from 'vitest';
import { RateLimiter, pacedFetch, type Clock } from './rate-limit';

// A fetch that waits its turn on a limiter shared with a market client.

function fakeClock(): Clock & { slept: number[] } {
  let now = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
  };
}

describe('pacedFetch', () => {
  it('takes from the same budget as everything else on the limiter', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock, 2);
    const sent: string[] = [];
    const fetch = pacedFetch(limiter, async (input) => {
      sent.push(String(input));
      return new Response('ok');
    });
    await limiter.take(); // the market client's call
    await fetch('https://api.dynadot.com/a');
    expect(clock.slept).toEqual([]);
    // The budget (two a minute) is spent: the next request waits.
    await fetch('https://api.dynadot.com/b');
    expect(clock.slept.length).toBeGreaterThan(0);
    expect(sent).toEqual([
      'https://api.dynadot.com/a',
      'https://api.dynadot.com/b',
    ]);
  });
});
