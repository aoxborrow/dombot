import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailCancelled, DetailLane, type DetailPace } from './detail-lane';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

const pace = (windows: DetailPace['windows'], pauseMs = 5_000): DetailPace => ({
  windows,
  pauseMs,
});

describe('DetailLane', () => {
  it('runs the burst at once, then at the slowest window’s rate', async () => {
    // Two a second, three a minute.
    const lane = new DetailLane(
      pace([
        { reads: 2, perMs: 1_000 },
        { reads: 3, perMs: 60_000 },
      ]),
    );
    const started: number[] = [];
    for (let i = 0; i < 4; i++)
      void lane.run(`n${i}`, async () => {
        started.push(Date.now());
      });

    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([0, 0]);
    await vi.advanceTimersByTimeAsync(499);
    expect(started).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toEqual([0, 0, 500]);
    // The minute window is spent: the fourth waits for it, not the second's.
    await vi.advanceTimersByTimeAsync(19_000);
    expect(started).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(600);
    expect(started).toHaveLength(4);
  });

  it('runs urgent and promoted reads first', async () => {
    const lane = new DetailLane(pace([{ reads: 10, perMs: 1_000 }]));
    const order: string[] = [];
    const read = (key: string) => async () => {
      order.push(key);
    };
    void lane.run('a', read('a'));
    void lane.run('b', read('b'));
    void lane.run('c', read('c'));
    void lane.run('d', read('d'), true);
    lane.promote('c');

    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['c', 'd', 'a', 'b']);
  });

  it('waits out a rate limit, then runs the same read again', async () => {
    const lane = new DetailLane(pace([{ reads: 10, perMs: 60_000 }], 300_000));
    const attempts: number[] = [];
    const read = vi.fn(async () => {
      attempts.push(Date.now());
      if (attempts.length === 1)
        throw new Error(
          "Error invoking remote method 'api': RateLimitError: Namecheap rate limit reached. Try again in a few minutes.",
        );
      return 'detail';
    });
    const result = lane.run('a', read);

    await vi.advanceTimersByTimeAsync(300_000);
    expect(attempts).toEqual([0]);
    // Nothing refilled during the pause: one token's wait (6 s) after it.
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(result).resolves.toBe('detail');
    expect(attempts).toEqual([0, 306_000]);
  });

  it('rejects a read that fails for another reason and moves on', async () => {
    const lane = new DetailLane(pace([{ reads: 10, perMs: 1_000 }]));
    const failed = lane.run('a', async () => {
      throw new Error('no detail for this TLD');
    });
    const next = lane.run('b', async () => 'ok');
    await expect(failed).rejects.toThrow('no detail for this TLD');
    await expect(next).resolves.toBe('ok');
  });

  it('drops queued reads on clear', async () => {
    const lane = new DetailLane(pace([{ reads: 1, perMs: 1_000 }]));
    const first = lane.run('a', async () => 'a');
    await vi.advanceTimersByTimeAsync(0);
    const queued = lane.run('b', async () => 'b');
    lane.clear();
    await expect(first).resolves.toBe('a');
    await expect(queued).rejects.toBeInstanceOf(DetailCancelled);
    expect(lane.pending).toBe(0);
  });

  it('pauses but doesn’t run again a read dropped mid-flight that hits the limit', async () => {
    const lane = new DetailLane(pace([{ reads: 10, perMs: 60_000 }], 300_000));
    let fail!: (err: Error) => void;
    const dropped = vi.fn(
      () => new Promise<string>((_, reject) => (fail = reject)),
    );
    const first = lane.run('a', dropped);
    await vi.advanceTimersByTimeAsync(0);
    expect(dropped).toHaveBeenCalledTimes(1);

    // A Sync clears the lane while the read is out, then the registrar
    // turns it away for quota.
    lane.clear();
    fail(new Error('Namecheap rate limit reached. Try again later.'));
    await expect(first).rejects.toBeInstanceOf(DetailCancelled);
    expect(lane.pending).toBe(0);

    // The next pass's read still waits out the pause.
    const started: number[] = [];
    void lane.run('b', async () => {
      started.push(Date.now());
    });
    await vi.advanceTimersByTimeAsync(300_000 + 6_000);
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(started).toEqual([306_000]);
  });
});
