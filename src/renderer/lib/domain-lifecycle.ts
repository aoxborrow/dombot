// Lifecycle pill for a registrar status string. Registrars don't share one
// flag, so this matches the words they actually send: Gandi's EPP codes,
// GoDaddy, Cloudflare, and Spaceship enums, and Namecheap or Namesilo
// "expired" once detail is fetched. A healthy name returns null.

export type LifecycleTone =
  'redemption' | 'deleted' | 'expired' | 'grace' | 'hold';

export interface LifecycleFlag {
  label: string;
  tone: LifecycleTone;
  /** Hover text, when this state has something to say beyond its label. */
  title?: string;
}

/**
 * A short label for a name that isn't in a normal active state, or null.
 * GoDaddy's `deleted_redeemable` (v1: `CANCELLED_REDEEMABLE`) is a name you
 * deleted that can still be restored, so the pill says Deleted. Registry
 * redemption (pending delete, recoverable, restorable) still says Redemption.
 * A bare `deleted` stays unlabeled: that name is gone.
 */
export function domainLifecycle(status: string): LifecycleFlag | null {
  const s = status.toLowerCase();
  if (/redeemable/.test(s)) {
    return {
      label: 'Deleted',
      tone: 'deleted',
      title: 'Deleted at the registrar. It can still be restored.',
    };
  }
  if (/redemption|pending_?delete|recoverable|restorable/.test(s)) {
    return { label: 'Redemption', tone: 'redemption' };
  }
  if (/expired/.test(s)) return { label: 'Expired', tone: 'expired' };
  if (/grace|autorenewperiod|renewperiod/.test(s)) {
    return { label: 'Grace', tone: 'grace' };
  }
  if (/hold/.test(s)) return { label: 'Hold', tone: 'hold' };
  return null;
}
