import { connect } from 'cloudflare:sockets';
import { Client } from 'tunnelfetch';
import {
  MAX_PROXY_RESPONSE_BYTES,
  type NamecheapProxyFetch,
} from '../core/services/namecheap-proxy';

export const workerNamecheapProxyFetch: NamecheapProxyFetch = async (
  proxy,
  url,
  init,
) => {
  const client = new Client({
    connect: (address, options) =>
      connect(address, {
        ...options,
        allowHalfOpen: options?.allowHalfOpen ?? false,
      }),
    proxy: proxy.url,
    trust: { mode: 'system' },
    http2: false,
    maxBodyBytes: MAX_PROXY_RESPONSE_BYTES,
    timeouts: {
      connectMs: 10000,
      handshakeMs: 15000,
      headersMs: 15000,
      idleMs: 15000,
      totalMs: 30000,
    },
  });
  try {
    const response = await client.fetch(url, { ...init, redirect: 'manual' });
    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    headers.delete('transfer-encoding');
    return new Response(
      [204, 205, 304].includes(response.status) ? null : body,
      { status: response.status, headers },
    );
  } finally {
    // A cached registrar must never retain sockets owned by an earlier Worker invocation.
    await client.close();
  }
};
