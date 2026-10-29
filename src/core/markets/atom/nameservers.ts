import type { MarketNameservers } from '../../../shared/markets';

// Atom's nameservers: its marketplace pair (Premium listings must stay on
// it), AtomRegistrar's default pair (for names registered there), and its
// marketplace pair from when it was Squadhelp. Atom isn't known to assign
// nameservers per customer: its help describes only ns1/ns2.atom.com or a
// TXT record for verifying a name.
export const ATOM_NAMESERVERS: MarketNameservers[] = [
  { key: 'atom.com', label: 'Atom', hosts: ['ns1.atom.com', 'ns2.atom.com'] },
  {
    key: 'atomregistrar.com',
    label: 'AtomRegistrar',
    hosts: ['ns1.atomregistrar.com', 'ns2.atomregistrar.com'],
  },
  {
    key: 'squadhelp.com',
    label: 'Atom (Squadhelp)',
    hosts: ['ns1.squadhelp.com', 'ns2.squadhelp.com'],
  },
];
