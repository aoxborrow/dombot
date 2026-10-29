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

/**
 * A token bucket: holds up to `capacity` requests and refills evenly over a
 * minute, so a burst can use the whole budget and steady use stays under it.
 */
export class RateLimiter {
  private tokens: number;
  private last: number;
  private queue: Promise<void> = Promise.resolve();
  /** Earliest time the next request may go, after a 429's Retry-After. */
  private pausedUntil = 0;

  constructor(
    private readonly clock: Clock,
    private readonly capacity: number,
  ) {
    this.tokens = capacity;
    this.last = clock.now();
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
