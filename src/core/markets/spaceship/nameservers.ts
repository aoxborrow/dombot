import type { MarketNameservers } from '../../../shared/markets';

// SellerHub has no nameservers of its own: nothing in its API asks for
// them, and ownership is verified by a TXT record (docs/sellerhub-api.md,
// "Ownership verification"). Spaceship's everyday DNS (`spaceship.net`) is
// the registrar's, so it isn't declared here either: every name at
// Spaceship on Spaceship DNS would look listed.
export const SPACESHIP_NAMESERVERS: MarketNameservers[] = [];
