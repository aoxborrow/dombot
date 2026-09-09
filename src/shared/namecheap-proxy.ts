import type { CredentialValues } from './ipc';

export interface NamecheapProxy {
  url: string;
  ip: string;
}

/** Only public IPv4 literals: no DNS rebinding, local networks or metadata IPs. */
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

/** Pure validation shared by the form and server; never echo secret URLs. */
export function parseNamecheapProxy(
  values: Record<string, unknown>,
): NamecheapProxy | null {
  if (
    [values.proxyUrl, values.proxyIp].some(
      (v) => v !== undefined && typeof v !== 'string',
    )
  )
    throw new Error('Proxy settings must be text values.');
  const raw = typeof values.proxyUrl === 'string' ? values.proxyUrl.trim() : '';
  const ip = typeof values.proxyIp === 'string' ? values.proxyIp.trim() : '';
  if (!raw && !ip) return null;
  if (!raw || !ip)
    throw new Error('Enter both the proxy URL and its outgoing IPv4 address.');
  if (raw.length > 2048) throw new Error('The proxy URL is too long.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Enter a valid HTTP proxy URL.');
  }
  if (
    url.protocol !== 'http:' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Use an HTTP CONNECT proxy URL without a path, query or fragment.',
    );
  }
  if (!isPublicIpv4(url.hostname))
    throw new Error('The proxy endpoint must be a public IPv4 address.');
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

/** Keep the direct Client IP and drafts when toggling; remove proxy secrets on save-off. */
export function namecheapCredentials(
  values: CredentialValues,
  enabled: boolean,
): CredentialValues {
  const next = { ...values };
  if (!enabled) {
    delete next.proxyUrl;
    delete next.proxyIp;
  } else if (!parseNamecheapProxy(next))
    throw new Error('Enter both the proxy URL and its outgoing IPv4 address.');
  return next;
}
