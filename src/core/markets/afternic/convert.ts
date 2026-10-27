import { registrarFromAfternic } from './registrars';
import type {
  AfternicAccountSettings,
  AfternicListing,
  AfternicSale,
  DailyStats,
  SearchCounts,
} from './types';
import {
  dollarsToMicro,
  microToDecimal,
  microToDollars,
  type WireAccountSettings,
  type WireDomain,
  type WireSale,
  type WireSearchCounts,
  type WireStats,
} from './wire';

// Wire shapes → client types. Missing fields become null rather than a
// default, so callers can tell "Afternic didn't say" from "false" or "0".

/** A price that 0 means "not set" for (Buy Now, floor). */
function optionalPrice(micro: number | undefined): number | null {
  return micro ? microToDollars(micro) : null;
}

function decimal(micro: number | undefined): string | null {
  return micro == null ? null : microToDecimal(micro);
}

function searchCounts(wire: WireSearchCounts | undefined): SearchCounts {
  return {
    days30: wire?.['30d'] ?? null,
    days90: wire?.['90d'] ?? null,
    days365: wire?.['365d'] ?? null,
  };
}

export function toListing(wire: WireDomain): AfternicListing {
  return {
    name: wire.name,
    displayName: wire.displayName || wire.name,
    buyNow: optionalPrice(wire.buynowPrice),
    minOffer:
      wire.minbidPrice == null ? null : microToDollars(wire.minbidPrice),
    floor: optionalPrice(wire.floorPrice),
    leasingEnabled: wire.leasingEnabled ?? false,
    maxLeasePeriod: wire.maxLeasePeriod ?? null,
    landingPage: wire.landingPage ?? null,
    intakeStyle: wire.intakeStyle ?? null,
    showLanderBuynowOption: wire.showLanderBuynowOption ?? false,
    showLanderMakeOfferOption: wire.showLanderMakeOfferOption ?? false,
    showLanderLeaseToOwnOption: wire.showLanderLeaseToOwnOption ?? false,
    featured: wire.featured ?? null,
    hidden: wire.hidden ?? false,
    listStatus: wire.listStatus,
    createdAt: wire.createdAt,
    updatedAt: wire.updatedAt,
    registrarRaw: wire.registrar ?? null,
    registrar: registrarFromAfternic(wire.registrar),
    fastTransferStatus: wire.fastTransferStatus ?? null,
    offerCount: wire.offerCount ?? null,
    searches: wire.searches
      ? {
          total: searchCounts(wire.searches.total),
          unique: searchCounts(wire.searches.unique),
        }
      : null,
  };
}

export function toSale(wire: WireSale): AfternicSale {
  const leased = wire.saleType === 'LEASED';
  const net =
    wire.salePrice != null && wire.commission != null
      ? microToDecimal(wire.salePrice - wire.commission)
      : null;
  return {
    transactionId: wire.transactionId,
    name: wire.name,
    saleType: wire.saleType ?? null,
    status: wire.status ?? null,
    cancelReason: wire.cancelReason ?? null,
    salePrice: decimal(wire.salePrice),
    saleTotal: decimal(wire.saleTotal),
    commission: decimal(wire.commission),
    net,
    soldAt: wire.soldAt ?? null,
    disbursedAt: wire.disbursedAt ?? null,
    authCode: wire.authCode ?? null,
    lease: leased
      ? {
          installmentAmount: decimal(wire.installmentAmount),
          totalInstallments: wire.totalInstallments ?? null,
          totalInstallmentsPaid: wire.totalInstallmentsPaid ?? null,
          prevInstallmentDate: wire.prevInstallmentDate ?? null,
          nextInstallmentDate: wire.nextInstallmentDate ?? null,
        }
      : null,
  };
}

export function toStats(wire: WireStats): DailyStats[] {
  return (wire.stats ?? []).map((s) => ({
    date: s.date.slice(0, 10),
    views: s.views ?? 0,
    leads: s.leads ?? 0,
  }));
}

export function toSettings(wire: WireAccountSettings): AfternicAccountSettings {
  return {
    landingPage: wire.landingPage ?? null,
    intakeStyle: wire.intakeStyle ?? null,
    leasingEnabled: wire.leasingEnabled ?? null,
    maxLeasePeriod: wire.maxLeasePeriod ?? null,
    showLanderBuynowOption: wire.showLanderBuynowOption ?? null,
    showLanderMakeOfferOption: wire.showLanderMakeOfferOption ?? null,
    showLanderLeaseToOwnOption: wire.showLanderLeaseToOwnOption ?? null,
    selfBrokerEnabled: wire.selfBrokerEnabled ?? null,
  };
}

/** Whole dollars → microunits for a query filter. */
export function priceFilter(dollars: number | undefined): string | undefined {
  return dollars == null ? undefined : String(dollarsToMicro(dollars));
}
