import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectRegistrarWithActivationWait,
  DynadotActivationPending,
} from './connect-registrar';

const unauthorized = new Error(
  'Request to ‘https://api.dynadot.com/restful/v2/accounts/info’ failed with 401 Unauthorized: {"code":401,"message":"Unauthorized","error":{"description":"The provided API key is invalid, expired, or missing. Please verify your key is correct and active."}}',
);

afterEach(() => vi.useRealTimers());

describe('new Dynadot key activation', () => {
  it('returns an immediately accepted account without waiting', async () => {
    const account = { id: 'connected' };
    const connect = vi.fn().mockResolvedValue(account);
    const waiting = vi.fn();
    await expect(
      connectRegistrarWithActivationWait(
        'dynadot',
        connect,
        new AbortController().signal,
        waiting,
      ),
    ).resolves.toBe(account);
    expect(connect).toHaveBeenCalledOnce();
    expect(waiting).not.toHaveBeenCalled();
  });

  it('waits between rejected tests and returns the account once the key works', async () => {
    vi.useFakeTimers();
    const account = { id: 'connected' };
    const connect = vi
      .fn()
      .mockRejectedValueOnce(unauthorized)
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValue(account);
    const waiting = vi.fn();
    const result = connectRegistrarWithActivationWait(
      'dynadot',
      connect,
      new AbortController().signal,
      waiting,
    );
    await vi.advanceTimersByTimeAsync(29_999);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(waiting).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(30_001);
    await expect(result).resolves.toBe(account);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(waiting).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops after three minutes with actionable guidance and no raw response', async () => {
    vi.useFakeTimers();
    const connect = vi.fn().mockRejectedValue(unauthorized);
    const result = connectRegistrarWithActivationWait(
      'dynadot',
      connect,
      new AbortController().signal,
      vi.fn(),
    );
    const check = expect(result).rejects.toThrow(DynadotActivationPending);
    await vi.advanceTimersByTimeAsync(180_000);
    await check;
    expect(connect).toHaveBeenCalledTimes(7);
    expect(new DynadotActivationPending().message).toMatch(
      /check.*API key and secret/,
    );
    expect(new DynadotActivationPending().message).not.toMatch(
      /401|https:|Unauthorized/,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels the wait without making another connection attempt', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const connect = vi.fn().mockRejectedValue(unauthorized);
    const waiting = vi.fn();
    const result = connectRegistrarWithActivationWait(
      'dynadot',
      connect,
      controller.signal,
      waiting,
    );
    const check = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await check;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(connect).toHaveBeenCalledOnce();
    expect(waiting).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stopping the wait rejects with the abort reason', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const connect = vi.fn().mockRejectedValue(unauthorized);
    const result = connectRegistrarWithActivationWait(
      'dynadot',
      connect,
      controller.signal,
      vi.fn(),
    );
    const check = expect(result).rejects.toThrow(DynadotActivationPending);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new DynadotActivationPending());
    await check;
    expect(connect).toHaveBeenCalledOnce();
  });

  it('does not retry after the browser resumes beyond the activation deadline', async () => {
    vi.useFakeTimers();
    const connect = vi.fn().mockRejectedValue(unauthorized);
    const result = connectRegistrarWithActivationWait(
      'dynadot',
      connect,
      new AbortController().signal,
      vi.fn(),
    );
    const check = expect(result).rejects.toThrow(DynadotActivationPending);
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() + 600_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await check;
    expect(connect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shortens the final wait when a slow connection test used most of the window', async () => {
    vi.useFakeTimers();
    const connect = vi
      .fn()
      .mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 179_000);
        throw unauthorized;
      })
      .mockRejectedValue(unauthorized);
    const result = connectRegistrarWithActivationWait(
      'dynadot',
      connect,
      new AbortController().signal,
      vi.fn(),
    );
    const check = expect(result).rejects.toThrow(DynadotActivationPending);
    await vi.advanceTimersByTimeAsync(1000);
    await check;
    expect(connect).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['porkbun', unauthorized],
    ['dynadot', new Error('429 Too Many Requests')],
    ['dynadot', new Error('500 Internal Server Error')],
    ['dynadot', new Error('These credentials are already connected')],
  ] as const)(
    'does not retry other failures (%s: %s)',
    async (registrar, error) => {
      const connect = vi.fn().mockRejectedValue(error);
      const waiting = vi.fn();
      await expect(
        connectRegistrarWithActivationWait(
          registrar,
          connect,
          new AbortController().signal,
          waiting,
        ),
      ).rejects.toBe(error);
      expect(connect).toHaveBeenCalledOnce();
      expect(waiting).not.toHaveBeenCalled();
    },
  );

  it('does not connect after the form has been unmounted', async () => {
    const controller = new AbortController();
    controller.abort();
    const connect = vi.fn();
    await expect(
      connectRegistrarWithActivationWait(
        'dynadot',
        connect,
        controller.signal,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(connect).not.toHaveBeenCalled();
  });
});
