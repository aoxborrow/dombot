import {
  createRegistrar,
  markNotSent,
  registrars,
  type Registrar,
  type RegistrarCredentials,
  type RegistrarName,
} from '@aoxborrow/registrar-client';
import { parseProxy, type ProxyRoute } from '../../shared/proxy';

// Routing a registrar account through the fixed IP proxy.
//
// registrar-client takes a `fetch`, so every provider uses the same path: the
// library builds the request exactly as it would for a direct connection, and
// this module hands it to the host's tunnel instead of the network. Retries,
// timeouts, error types and redaction are therefore identical either way.

export const MAX_PROXY_RESPONSE_BYTES = 2 * 1024 * 1024;

/** A host's way of making one HTTPS request through a CONNECT proxy. Desktop
 * uses https-proxy-agent; the Worker uses tunnelfetch over cloudflare:sockets.
 * A failure before the tunnel carries the request should reject with a
 * `ProxyStageError` (or any error whose `code` starts with `PROXY_`). */
export type ProxyFetch = (
  proxy: ProxyRoute,
  url: string,
  init: RequestInit,
) => Promise<Response>;

// A host supplies a transport, never a shared open socket.
let transport: ProxyFetch | undefined;
export function configureProxyTransport(next?: ProxyFetch): void {
  transport = next;
}
export function getProxyTransport(): ProxyFetch | undefined {
  return transport;
}

/** The tunnel was never established, so the registrar never saw the request. */
export class ProxyStageError extends Error {
  constructor(
    public readonly code:
      | 'PROXY_UNREACHABLE'
      | 'PROXY_AUTH_FAILED'
      | 'PROXY_CONNECT_REFUSED'
      | 'PROXY_PROTOCOL',
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = 'ProxyStageError';
  }
}

// Failure codes (ours and tunnelfetch's) that can only occur before the request
// is written: reaching or authenticating to the proxy, and verifying the
// registrar's certificate inside the tunnel. Anything mid-stream is left out;
// for those the library assumes the request may have arrived.
const BEFORE_SEND =
  /^(PROXY_|CERT_|OCSP_|CONFIG_|TLS_HANDSHAKE$|TLS_(VERSION|CIPHER|GROUP|SIGALG|EXTENSION)_UNSUPPORTED$)/;

function codeOf(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : '';
}

/** A proxy-stage failure in words the user can act on. Never includes the
 * proxy URL or the transport's own message, either of which may hold secrets. */
function proxyStageMessage(code: string): string {
  if (code.startsWith('PROXY_AUTH'))
    return 'The proxy rejected the username or password. Check Settings → Proxy.';
  if (code === 'PROXY_CONNECT_REFUSED')
    return 'The proxy refused to open a connection to the registrar.';
  if (code === 'PROXY_UNREACHABLE')
    return 'Could not reach the proxy. Check its address and port in Settings → Proxy.';
  if (code === 'PROXY_PROTOCOL')
    return 'The proxy gave an invalid reply. It may not be an HTTP CONNECT proxy.';
  if (code.startsWith('CERT_') || code.startsWith('OCSP_'))
    return 'A certificate could not be verified through the proxy.';
  return 'The proxy connection could not be set up.';
}

/**
 * One request through the proxy. Proxy-stage failures come back as a clear
 * message marked "not sent", which the library retries for any call, reads and
 * writes alike, since the registrar cannot have acted on them. Other failures
 * pass through untouched for the library to classify.
 */
export async function sendThroughProxy(
  proxy: ProxyRoute,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const send = transport;
  // Never fall back to a direct request from an address nobody whitelisted.
  if (!send)
    throw markNotSent(new Error('The fixed IP proxy is not available here.'));
  try {
    return await send(proxy, url, init);
  } catch (error) {
    // The caller's own cancellation or timeout: let the library see it as such.
    if (error instanceof Error && error.name === 'AbortError') throw error;
    const code = codeOf(error);
    if (BEFORE_SEND.test(code))
      throw markNotSent(
        Object.assign(new Error(proxyStageMessage(code)), { code }),
      );
    // Anything else keeps only its code. A transport's message can quote the
    // proxy URL, and this must be safe even where no redaction wraps it. The
    // code still lets the library spot a failure that preceded sending.
    throw Object.assign(
      new Error(
        `The connection through the proxy failed${code ? ` (${code})` : ''}.`,
      ),
      code ? { code } : {},
    );
  }
}

/**
 * A provider whose every request goes through `route`. Requests are pinned to
 * the provider's own API origin: the library only ever calls that host, so
 * anything else is a bug or an attack and is refused rather than tunnelled.
 */
export function createProxiedRegistrar(
  name: RegistrarName,
  credentials: RegistrarCredentials,
  route: ProxyRoute,
): Registrar {
  const proxy = parseProxy({ url: route.url, egressIp: route.ip });
  if (!proxy) throw new Error('Configure the proxy URL and outgoing IP.');
  if (!transport) throw new Error('The fixed IP proxy is not available here.');
  const displayName = registrars[name].displayName;
  let apiOrigin = '';

  const fetch: typeof globalThis.fetch = (input, init) => {
    const target = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (
      !apiOrigin ||
      target.origin !== apiOrigin ||
      target.protocol !== 'https:' ||
      target.username ||
      target.password
    )
      return Promise.reject(
        new Error(`Proxy requests are restricted to the ${displayName} API.`),
      );
    const headers = new Headers(init?.headers);
    // The desktop tunnel doesn't decompress.
    headers.set('Accept-Encoding', 'identity');
    return sendThroughProxy(proxy, target.href, {
      ...init,
      headers,
      redirect: 'manual',
    });
  };

  const provider = createRegistrar(
    name,
    // Through the proxy, its outgoing address is the Client IP Namecheap sees.
    name === 'namecheap' ? { ...credentials, clientIp: proxy.ip } : credentials,
    { fetch },
  );
  const baseUrl = (
    provider as unknown as { http?: { config?: { baseUrl?: string } } }
  ).http?.config?.baseUrl;
  if (!baseUrl)
    throw new Error(`Cannot determine the ${displayName} API address.`);
  apiOrigin = new URL(baseUrl).origin;
  return provider;
}
