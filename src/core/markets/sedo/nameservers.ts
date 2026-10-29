import type { MarketNameservers } from '../../../shared/markets';

// Sedo's nameservers: its parking pair, which also verifies a name and
// shows it for sale (docs/sedo-api.md).
export const SEDO_NAMESERVERS: MarketNameservers[] = [
  {
    key: 'sedoparking.com',
    label: 'Sedo',
    hosts: ['ns1.sedoparking.com', 'ns2.sedoparking.com'],
  },
];
