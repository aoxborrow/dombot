import { isRateCurrency } from '../../shared/currencies';
import { localDay } from '../../shared/domain-events';
import type { Domain, RegistrarMeta, RegistrarName } from '../../shared/ipc';

// Recording a registration (docs/unrecorded-activity.md): the day from the
// name's created date, the fee from its registrar. The Record registration
// dialog fills these in; the one-click Record registration on Activity saves
// them as they are.

/** The UTC day a name was created, or today when that's unknown. */
export function registrationDay(created: Domain['createdDate']): string {
  if (created) {
    const date = created instanceof Date ? created : new Date(created);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return localDay();
}

/** The fee to record, or a sentence saying why there isn't one. */
export type RegistrationFee =
  { amount: string; currency: string } | { note: string };

/**
 * The registrar's registration fee for a name: a live pricing call to the
 * account that holds it. A fee in a currency DomBot can't convert is no fee,
 * unless it's `keep`, the currency already chosen. Throws when the call fails.
 */
export async function registrationFee(
  domain: Domain,
  registrars: RegistrarMeta[] | null,
  keep?: string,
): Promise<RegistrationFee> {
  if (!domain.registrar || !domain.accountId)
    return {
      note: "No connected account holds this name, so there's no fee to fill in.",
    };
  const quote = await window.api.getRegistrationQuote(
    domain.registrar as RegistrarName,
    domain.domainName,
    domain.accountId,
  );
  const name =
    registrars?.find((r) => r.name === domain.registrar)?.displayName ??
    'This registrar';
  if (!quote.amount)
    return { note: `${name} doesn't report a registration fee.` };
  if (!isRateCurrency(quote.currency) && quote.currency !== keep)
    return {
      note: `${name} quotes the fee in ${quote.currency}, which DomBot can't convert.`,
    };
  return { amount: quote.amount, currency: quote.currency };
}

/** An error from the pricing call, without Electron's wrapper. */
export function feeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'Could not look up the fee.';
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '');
}
