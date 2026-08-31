import { getDomain, getSubdomain } from 'tldts';

// Groups a nameserver hostname into the bucket the Nameservers filter uses.
//
// The default bucket is the nameserver's registrable ("base") domain, parsed
// with tldts so multi-part public suffixes resolve correctly — e.g.
// `ns-220-a.gandi.net` → `gandi.net`, and `n.a.b.3.host.co.uk` → `host.co.uk`.
//
// Exceptions: a few providers run distinct nameserver sets under one base domain
// that behave differently, so we split those finer. Afternic is the case we
// care about — ns1/ns2, ns3/ns4, and ns5/ns6 do different things — so its
// nameservers group by consecutive pair rather than all under `afternic.com`.

export interface NsGroup {
  /** Stable id used for filter selection. */
  key: string;
  /** Human-facing label shown in the dropdown. */
  label: string;
}

/** Base domains that split into finer groups, keyed by the host/subdomain. */
const SPLIT_BY_PAIR = new Set(['afternic.com']);

/**
 * The group for a single nameserver hostname, or null when it has no parseable
 * base domain (e.g. an IP address or malformed value).
 */
export function nameserverGroup(host: string): NsGroup | null {
  const h = host.trim().toLowerCase();
  if (!h) return null;

  const base = getDomain(h);
  if (!base) return null;

  if (SPLIT_BY_PAIR.has(base)) {
    // Split by the leading nsN label in the subdomain: ns1/ns2 → pair 1,
    // ns3/ns4 → pair 2, and so on. Falls back to the base domain if the
    // subdomain doesn't match the expected pattern.
    const sub = getSubdomain(h) ?? '';
    const match = /(?:^|\.)ns(\d+)(?:$|\.)/.exec(sub);
    if (match) {
      const n = Number(match[1]);
      const pair = Math.ceil(n / 2);
      const lo = pair * 2 - 1;
      const hi = pair * 2;
      return { key: `${base}#${pair}`, label: `${base} (ns${lo}/ns${hi})` };
    }
  }

  return { key: base, label: base };
}
