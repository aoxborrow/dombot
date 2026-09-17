import type { RegistrarName } from '@aoxborrow/registrar-client';
import { getBaseRenewal } from './base-pricing';
import { Namespace } from '../storage/namespace';
import { isUniformTld } from '../../shared/tlds';
import type { RenewalPricing } from '../../shared/ipc';

// Renewal-price resolver backing the Renewals dashboard and the Domains renewal
// column. Prices come from four layers, most-accurate first:
//
//   1. manual override — a price the user typed in (kept in pricing-overrides).
//   2. per-name API quote — only for registrars that price a *specific* domain,
//      so the figure captures premium renewals. Gandi (its per-name price
//      endpoint), Dynadot (its classic renew price-check quote), and GoDaddy
//      premium names (v3 availability renewalPrice) qualify. The rest either
//      can't price an owned domain at all (Cloudflare/Spaceship/NameBright/
//      Namecheap) or only expose a generic per-TLD rate, which we don't use
//      here. (Porkbun *can* price per-name via checkDomain, but its aggressive
//      rate limit made that impractical, so it takes the base rate too.) This
//      quote is fetched as part of the domain Sync and stored with the
//      domain's detail — see registrars.ts; it isn't fetched here.
//   3. TLD rate — the account's own price for a TLD (kept in tld-rates).
//      GoDaddy Sync fills this from one v3 availability quote per TLD, which
//      is priced for the authenticated shopper, so it carries whatever
//      discount the account holds (a Discount Domain Club membership, say)
//      and the published list price otherwise. Applies to every name at that
//      account/TLD that did not already resolve via (1) or (2).
//   4. base database — the standard per-TLD rate that fills everything else
//      (see base-pricing.ts). This is a local lookup, so the vast majority of
//      domains resolve with no network call at all.
//
// All prices are treated as USD. This module is deliberately pure: it reads the
// bundled base rates, TLD rates, and manual overrides and assembles a
// RenewalPricing — it never touches the network or a registrar client (that
// lives in the sync).

// Registrars whose `getPricing(domain)` returns a genuine per-name renewal for a
// domain you already own, premium included (verified live). Only these get an
// API lookup, and only for TLDs that can actually carry premium names (see
// NO_PREMIUM_TLDS). Porkbun qualifies technically, but its aggressive rate limit
// made per-name lookups impractical, so it's intentionally left out and falls
// back to the base rate.
const SPECIFIC_CAPABLE = new Set<RegistrarName>(['gandi', 'dynadot']);

// Name.com has no bundled base-rate table. Quote every owned domain, including
// legacy extensions, once the released library adds this provider.
const ALWAYS_QUOTE = new Set<string>(['namecom']);

/**
 * Whether a per-name API quote is worth fetching for this registrar + TLD: the
 * registrar must price owned domains specifically, and the TLD must be able to
 * carry premium names in the first place. Used by the sync to decide which
 * domains get a live quote; every other domain resolves from the base database.
 */
export function usesPerNameQuote(
  registrar: RegistrarName,
  tld: string,
): boolean {
  return (
    ALWAYS_QUOTE.has(registrar) ||
    (SPECIFIC_CAPABLE.has(registrar) && !isUniformTld(tld))
  );
}

/** A per-name renewal quote fetched during Sync and stored with the detail. */
export interface RenewalQuote {
  renewal: number | null;
  currency: string;
}

// Manual per-domain renewal overrides, keyed `${accountId ?? registrar}:${domain}` (USD).
const overrides = new Namespace<number>('pricing-overrides');

// Shopper annual renewal (USD) per account + TLD, keyed `${accountId ?? registrar}:${tld}`.
const tldRates = new Namespace<number>('tld-rates');

/** Everything after the first dot, lowercased. "example.co.uk" → "co.uk". */
export function tldOf(domain: string): string {
  const dot = domain.indexOf('.');
  return dot === -1 ? '' : domain.slice(dot + 1).toLowerCase();
}

/** Strip a leading dot and lowercase. ".COM" → "com". */
export function normalizeTld(raw: string): string {
  return raw.trim().replace(/^\.+/, '').toLowerCase();
}

/**
 * Assemble a domain's renewal price with provenance from local data only:
 * manual override wins; then the per-name quote captured at Sync (premium-
 * accurate); then a shopper TLD rate; then the base per-TLD database; otherwise
 * unavailable. Never hits the network — pass the stored `quote` when one was
 * synced for this domain.
 */
export function resolvePricing(
  registrar: RegistrarName,
  domain: string,
  quote?: RenewalQuote,
  accountId?: string,
): RenewalPricing {
  const manual = overrides.get(`${accountId ?? registrar}:${domain}`);
  if (typeof manual === 'number') {
    return {
      domain,
      registrar,
      renewal: manual,
      currency: 'USD',
      source: 'manual',
    };
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

  const tld = tldOf(domain);
  const custom =
    tldRates.get(`${accountId ?? registrar}:${tld}`) ??
    tldRates.get(`${registrar}:${tld}`);
  if (typeof custom === 'number') {
    return {
      domain,
      registrar,
      renewal: custom,
      currency: 'USD',
      source: 'tld',
    };
  }

  const base = getBaseRenewal(registrar, tld);
  if (base !== null) {
    return {
      domain,
      registrar,
      renewal: base,
      currency: 'USD',
      source: 'base',
    };
  }

  return {
    domain,
    registrar,
    renewal: null,
    currency: 'USD',
    source: 'unavailable',
  };
}

/** Sets (number) or clears (null) a manual annual renewal price for a domain. */
export function setManualPrice(
  registrar: RegistrarName,
  domain: string,
  price: number | null,
  accountId?: string,
): void {
  const key = `${accountId ?? registrar}:${domain}`;
  if (price === null || Number.isNaN(price)) {
    void overrides.delete(key);
  } else {
    void overrides.set(key, price);
  }
}

/** Sets (number) or clears (null) a shopper annual renewal rate for a registrar + TLD. */
export function setTldRate(
  registrar: RegistrarName,
  tld: string,
  price: number | null,
  accountId?: string,
): void {
  const key = `${accountId ?? registrar}:${normalizeTld(tld)}`;
  if (price === null || Number.isNaN(price)) {
    void tldRates.delete(key);
  } else {
    void tldRates.set(key, price);
  }
}
