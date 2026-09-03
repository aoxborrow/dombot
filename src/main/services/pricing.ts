import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { RegistrarName } from '@aoxborrow/registrar-client';
import { getBaseRenewal } from './base-pricing';
import type { RenewalPricing } from '../../shared/ipc';

// Renewal-price resolver backing the Renewals dashboard and the Domains renewal
// column. Prices come from three layers, most-accurate first:
//
//   1. manual override — a price the user typed in (kept in pricing-overrides).
//   2. per-name API quote — only for registrars that price a *specific* domain,
//      so the figure captures premium renewals. Gandi (its per-name price
//      endpoint) and Dynadot (its classic renew price-check quote) qualify; the
//      rest either can't price an owned domain at all (Cloudflare/GoDaddy-renewal/
//      Spaceship/NameBright/Namecheap) or only expose a generic per-TLD rate,
//      which we don't use here. (Porkbun *can* price per-name via checkDomain,
//      but its aggressive rate limit made that impractical, so it takes the base
//      rate too.) This quote is fetched as part of the domain Sync and stored
//      with the domain's detail — see registrars.ts; it isn't fetched here.
//   3. base database — the standard per-TLD rate that fills everything else
//      (see base-pricing.ts). This is a local lookup, so the vast majority of
//      domains resolve with no network call at all.
//
// All prices are treated as USD. This module is deliberately pure: it reads the
// bundled base rates and the manual overrides and assembles a RenewalPricing —
// it never touches the network or a registrar client (that lives in the sync).

// Registrars whose `getPricing(domain)` returns a genuine per-name renewal for a
// domain you already own, premium included (verified live). Only these get an
// API lookup, and only for TLDs that can actually carry premium names (see
// NO_PREMIUM_TLDS). Porkbun qualifies technically, but its aggressive rate limit
// made per-name lookups impractical, so it's intentionally left out and falls
// back to the base rate.
const SPECIFIC_CAPABLE = new Set<RegistrarName>(['gandi', 'dynadot']);

// TLDs whose registry runs no premium program, so every name renews at one
// uniform rate — the base per-TLD price is already exact and a per-name quote
// can't improve on it. These are the legacy gTLDs; extend as more flat-priced
// TLDs are confirmed. (Within any TLD *not* listed here, individual names may be
// premium, so we still need a per-name quote to be sure.)
const NO_PREMIUM_TLDS = new Set<string>(['com', 'net', 'org', 'info', 'biz']);

/**
 * Whether a per-name API quote is worth fetching for this registrar + TLD: the
 * registrar must price owned domains specifically, and the TLD must be able to
 * carry premium names in the first place. Used by the sync to decide which
 * domains get a live quote; every other domain resolves from the base database.
 */
export function usesPerNameQuote(registrar: RegistrarName, tld: string): boolean {
  return (
    SPECIFIC_CAPABLE.has(registrar) && !NO_PREMIUM_TLDS.has(tld.toLowerCase())
  );
}

/** A per-name renewal quote fetched during Sync and stored with the detail. */
export interface RenewalQuote {
  renewal: number | null;
  currency: string;
}

let overrides: Record<string, number> | null = null;

function overridesFile(): string {
  return path.join(app.getPath('userData'), 'pricing-overrides.json');
}

function loadOverrides(): Record<string, number> {
  if (overrides) return overrides;
  try {
    overrides = JSON.parse(fs.readFileSync(overridesFile(), 'utf8')) as Record<
      string,
      number
    >;
  } catch {
    overrides = {};
  }
  return overrides;
}

function persistOverrides(store: Record<string, number>): void {
  overrides = store;
  try {
    fs.writeFileSync(overridesFile(), JSON.stringify(store), 'utf8');
  } catch {
    // Non-fatal — the override just won't survive a restart.
  }
}

/** Everything after the first dot, lowercased. "example.co.uk" → "co.uk". */
export function tldOf(domain: string): string {
  const dot = domain.indexOf('.');
  return dot === -1 ? '' : domain.slice(dot + 1).toLowerCase();
}

/**
 * Assemble a domain's renewal price with provenance from local data only:
 * manual override wins; then the per-name quote captured at Sync (premium-
 * accurate); then the base per-TLD database; otherwise unavailable. Never hits
 * the network — pass the stored `quote` when one was synced for this domain.
 */
export function resolvePricing(
  registrar: RegistrarName,
  domain: string,
  quote?: RenewalQuote,
): RenewalPricing {
  const manual = loadOverrides()[`${registrar}:${domain}`];
  if (typeof manual === 'number') {
    return { domain, registrar, renewal: manual, currency: 'USD', source: 'manual' };
  }

  if (quote && quote.renewal !== null) {
    return {
      domain,
      registrar,
      renewal: quote.renewal,
      currency: quote.currency,
      source: 'api',
    };
  }

  const base = getBaseRenewal(registrar, tldOf(domain));
  if (base !== null) {
    return { domain, registrar, renewal: base, currency: 'USD', source: 'base' };
  }

  return { domain, registrar, renewal: null, currency: 'USD', source: 'unavailable' };
}

/** Sets (number) or clears (null) a manual annual renewal price for a domain. */
export function setManualPrice(
  registrar: RegistrarName,
  domain: string,
  price: number | null,
): void {
  const store = { ...loadOverrides() };
  const key = `${registrar}:${domain}`;
  if (price === null || Number.isNaN(price)) {
    delete store[key];
  } else {
    store[key] = price;
  }
  persistOverrides(store);
}
