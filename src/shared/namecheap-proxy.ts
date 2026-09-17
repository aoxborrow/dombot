import { parseProxy, type ProxyRoute } from './proxy';

// Before the central proxy settings, a Namecheap account kept its proxy in its
// own credential bag as `proxyUrl` / `proxyIp`. Nothing writes those fields any
// more. This reader remains for the migration that lifts them into a proxy
// profile and for validating older data bundles on import.

export type NamecheapProxy = ProxyRoute;
export { isProxyHost, isPublicIpv4 } from './proxy';

/** The legacy per-account proxy in a credential bag, validated; null if none. */
export function parseNamecheapProxy(
  values: Record<string, unknown>,
): NamecheapProxy | null {
  return parseProxy({ url: values.proxyUrl, egressIp: values.proxyIp });
}
