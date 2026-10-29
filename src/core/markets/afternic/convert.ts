import { registrarFromAfternic } from './registrars';
import type {
  AccountSettingsInput,
  AfternicAccountSettings,
  AfternicJob,
  AfternicListing,
  AfternicSale,
  DailyStats,
  ListingFields,
  ListingResult,
  SearchCounts,
} from './types';
import {
  dollarsToMicro,
  microToDecimal,
  microToDollars,
  type WireAccountSettings,
  type WireDomain,
  type WireDomainFields,
  type WireJob,
  type WireOperationsMap,
  type WireSale,
  type WireSearchCounts,
  type WireStats,
} from './wire';

// Wire shapes ↔ client types. Reading, missing fields become null rather than
// a default, so callers can tell "Afternic didn't say" from "false" or "0".
// Writing, only the fields the caller set are sent, so an update leaves the
// rest alone.

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

export function toJob(wire: WireJob): AfternicJob {
  return {
    jobId: wire.jobId,
    type: wire.type ?? 'BULK_JOB',
    state: wire.jobState ?? 'CREATED',
    description: wire.description ?? null,
    percentComplete: wire.percentComplete ?? null,
    totalRequests: wire.totalRequests ?? null,
    totalSuccess: wire.totalSuccess ?? null,
    totalFailures: wire.totalFailures ?? null,
    failedReason: wire.failedReason ?? null,
    createdAt: wire.createdAt ?? '',
    completedAt: wire.completedAt ?? null,
  };
}

// Writes

/** The API's ceiling on any price: $49,999,999. */
const MAX_PRICE = 49_999_999;
const MIN_OFFER = 20;

function price(dollars: number, label: string): number {
  if (dollars > MAX_PRICE) {
    throw new Error(
      `${label} can't be over $${MAX_PRICE.toLocaleString('en-US')}.`,
    );
  }
  try {
    return dollarsToMicro(dollars);
  } catch {
    throw new Error(`${label} must be a whole number of dollars: ${dollars}`);
  }
}

/**
 * Afternic's rule, checked live: minimum offer ≤ floor ≤ Buy Now, equal
 * allowed. Afternic checks it against the whole saved listing; this can only
 * check the prices given together, so a change of one price can still be
 * refused by Afternic.
 */
function checkPriceOrder(fields: ListingFields): void {
  const buyNow = fields.buyNow || null;
  const floor = fields.floor || null;
  const minOffer = fields.minOffer || null;
  if (floor != null && buyNow != null && floor > buyNow) {
    throw new Error('The floor price is above the Buy Now price.');
  }
  if (minOffer != null && floor != null && minOffer > floor) {
    throw new Error('The minimum offer is above the floor price.');
  }
  if (minOffer != null && buyNow != null && minOffer > buyNow) {
    throw new Error('The minimum offer is above the Buy Now price.');
  }
}

/**
 * The fields to send for a create, update or upsert. Checks the rules the API
 * would otherwise reject one name at a time.
 */
export function toWireFields(fields: ListingFields): WireDomainFields {
  const wire: WireDomainFields = {};
  if (fields.displayName !== undefined) wire.displayName = fields.displayName;
  if (fields.buyNow !== undefined) {
    wire.buynowPrice =
      fields.buyNow === null ? 0 : price(fields.buyNow, 'Buy Now price');
  }
  if (fields.floor !== undefined) {
    wire.floorPrice =
      fields.floor === null ? 0 : price(fields.floor, 'Floor price');
  }
  if (fields.minOffer !== undefined) {
    if (fields.minOffer < MIN_OFFER) {
      throw new Error(`Minimum offer must be at least $${MIN_OFFER}.`);
    }
    wire.minbidPrice = price(fields.minOffer, 'Minimum offer');
  }
  checkPriceOrder(fields);
  if (fields.maxLeasePeriod !== undefined) {
    const n = fields.maxLeasePeriod;
    if (!Number.isInteger(n) || n < 2 || n > 60) {
      throw new Error(`Lease-to-own payments must be 2–60, not ${n}.`);
    }
    wire.maxLeasePeriod = n;
  }
  for (const key of [
    'leasingEnabled',
    'landingPage',
    'intakeStyle',
    'showLanderBuynowOption',
    'showLanderMakeOfferOption',
    'showLanderLeaseToOwnOption',
    'featured',
    'hidden',
  ] as const) {
    if (fields[key] !== undefined) {
      (wire as Record<string, unknown>)[key] = fields[key];
    }
  }
  return wire;
}

export function toWireSettings(
  settings: AccountSettingsInput,
): WireAccountSettings {
  if (settings.maxLeasePeriod !== undefined) {
    const n = settings.maxLeasePeriod;
    if (!Number.isInteger(n) || n < 2 || n > 60) {
      throw new Error(`Lease-to-own payments must be 2–60, not ${n}.`);
    }
  }
  return Object.fromEntries(
    Object.entries(settings).filter(([, v]) => v !== undefined),
  ) as WireAccountSettings;
}

/**
 * One result per requested name, in request order. A name Afternic left out
 * of its answer is reported as a failure rather than dropped.
 */
export function toResults(
  names: readonly string[],
  map: WireOperationsMap | null,
): ListingResult[] {
  return names.map((name) => {
    const entry = map?.[name];
    if (!entry) {
      return {
        name,
        ok: false,
        status: 0,
        listing: null,
        error: {
          code: 'NO_RESULT',
          message: 'Afternic returned no result for this name.',
        },
      };
    }
    const ok = entry.code >= 200 && entry.code < 300;
    return {
      name,
      ok,
      status: entry.code,
      listing: entry.domain ? toListing(entry.domain) : null,
      error: ok
        ? null
        : {
            code: entry.error?.code ?? `HTTP_${entry.code}`,
            message: entry.error?.message ?? `HTTP ${entry.code}`,
          },
    };
  });
}
