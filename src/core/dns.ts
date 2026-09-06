// Nameserver lookup over DNS-over-HTTPS. Used by the sync for registrars whose
// API doesn't report a domain's nameservers. Runs on every host (plain `fetch`),
// unlike `node:dns`, which the Cloudflare Worker doesn't have. Cloudflare's
// resolver first, Google's as a fallback; empty on any failure, timeout, or
// undelegated domain — a missing nameserver list is cosmetic, never fatal.

const RESOLVERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve',
] as const;

const TIMEOUT_MS = 5_000;
const TYPE_NS = 2;

interface DnsJson {
  Status?: number;
  Answer?: { type: number; data: string }[];
}

/** Parses a DNS JSON response into lowercase, dot-stripped NS hostnames. */
export function nameserversFromDnsJson(json: DnsJson): string[] {
  if (json.Status !== 0 || !Array.isArray(json.Answer)) return [];
  return json.Answer.filter((a) => a.type === TYPE_NS)
    .map((a) => a.data.toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
}

/**
 * The NS records for `domainName`, or [] if none can be determined. Tries each
 * resolver in turn, each capped at TIMEOUT_MS.
 */
export async function resolveNameservers(
  domainName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  for (const base of RESOLVERS) {
    try {
      const url = `${base}?name=${encodeURIComponent(domainName)}&type=NS`;
      const res = await fetchImpl(url, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const ns = nameserversFromDnsJson((await res.json()) as DnsJson);
      if (ns.length > 0) return ns;
      // A clean "no NS records" answer is authoritative — don't ask again.
      return [];
    } catch {
      // Network/timeout/parse failure: try the next resolver.
    }
  }
  return [];
}
