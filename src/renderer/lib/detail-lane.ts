import type { RegistrarName } from '../../shared/ipc';
import { isRateLimitMessage } from '../../shared/rate-limit';

// Pacing for the background detail reads at registrars with a tight API quota.
// The table reads detail for every row whose list left out nameservers, and
// at full speed that spent Namecheap's hourly quota in a few minutes. After
// that every read failed, and so did Sync, until the hour was up.

/** At most `reads` detail reads in any `perMs` stretch. */
export interface PaceWindow {
  reads: number;
  perMs: number;
}

export interface DetailPace {
  /** Every window must have room before a read starts. */
  windows: readonly PaceWindow[];
  /** How long to wait once the registrar says the quota is spent. */
  pauseMs: number;
}

// Namecheap allows 50 calls a minute, 700 an hour and 8,000 a day across the
// whole API key, and a detail read is two calls (getInfo, which carries the
// nameservers, and getRegistrarLock). 18 reads a minute is 36 calls and 270 an
// hour is 540, which leaves room for Sync's list, pricing and premium calls.
// A name whose getInfo lists no nameservers costs a third call (dns.getList).
export const DETAIL_PACE: Partial<Record<RegistrarName, DetailPace>> = {
  namecheap: {
    windows: [
      { reads: 18, perMs: 60_000 },
      { reads: 270, perMs: 60 * 60_000 },
    ],
    pauseMs: 5 * 60_000,
  },
};

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** A queued read dropped by `clear()`, after a Sync made it moot. */
export class DetailCancelled extends Error {
  constructor() {
    super('Detail read cancelled');
    this.name = 'DetailCancelled';
  }
}

interface Job {
  key: string;
  read: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

interface Bucket {
  window: PaceWindow;
  tokens: number;
}

/**
 * One account's detail reads, one at a time, within the registrar's pace.
 * Each window is a token bucket that starts full and refills evenly, so a
 * short list loads at once and a long one settles to the slowest window's
 * rate. A read the registrar turns away for quota goes back to the front of
 * the queue and runs again after a pause.
 */
export class DetailLane {
  private queue: Job[] = [];
  private buckets: Bucket[];
  private refilledAt: number;
  private pausedUntil = 0;
  private draining = false;
  /** The read running now, unless `clear()` dropped it mid-flight. */
  private running: Job | null = null;

  constructor(
    private readonly pace: DetailPace,
    private readonly clock: Clock = realClock,
  ) {
    this.buckets = pace.windows.map((w) => ({ window: w, tokens: w.reads }));
    this.refilledAt = clock.now();
  }

  /** Runs `read` in its turn and settles with its outcome. `urgent` puts it
   *  ahead of everything queued (a row on screen before the rest). */
  run<T>(key: string, read: () => Promise<T>, urgent = false): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        key,
        read,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      if (urgent) this.queue.unshift(job);
      else this.queue.push(job);
      void this.drain();
    });
  }

  /** Moves a queued read to the front, when its row comes on screen. */
  promote(key: string): void {
    const i = this.queue.findIndex((j) => j.key === key);
    if (i > 0) this.queue.unshift(...this.queue.splice(i, 1));
  }

  /** Drops every queued read; each rejects with `DetailCancelled`. A read
   *  already running finishes, but isn't run again if it hits the limit. */
  clear(): void {
    this.running = null;
    for (const job of this.queue.splice(0)) job.reject(new DetailCancelled());
  }

  get pending(): number {
    return this.queue.length;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        await this.waitForTurn();
        const job = this.queue.shift();
        if (!job) break;
        this.running = job;
        try {
          job.resolve(await job.read());
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!isRateLimitMessage(message)) {
            job.reject(err);
            continue;
          }
          // Start again slowly: nothing refills during the pause, so the
          // first read after it waits for a token rather than bursting. The
          // quota is spent either way, so a dropped read still pauses the
          // lane; it just isn't run again.
          this.pausedUntil = this.clock.now() + this.pace.pauseMs;
          this.refilledAt = this.pausedUntil;
          for (const b of this.buckets) b.tokens = 0;
          if (this.running === job) this.queue.unshift(job);
          else job.reject(new DetailCancelled());
        } finally {
          this.running = null;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = now - this.refilledAt;
    this.refilledAt = now;
    for (const b of this.buckets) {
      b.tokens = Math.min(
        b.window.reads,
        b.tokens + (elapsed * b.window.reads) / b.window.perMs,
      );
    }
  }

  private async waitForTurn(): Promise<void> {
    for (;;) {
      const paused = this.pausedUntil - this.clock.now();
      if (paused > 0) {
        await this.clock.sleep(paused);
        continue;
      }
      this.refill();
      const wait = Math.max(
        0,
        ...this.buckets.map((b) =>
          b.tokens >= 1
            ? 0
            : Math.ceil(((1 - b.tokens) * b.window.perMs) / b.window.reads),
        ),
      );
      if (wait === 0) {
        for (const b of this.buckets) b.tokens -= 1;
        return;
      }
      await this.clock.sleep(wait);
    }
  }
}
