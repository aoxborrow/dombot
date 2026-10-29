import { describe, expect, it } from 'vitest';
import {
  LEASE_MONTHS,
  leaseCommissionDiscount,
  leaseDefaultsOf,
  leaseMonthOptions,
  monthlyPayment,
} from './lease-to-own';

describe('lease-to-own', () => {
  it('offers 3, 6, 9, 12, then every 6 months to 60', () => {
    expect(LEASE_MONTHS).toEqual([3, 6, 9, 12, 18, 24, 30, 36, 42, 48, 54, 60]);
  });

  it('keeps a listing’s own months when they aren’t offered', () => {
    expect(leaseMonthOptions(24)).toEqual(LEASE_MONTHS);
    expect(leaseMonthOptions(null)).toEqual(LEASE_MONTHS);
    expect(leaseMonthOptions(10)).toEqual([
      3, 6, 9, 10, 12, 18, 24, 30, 36, 42, 48, 54, 60,
    ]);
  });

  it('gives Afternic’s commission discount for longer leases', () => {
    expect(
      [3, 12, 13, 24, 30, 36, 42, 60].map(leaseCommissionDiscount),
    ).toEqual([0, 0, 5, 5, 10, 10, 15, 15]);
  });

  it('rounds each payment up, and needs a price', () => {
    expect(monthlyPayment(2500, 24)).toBe(105);
    expect(monthlyPayment(null, 24)).toBeNull();
    expect(monthlyPayment(0, 24)).toBeNull();
  });

  it('reads Afternic’s settings, ignoring what isn’t there', () => {
    expect(
      leaseDefaultsOf({
        leasingEnabled: true,
        maxLeasePeriod: 60,
        intakeStyle: 'PRICE_FORM',
      }),
    ).toEqual({ enabled: true, months: 60, lander: 'PRICE_FORM' });
    expect(
      leaseDefaultsOf({ leasingEnabled: null, intakeStyle: 'NOPE' }),
    ).toEqual({ enabled: null, months: null, lander: null });
  });
});
