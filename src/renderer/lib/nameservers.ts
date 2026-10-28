import { getDomain, getSubdomain } from 'tldts';
import { marketNameserversFor } from '../../shared/market-nameservers';

// Groups a nameserver hostname into the bucket the Nameservers filter uses.
//
// The default bucket is the nameserver's registrable ("base") domain, parsed
// with tldts so multi-part public suffixes resolve correctly — e.g.
// `ns-220-a.gandi.net` → `gandi.net`, and `n.a.b.3.host.co.uk` → `host.co.uk`.
//
// Markets' own nameservers come first: each set a market publishes
// (src/shared/market-nameservers.ts) is its own group, named for the market
// ("Atom", "Sedo"). Afternic's pairs stay split, and any
// other Afternic nsN pair still groups by consecutive pair.

export interface NsGroup {
  /** Stable id used for filter selection. */
  key: string;
  /** Human-facing label shown in the dropdown. */
  label: string;
}

/** Base domains that split by nsN pair, with the name their groups show. */
const SPLIT_BY_PAIR = new Map([['afternic.com', 'Afternic']]);

/**
 * The group for a single nameserver hostname, or null when it has no parseable
 * base domain (e.g. an IP address or malformed value).
 */
export function nameserverGroup(host: string): NsGroup | null {
  const h = host.trim().toLowerCase();
  if (!h) return null;

  const market = marketNameserversFor(h);
  if (market) return { key: market.key, label: market.label };

  const base = getDomain(h);
  if (!base) return null;

  const pairName = SPLIT_BY_PAIR.get(base);
  if (pairName) {
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
      return {
        key: `${base}#${pair}`,
        label: `${pairName} (ns${lo}/ns${hi})`,
      };
    }
  }

  return { key: base, label: base };
}
