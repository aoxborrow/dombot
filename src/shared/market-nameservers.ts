import type { MarketId } from './markets';

// Each market's own nameservers, so DomBot can say what a name pointed at
// them is for (the Nameservers filter now; ownership verification later,
// docs/markets.md). Hardcoded: markets publish them, and they rarely change.
// Listed for every market DomBot supports, connected or not, since a name
// can sit on a market's nameservers without an account in DomBot.

export interface MarketNameservers {
  market: MarketId;
  /** The Nameservers filter's key for this set; keep it stable. */
  key: string;
  /** How the filter names it. */
  label: string;
  /** Lowercase hostnames. */
  hosts: readonly string[];
}

/** A market's first set is the one to point a name at. */
export const MARKET_NAMESERVERS: readonly MarketNameservers[] = [
  // Afternic's pairs all serve its for-sale page; which page shows is set
  // per listing, not by the pair. ns1/ns2 have a delegation quirk that some
  // registries (.de) refuse, so ns3/ns4 or ns5/ns6 are the usual choice.
  {
    market: 'afternic',
    key: 'afternic.com#1',
    label: 'Afternic (ns1/ns2)',
    hosts: ['ns1.afternic.com', 'ns2.afternic.com'],
  },
  {
    market: 'afternic',
    key: 'afternic.com#2',
    label: 'Afternic (ns3/ns4)',
    hosts: ['ns3.afternic.com', 'ns4.afternic.com'],
  },
  {
    market: 'afternic',
    key: 'afternic.com#3',
    label: 'Afternic (ns5/ns6)',
    hosts: ['ns5.afternic.com', 'ns6.afternic.com'],
  },
  // Atom: its marketplace pair (Premium listings must stay on it), its
  // registrar's default pair (for names registered at AtomRegistrar), and
  // its pair from when it was Squadhelp.
  {
    market: 'atom',
    key: 'atom.com',
    label: 'Atom',
    hosts: ['ns1.atom.com', 'ns2.atom.com'],
  },
  {
    market: 'atom',
    key: 'atomregistrar.com',
    label: 'AtomRegistrar',
    hosts: ['ns1.atomregistrar.com', 'ns2.atomregistrar.com'],
  },
  {
    market: 'atom',
    key: 'squadhelp.com',
    label: 'Atom (Squadhelp)',
    hosts: ['ns1.squadhelp.com', 'ns2.squadhelp.com'],
  },
  {
    market: 'sedo',
    key: 'sedoparking.com',
    label: 'Sedo',
    hosts: ['ns1.sedoparking.com', 'ns2.sedoparking.com'],
  },
];

/** The market nameserver set a hostname belongs to, if any. */
export function marketNameserversFor(host: string): MarketNameservers | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (!h) return null;
  return MARKET_NAMESERVERS.find((s) => s.hosts.includes(h)) ?? null;
}

/** The nameservers to point a name at for `market`: its first set. */
export function defaultMarketNameservers(market: MarketId): string[] {
  const set = MARKET_NAMESERVERS.find((s) => s.market === market);
  return set ? [...set.hosts] : [];
}
