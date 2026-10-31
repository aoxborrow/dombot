import type { Domain } from '../../shared/ipc';

/** A name's auto-renew as the Domains page's Auto-renew filter has it. */
export type AutoRenewChoice = 'on' | 'off' | 'unknown';

/**
 * On, off, or unknown: a name you added, whose registrar DomBot can't ask.
 * The filter, its counts and the cards (Auto-renew, Expiring) all use this,
 * so a card's click shows the names it counted.
 */
export function autoRenewChoice(
  d: Pick<Domain, 'autoRenew' | 'autoRenewUnknown'>,
): AutoRenewChoice {
  if (d.autoRenewUnknown) return 'unknown';
  return d.autoRenew ? 'on' : 'off';
}
