// The fixed IP proxy: one CONNECT proxy DomBot can route a registrar account's
// API traffic through, so requests arrive from an address the registrar has
// allowlisted. Configured once (Settings → Proxy) and switched on per account.

/** A stored proxy. The shape allows several; the UI manages only `default`. */
export interface ProxyProfile {
  id: string;
  label: string;
  /** `http(s)://[user:pass@]host:port/`. Secret: it carries the password. */
  url: string;
  /** The public IPv4 the registrar sees, which may differ from the proxy host. */
  egressIp: string;
}

/** What a transport needs to open a tunnel. */
export interface ProxyRoute {
  url: string;
  ip: string;
}

export const PROXIES_NAMESPACE = 'proxies';
export const DEFAULT_PROXY_ID = 'default';

/** Public IPv4 literals only: no loopback, private, link-local or reserved ranges. */
export function isPublicIpv4(value: string): boolean {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return false;
  const parts = value.split('.').map(Number);
  if (parts.some((p, i) => p > 255 || String(p) !== value.split('.')[i]))
    return false;
  const [a, b, c] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 &&
      (b === 168 ||
        (b === 0 && (c === 0 || c === 2)) ||
        (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

const DNS_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DNS_NAME = new RegExp(`^${DNS_LABEL}(?:\\.${DNS_LABEL})+\\.?$`, 'i');
/**
 * A DNS hostname (at least two labels, so `localhost` and LAN shortnames are
 * out) or a public IPv4 literal. IPv6 literals are not supported. On the
 * Worker, Cloudflare blocks outbound sockets to private ranges regardless of
 * how the name resolves; on the desktop the proxy is the user's own choice.
 */
export function isProxyHost(hostname: string): boolean {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return isPublicIpv4(hostname);
  return hostname.length <= 253 && DNS_NAME.test(hostname);
}

/** Validates a proxy URL and its outgoing address. Pure, shared by the form and
 * the server, and never echoes the URL, which may hold a password. Returns null
 * when both are blank. */
export function parseProxy(input: {
  url?: unknown;
  egressIp?: unknown;
}): ProxyRoute | null {
  if (
    [input.url, input.egressIp].some(
      (v) => v !== undefined && typeof v !== 'string',
    )
  )
    throw new Error('Proxy settings must be text values.');
  const raw = typeof input.url === 'string' ? input.url.trim() : '';
  const ip = typeof input.egressIp === 'string' ? input.egressIp.trim() : '';
  if (!raw && !ip) return null;
  if (!raw || !ip)
    throw new Error('Enter both the proxy URL and its outgoing IPv4 address.');
  if (raw.length > 2048) throw new Error('The proxy URL is too long.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Enter a valid HTTP or HTTPS proxy URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Use an HTTP or HTTPS CONNECT proxy URL without a path, query or fragment.',
    );
  }
  if (!isProxyHost(url.hostname))
    throw new Error(
      'The proxy endpoint must be a hostname or a public IPv4 address.',
    );
  if (!isPublicIpv4(ip))
    throw new Error('The outgoing IP must be a public IPv4 address.');
  if (url.port === '0')
    throw new Error('The proxy port must be between 1 and 65535.');
  try {
    const user = decodeURIComponent(url.username),
      password = decodeURIComponent(url.password);
    if (
      Boolean(user) !== Boolean(password) ||
      [...(user + password)].some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      )
    )
      throw new Error();
  } catch {
    throw new Error(
      'Proxy authentication requires a valid username and password.',
    );
  }
  return { url: url.href, ip };
}

/** The strings in a proxy URL that must never reach a diagnostic. */
export function proxySecrets(url: string | undefined): string[] {
  if (!url) return [];
  const out = [url];
  try {
    const parsed = new URL(url);
    for (const part of [parsed.username, parsed.password]) {
      if (!part) continue;
      out.push(part);
      try {
        out.push(decodeURIComponent(part));
      } catch {
        // keep the raw form only
      }
    }
  } catch {
    // not a URL; the whole string is still redacted
  }
  return [...new Set(out)];
}
