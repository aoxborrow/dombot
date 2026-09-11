import { request } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  MAX_PROXY_RESPONSE_BYTES,
  type NamecheapProxyFetch,
} from '../core/services/namecheap-proxy';

export const desktopNamecheapProxyFetch: NamecheapProxyFetch = async (
  proxy,
  url,
  init,
) => {
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
      req.on('error', reject);
      if (typeof init.body === 'string') req.write(init.body);
      req.end();
    });
  } finally {
    agent.destroy();
  }
};
