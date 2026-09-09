import {
  AbortError,
  ConnectionError,
  HttpClient,
  NamecheapRegistrar,
  parseXml,
  TimeoutError,
  type RegistrarCredentials,
  type RequestConfig,
} from '@aoxborrow/registrar-client';
import {
  parseNamecheapProxy,
  type NamecheapProxy,
} from '../../shared/namecheap-proxy';

export const NAMECHEAP_API = 'https://api.namecheap.com/xml.response';
export const MAX_PROXY_RESPONSE_BYTES = 2 * 1024 * 1024;
export type NamecheapProxyFetch = (
  proxy: NamecheapProxy,
  url: string,
  init: RequestInit,
) => Promise<Response>;

// A host supplies a transport, never a shared open socket. The factory is used
// by every Namecheap caller (UI, cron, MCP and domain operations).
let transport: NamecheapProxyFetch | undefined;
export function configureNamecheapProxyTransport(
  next?: NamecheapProxyFetch,
): void {
  transport = next;
}

// Namecheap sends writes via GET too. Unknown/new commands fail safe: no retry.
const READ_COMMANDS = new Set([
  'namecheap.domains.getList',
  'namecheap.domains.getInfo',
  'namecheap.domains.getRegistrarLock',
  'namecheap.domains.check',
  'namecheap.users.getPricing',
  'namecheap.domains.getContacts',
  'namecheap.domains.dns.getList',
  'namecheap.domains.dns.getHosts',
  'namecheap.domains.dns.getEmailForwarding',
]);

export function createProxiedNamecheap(
  credentials: RegistrarCredentials,
  settings: NamecheapProxy,
): NamecheapRegistrar {
  const parsedProxy = parseNamecheapProxy({
    proxyUrl: settings.url,
    proxyIp: settings.ip,
  });
  if (!parsedProxy)
    throw new Error('Configure the Namecheap proxy URL and outgoing IP.');
  const proxy: NamecheapProxy = parsedProxy;
  const send = transport;
  if (!send)
    throw new Error('Namecheap proxy transport is unavailable on this host.');

  // HttpClient and the protected http slot are published extension points in
  // registrar-client 0.5.0. No unpublished dependency or global fetch replacement.
  class ProxyHttpClient extends HttpClient {
    protected override withRetries<T>(
      req: RequestConfig,
      attempt: () => Promise<T>,
    ): Promise<T> {
      const reads = READ_COMMANDS.has(String(req.query?.Command ?? ''));
      return super.withRetries(
        {
          ...req,
          retries: reads
            ? Math.min(
                2,
                Math.max(0, req.retries ?? this.config.options.retries),
              )
            : 0,
        },
        attempt,
      );
    }

    protected override async send(req: RequestConfig): Promise<string> {
      const target = new URL(this.buildUrl(req));
      if (
        target.origin + target.pathname !== NAMECHEAP_API ||
        target.username ||
        target.password ||
        target.hash
      ) {
        throw new Error('Proxy requests are restricted to the Namecheap API.');
      }
      target.searchParams.set('ClientIp', proxy.ip);
      const outer = req.signal ?? this.config.options.signal;
      if (outer?.aborted)
        throw new AbortError('Namecheap proxy request cancelled.');
      const controller = new AbortController();
      const abort = () => controller.abort();
      outer?.addEventListener('abort', abort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, req.timeout ?? this.config.options.timeout);
      const read = READ_COMMANDS.has(String(req.query?.Command ?? ''));
      const uncertain = read
        ? ''
        : ' Check the operation outcome in Namecheap before retrying.';
      try {
        let response: Response;
        try {
          response = await send!(proxy, target.href, {
            method: req.method ?? 'GET',
            headers: {
              'User-Agent': '@aoxborrow/registrar-client',
              Accept: 'application/xml',
              'Accept-Encoding': 'identity',
              ...(req.body !== undefined
                ? { 'Content-Type': 'application/json' }
                : {}),
            },
            body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
            redirect: 'manual',
            signal: controller.signal,
          });
        } catch (error) {
          if (outer?.aborted)
            throw new AbortError('Namecheap proxy request cancelled.');
          if (timedOut)
            throw new TimeoutError(
              'Namecheap proxy request timed out.' + uncertain,
            );
          const code =
            error && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : '';
          if (
            /^(CERT_|ERR_TLS_CERT_|PROXY_AUTH_|PROXY_CONNECT_REFUSED|CONFIG_|BODY_TOO_LARGE)/.test(
              code,
            ) ||
            [
              'DEPTH_ZERO_SELF_SIGNED_CERT',
              'SELF_SIGNED_CERT_IN_CHAIN',
              'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
              'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
            ].includes(code)
          ) {
            throw new Error(
              'Namecheap proxy rejected the connection. Check proxy authentication and certificate settings.',
            );
          }
          throw new ConnectionError(
            'Namecheap proxy connection failed.' + uncertain,
          );
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          // Do not surface upstream bodies, proxy credentials or API query strings.
          const error = await super.toStatusError(
            new Response(null, {
              status: response.status,
              headers: response.headers,
            }),
            NAMECHEAP_API,
          );
          if (!read && response.status >= 500) error.message += uncertain;
          throw error;
        }
        let text: string;
        try {
          text = await response.text();
        } catch {
          throw new ConnectionError(
            'Namecheap proxy response was interrupted.' + uncertain,
          );
        }
        let parsed: { ApiResponse?: { '@_Status'?: string } };
        try {
          parsed = parseXml(text);
        } catch {
          throw new Error('Namecheap proxy returned malformed XML.');
        }
        if (parsed?.ApiResponse?.['@_Status'] === 'ERROR') {
          const codes = [
            ...text.matchAll(/<Error\b[^>]*\bNumber=["'](\d{1,10})["']/g),
          ]
            .slice(0, 5)
            .map((m) => m[1]);
          throw new Error(
            `Namecheap API rejected the request${codes.length ? ` (code ${codes.join(', ')})` : ''}.`,
          );
        }
        if (parsed?.ApiResponse?.['@_Status'] !== 'OK')
          throw new Error('Namecheap proxy returned an unexpected response.');
        return text;
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener('abort', abort);
      }
    }
  }

  class ProxiedRegistrar extends NamecheapRegistrar {
    constructor() {
      super({ ...credentials, clientIp: proxy.ip });
      this.http = new ProxyHttpClient({
        baseUrl: NAMECHEAP_API,
        options: this.options,
      });
    }
  }
  return new ProxiedRegistrar();
}
