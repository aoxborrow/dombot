import { describe, expect, it } from 'vitest';
import { domainLifecycle } from './domain-lifecycle';

describe('domainLifecycle', () => {
  it('labels a deleted-but-redeemable name Deleted', () => {
    expect(domainLifecycle('deleted_redeemable')).toEqual({
      label: 'Deleted',
      tone: 'deleted',
      title: 'Deleted at the registrar. It can still be restored.',
    });
    expect(domainLifecycle('CANCELLED_REDEEMABLE')?.label).toBe('Deleted');
    expect(domainLifecycle('CANCELLED_REDEEMABLE')?.title).toBe(
      'Deleted at the registrar. It can still be restored.',
    );
  });

  it('keeps the other lifecycle words', () => {
    expect(domainLifecycle('redemption')?.label).toBe('Redemption');
    expect(domainLifecycle('pendingDelete')?.label).toBe('Redemption');
    expect(domainLifecycle('pending_delete')?.label).toBe('Redemption');
    expect(domainLifecycle('recoverable')?.label).toBe('Redemption');
    expect(domainLifecycle('restorable')?.label).toBe('Redemption');
    expect(domainLifecycle('expired')?.label).toBe('Expired');
    expect(domainLifecycle('grace2')?.label).toBe('Grace');
    expect(domainLifecycle('autoRenewPeriod')?.label).toBe('Grace');
    expect(domainLifecycle('clientHold')?.label).toBe('Hold');
  });

  it('leaves a healthy or fully deleted name unlabeled', () => {
    expect(domainLifecycle('active')).toBeNull();
    expect(domainLifecycle('ok')).toBeNull();
    expect(domainLifecycle('deleted')).toBeNull();
    expect(domainLifecycle('')).toBeNull();
  });
});
