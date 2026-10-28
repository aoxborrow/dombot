import type { MarketNameservers } from '../../../shared/markets';

// Afternic's nameservers. Every pair serves its for-sale page; which page
// shows is set per listing, not by the pair. ns1/ns2 have a delegation quirk
// some registries (.de) refuse, so ns3/ns4 or ns5/ns6 are the usual choice.
// The filter keys are the ones DomBot used before markets declared these.
export const AFTERNIC_NAMESERVERS: MarketNameservers[] = [
  {
    key: 'afternic.com#1',
    label: 'Afternic (ns1/ns2)',
    hosts: ['ns1.afternic.com', 'ns2.afternic.com'],
  },
  {
    key: 'afternic.com#2',
    label: 'Afternic (ns3/ns4)',
    hosts: ['ns3.afternic.com', 'ns4.afternic.com'],
  },
  {
    key: 'afternic.com#3',
    label: 'Afternic (ns5/ns6)',
    hosts: ['ns5.afternic.com', 'ns6.afternic.com'],
  },
];
