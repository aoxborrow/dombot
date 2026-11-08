import type { MarketNameservers } from '../../../shared/markets';

// Dynadot's marketplace nameservers. Verifying a name held elsewhere by
// nameservers means `ns1.dyna-ns.net` and `ns2.dyna-ns.net`, plus
// `ns3-<key>.dyna-ns.org`, which carries the account's Open Marketplace Key
// (seen in the dashboard, 2026-11-03). The pair is Dynadot's everyday DNS,
// which every name at Dynadot on Dynadot DNS uses too, so only the NS3 marks
// a name as on the market's nameservers; the preset adds the pair
// (shared/market-verification.ts).
export const DYNADOT_NAMESERVERS: MarketNameservers[] = [
  { key: 'dyna-ns.org', label: 'Dynadot (NS3)', hosts: ['*.dyna-ns.org'] },
];
