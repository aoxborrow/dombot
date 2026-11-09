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

  it('pauses everyone on the limiter after a 429', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(clock, 60);
    const fetch = pacedFetch(
      limiter,
      async () =>
        new Response('slow down', {
          status: 429,
          headers: { 'retry-after': '30' },
        }),
      { pauseMs: 60_000 },
    );
    await fetch('https://api.dynadot.com/a');
    // The market client's next call waits out Retry-After.
    await limiter.take();
    expect(clock.slept).toEqual([30_000]);
  });
});

/** A promise and the function that settles it. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('a serial limiter', () => {
  it('sends one request at a time, and keeps going after a failure', async () => {
    const limiter = new RateLimiter(fakeClock(), 60, { serial: true });
    const events: string[] = [];
    const first = deferred();
    const a = limiter.run(async () => {
      events.push('a start');
      await first.promise;
      events.push('a end');
      throw new Error('a failed');
    });
    const b = limiter.run(async () => {
      events.push('b start');
      return 'b';
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual(['a start']);
    first.resolve();
    await expect(a).rejects.toThrow('a failed');
    expect(await b).toBe('b');
    expect(events).toEqual(['a start', 'a end', 'b start']);
  });

  it('lets requests overlap when it isn’t serial', async () => {
    const limiter = new RateLimiter(fakeClock(), 60);
    const events: string[] = [];
    const first = deferred();
    const a = limiter.run(async () => {
      events.push('a start');
      await first.promise;
    });
    const b = limiter.run(async () => {
      events.push('b start');
    });
    await b;
    expect(events).toEqual(['a start', 'b start']);
    first.resolve();
    await a;
  });

  it('reads a paced fetch’s body inside its turn', async () => {
    const limiter = new RateLimiter(fakeClock(), 60, { serial: true });
    const started: string[] = [];
    const body = deferred<string>();
    const fetch = pacedFetch(limiter, async (input) => {
      started.push(String(input));
      if (String(input).endsWith('/a')) {
        // A body that arrives later.
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode(await body.promise));
            controller.close();
          },
        });
        return new Response(stream);
      }
      return new Response(null, { status: 204 });
    });
    const a = fetch('https://api.dynadot.com/a');
    const b = fetch('https://api.dynadot.com/b');
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(['https://api.dynadot.com/a']);
    body.resolve('done');
    expect(await (await a).text()).toBe('done');
    expect((await b).status).toBe(204);
    expect(started).toEqual([
      'https://api.dynadot.com/a',
      'https://api.dynadot.com/b',
    ]);
  });
});
