// A per-account request budget for market APIs. Sync, a bulk edit and
// per-domain stats can all run at once for the same account, so the budget
// is shared by account key, not owned by one client instance. Each market's
// client sets its own rate (Afternic publishes 150 a minute; Sedo doesn't
// say).

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface RateLimiterOptions {
  /**
   * One request in flight at a time, for an API that answers a second one
   * with a 429 (Dynadot on a Regular account): `run` waits until the one
   * before has finished, its answer read.
   */
  serial?: boolean;
}

/**
 * A token bucket: holds up to `capacity` requests and refills evenly over a
 * minute, so a burst can use the whole budget and steady use stays under it.
 */
export class RateLimiter {
  readonly serial: boolean;
  private tokens: number;
  private last: number;
  private queue: Promise<void> = Promise.resolve();
  /** The request in flight on a serial limiter. */
  private inFlight: Promise<void> = Promise.resolve();
  /** Earliest time the next request may go, after a 429's Retry-After. */
  private pausedUntil = 0;

  constructor(
    private readonly clock: Clock,
    private readonly capacity: number,
    options: RateLimiterOptions = {},
  ) {
    this.tokens = capacity;
    this.last = clock.now();
    this.serial = options.serial ?? false;
  }

  /**
   * Wait for a turn, then send `request`. On a serial limiter the next
   * request waits for this one to settle, so `request` should read the
   * whole answer before it resolves.
   */
  run<T>(request: () => Promise<T>): Promise<T> {
    if (!this.serial) return this.take().then(request);
    const turn = this.inFlight.then(() => this.take()).then(request);
    this.inFlight = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  /** Resolves when a request may be sent. Callers are served in order. */
  take(): Promise<void> {
    const turn = this.queue.then(() => this.waitForToken());
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  /** Stop everyone until `ms` from now (the server said to back off). */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + ms);
  }

  private refill(): void {
    const now = this.clock.now();
    const perMs = this.capacity / 60_000;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (now - this.last) * perMs,
    );
    this.last = now;
  }

  private async waitForToken(): Promise<void> {
    for (;;) {
      const paused = this.pausedUntil - this.clock.now();
      if (paused > 0) {
        await this.clock.sleep(paused);
        continue;
      }
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.clock.sleep(
        Math.ceil((1 - this.tokens) * (60_000 / this.capacity)),
      );
    }
  }
}

/**
 * `fetch` that waits its turn on `limiter` first, for a library that takes a
 * fetch (registrar-client) to share a market client's budget. A response
 * that says to back off pauses the limiter for everyone on it, the market
 * client included: for `Retry-After`'s seconds, else `pauseMs`.
 */
export function pacedFetch(
  limiter: RateLimiter,
  inner: typeof fetch = (...args) => fetch(...args),
  options: {
    pauseMs: number;
    /** Whether a response is a rate-limit answer (default: HTTP 429). */
    rateLimited?: (response: Response) => boolean | Promise<boolean>;
  } = { pauseMs: 60_000 },
): typeof fetch {
  const rateLimited =
    options.rateLimited ?? ((response: Response) => response.status === 429);
  return async (input, init) => {
    const response = await limiter.run(async () => {
      const r = await inner(input, init);
      // On a serial limiter the body is read inside the turn, so the next
      // request doesn't start while this one is still arriving.
      return limiter.serial ? buffered(r) : r;
    });
    if (await rateLimited(response)) {
      const retryAfter = Number(response.headers.get('retry-after'));
      limiter.pause(retryAfter > 0 ? retryAfter * 1000 : options.pauseMs);
    }
    return response;
  };
}

/** Statuses whose responses can't carry a body. */
const NULL_BODY = new Set([204, 205, 304]);

/** The same response with its body read to the end. */
async function buffered(response: Response): Promise<Response> {
  const body = NULL_BODY.has(response.status)
    ? null
    : await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

const shared = new Map<string, RateLimiter>();

/** The limiter for `key` (market and account), created on first use. */
export function sharedLimiter(
  key: string,
  create: () => RateLimiter,
): RateLimiter {
  let limiter = shared.get(key);
  if (!limiter) {
    limiter = create();
    shared.set(key, limiter);
  }
  return limiter;
}
