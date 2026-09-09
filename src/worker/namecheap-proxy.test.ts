import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientOptions } from 'tunnelfetch';
import { MAX_PROXY_RESPONSE_BYTES } from '../core/services/namecheap-proxy';

const mock = vi.hoisted(() => ({
  options: [] as ClientOptions[],
  fetch: vi.fn<(url: string, init: RequestInit) => Promise<Response>>(),
  close: vi.fn<() => Promise<void>>(),
  connect: vi.fn(),
}));
vi.mock('cloudflare:sockets', () => ({ connect: mock.connect }));
vi.mock('tunnelfetch', () => ({
  Client: class {
    constructor(options: ClientOptions) {
      mock.options.push(options);
    }
    fetch = mock.fetch;
    close = mock.close;
  },
}));
import { workerNamecheapProxyFetch } from './namecheap-proxy';
const proxy = { url: 'http://test:secret@8.8.8.8:8080/', ip: '8.8.4.4' };

beforeEach(() => {
  mock.options.length = 0;
  mock.fetch.mockReset();
  mock.close.mockReset().mockResolvedValue();
});

describe('Worker proxy transport lifecycle', () => {
  it('verifies certificates, bounds decoded bodies, disables redirects and isolates each request', async () => {
    mock.fetch.mockImplementation(
      async () =>
        new Response('decoded', {
          headers: { 'content-encoding': 'gzip', 'content-length': '100' },
        }),
    );
    const signal = new AbortController().signal;
    for (let i = 0; i < 2; i++) {
      const response = await workerNamecheapProxyFetch(
        proxy,
        'https://api.namecheap.com/xml.response',
        { signal },
      );
      expect(await response.text()).toBe('decoded');
      expect(response.headers.has('content-encoding')).toBe(false);
      expect(response.headers.has('content-length')).toBe(false);
    }
    expect(mock.options).toHaveLength(2);
    expect(mock.options[0]).toMatchObject({
      proxy: proxy.url,
      trust: { mode: 'system' },
      maxBodyBytes: MAX_PROXY_RESPONSE_BYTES,
    });
    expect(mock.fetch).toHaveBeenCalledWith(
      'https://api.namecheap.com/xml.response',
      expect.objectContaining({ redirect: 'manual', signal }),
    );
    expect(mock.close).toHaveBeenCalledTimes(2);
  });
  it('closes the client after handshake or body failures', async () => {
    mock.fetch.mockRejectedValueOnce(new Error('certificate failure'));
    await expect(
      workerNamecheapProxyFetch(
        proxy,
        'https://api.namecheap.com/xml.response',
        {},
      ),
    ).rejects.toThrow('certificate failure');
    mock.fetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('body interrupted'));
          },
        }),
      ),
    );
    await expect(
      workerNamecheapProxyFetch(
        proxy,
        'https://api.namecheap.com/xml.response',
        {},
      ),
    ).rejects.toThrow('body interrupted');
    expect(mock.close).toHaveBeenCalledTimes(2);
  });
  it('does not follow a redirect response', async () => {
    mock.fetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://elsewhere.example' },
      }),
    );
    const result = await workerNamecheapProxyFetch(
      proxy,
      'https://api.namecheap.com/xml.response',
      {},
    );
    expect(result.status).toBe(302);
    expect(mock.fetch).toHaveBeenCalledOnce();
  });
});
