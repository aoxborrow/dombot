import { request } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  MAX_PROXY_RESPONSE_BYTES,
  ProxyStageError,
  type ProxyFetch,
} from '../core/services/proxy-transport';

/** The request body as bytes, whatever form the caller gave it in. */
export async function bodyBytes(
  body: RequestInit['body'],
): Promise<Buffer | undefined> {
  if (body == null) return undefined;
  if (typeof body === 'string') return Buffer.from(body);
  return Buffer.from(await new Response(body).arrayBuffer());
}

/**
 * Headers for a request whose body is `payload`, always framed with
 * Content-Length. Left to itself, Node frames a written body as
 * `Transfer-Encoding: chunked`, and some registrar APIs (Dynadot's REST API
 * among them) reset the connection on a chunked request, so every write
 * through the proxy failed with ECONNRESET while bodyless reads went through.
 * fetch and tunnelfetch both send Content-Length, so this matches them.
 */
export function framedHeaders(
  headers: RequestInit['headers'],
  method: string,
  payload: Buffer | undefined,
): Record<string, string> {
  const out = new Headers(headers);
  out.delete('transfer-encoding');
  if (payload) out.set('content-length', String(payload.byteLength));
  else if (['POST', 'PUT', 'PATCH'].includes(method))
    out.set('content-length', '0');
  else out.delete('content-length');
  return Object.fromEntries(out);
}

export const desktopProxyFetch: ProxyFetch = async (proxy, url, init) => {
  const method = (init.method ?? 'GET').toUpperCase();
  const payload = await bodyBytes(init.body);
  const agent = new HttpsProxyAgent(proxy.url);
  try {
    return await new Promise<Response>((resolve, reject) => {
      const req = request(
        url,
        {
          method,
          headers: framedHeaders(init.headers, method, payload),
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
      req.end(payload);
    });
  } finally {
    agent.destroy();
  }
};
