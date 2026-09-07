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

// RCODEs that are a definitive answer about the name, as opposed to a problem
// with the resolver we asked. NOERROR with no NS records and NXDOMAIN both
// mean "this domain has no delegation"; SERVFAIL, REFUSED, etc. mean "ask
// someone else".
const RCODE_NOERROR = 0;
const RCODE_NXDOMAIN = 3;

/**
 * Parses a DNS JSON response into lowercase, dot-stripped NS hostnames.
 * Returns `null` when the response is a resolver error (SERVFAIL, REFUSED, a
 * malformed body) rather than an answer, so the caller can try another
 * resolver; an authoritative "no records" is `[]`.
 */
export function nameserversFromDnsJson(json: DnsJson): string[] | null {
  if (json.Status === RCODE_NXDOMAIN) return [];
  if (json.Status !== RCODE_NOERROR) return null;
  if (!Array.isArray(json.Answer)) return [];
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
      // null = the resolver itself failed; try the next one. A real answer,
      // including an authoritative "no NS records", is final.
      if (ns !== null) return ns;
    } catch {
      // Network/timeout/parse failure: try the next resolver.
    }
  }
  return [];
}
