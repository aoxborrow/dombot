// Which market accounts the ownership verification dialogs offer
// (docs/markets.md, "Ownership verification"). Pure, so the dialogs and the
// menus that open them agree.

import type { MarketAccountView, MarketInfo } from '../../shared/markets';
import { verificationTxt } from '../../shared/market-verification';

/**
 * Accounts Ownership verification TXT… offers: enabled ones with an
 * Ownership Verification ID saved. Writing the records needs no market key.
 */
export function txtAccounts(
  accounts: readonly MarketAccountView[],
): MarketAccountView[] {
  return accounts.filter((a) => a.enabled && !!a.verificationId);
}

/** The TXT record an account's ID asks for. */
export function txtValueOf(account: MarketAccountView): string {
  return verificationTxt(account.market, account.verificationId!);
}

/**
 * Accounts Recheck ownership… offers: enabled, with their key, on a market
 * that can be asked to check (Afternic relists, Atom verifies DNS). Sedo
 * checks on its own, so it never shows.
 */
export function recheckAccounts(
  accounts: readonly MarketAccountView[],
  catalog: readonly Pick<MarketInfo, 'id' | 'capabilities'>[],
): MarketAccountView[] {
  return accounts.filter((a) => {
    const caps = catalog.find((m) => m.id === a.market)?.capabilities;
    return (
      a.enabled && a.configured && !!caps && (caps.relist || caps.verifyDns)
    );
  });
}
