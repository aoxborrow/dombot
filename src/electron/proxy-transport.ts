import { request } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  MAX_PROXY_RESPONSE_BYTES,
  ProxyStageError,
  type ProxyFetch,
} from '../core/services/proxy-transport';

export const desktopProxyFetch: ProxyFetch = async (proxy, url, init) => {
  const agent = new HttpsProxyAgent(proxy.url);
  try {
    return await new Promise<Response>((resolve, reject) => {
      const req = request(
        url,
        {
          method: init.method,
          headers: Object.fromEntries(new Headers(init.headers)),
          agent,
          signal: init.signal ?? undefined,
          rejectUnauthorized: true,
        },
        (res) => {
          const chunks: Uint8Array[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_PROXY_RESPONSE_BYTES) {
              req.destroy(new Error('Proxy response too large.'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (value !== undefined)
                headers.set(
                  key,
                  Array.isArray(value) ? value.join(', ') : value,
                );
            }
            headers.delete('transfer-encoding');
            const status = res.statusCode ?? 502;
            resolve(
              new Response(
                [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
                { status, headers },
              ),
            );
          });
        },
      );
      // https-proxy-agent replays a refused CONNECT as though the registrar had
      // answered. Report it as what it is: the tunnel never opened, so the
      // request was never sent.
      req.on('proxyConnect', (connect: { statusCode?: number }) => {
        const status = connect.statusCode ?? 0;
        if (status === 200) return;
        const failure = new ProxyStageError(
          status === 407 ? 'PROXY_AUTH_FAILED' : 'PROXY_CONNECT_REFUSED',
          `proxy answered CONNECT with ${status}`,
        );
        reject(failure);
        req.destroy(failure);
      });
      req.on('error', reject);
      if (typeof init.body === 'string') req.write(init.body);
      req.end();
    });
  } finally {
    agent.destroy();
  }
};
