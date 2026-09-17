import { isUniformTld } from '../../shared/tlds';
import { normalizeTld, tldOf } from './pricing';

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What to fetch from GoDaddy after we know which names are premium. */
export interface GoDaddyRenewalPlan {
  /** One TLD to price (dummy available name first; owned name is fallback). */
  tldSamples: { tld: string; domain: string }[];
  /** Premium names that need their own quote. */
  premiums: string[];
}

/**
 * A random, non-word label so the availability check is for a likely-available
 * standard name. Taken/owned names often come back with no prices at all.
 */
export function dummyNameForTld(tld: string): string {
  return `db${randomHex(6)}.${normalizeTld(tld)}`;
}

/**
 * The renewal figure for a v3 availability quote.
 *
 * GoDaddy documents `renewalPrice` as "absent when unavailable or identical to
 * `price`", so a term that carries a price but no renewal is telling us renew
 * equals register — take it. A discounted first year always reports a distinct
 * `renewalPrice`, so promo pricing never reaches that fallback. A term with no
 * prices at all (the usual answer for a name that is already registered) stays
 * null and lets the base rate fill in.
 */
export function renewalFromGodaddyPricing(pricing: {
  renewal?: number | null;
  registration?: number | null;
}): number | null {
  if (typeof pricing.renewal === 'number') return pricing.renewal;
  return typeof pricing.registration === 'number' ? pricing.registration : null;
}

/**
 * Traditional TLDs: one sample, never per-name. Other TLDs: one sample from a
 * non-premium name (or any name if the flag is unknown), plus every name the
 * availability check marked premium.
 */
export function planGoDaddyRenewalFetches(
  domains: { domainName: string }[],
  premiumByDomain: Map<string, boolean | undefined>,
): GoDaddyRenewalPlan {
  const byTld = new Map<string, string[]>();
  for (const d of domains) {
    const tld = tldOf(d.domainName);
    if (!tld) continue;
    const list = byTld.get(tld);
    if (list) list.push(d.domainName);
    else byTld.set(tld, [d.domainName]);
  }

  const tldSamples: { tld: string; domain: string }[] = [];
  const premiums: string[] = [];

  for (const [tld, names] of byTld) {
    if (isUniformTld(tld)) {
      tldSamples.push({ tld, domain: names[0] });
      continue;
    }
    const flagged: string[] = [];
    const standard: string[] = [];
    for (const name of names) {
      if (premiumByDomain.get(name.toLowerCase()) === true) flagged.push(name);
      else standard.push(name);
    }
    premiums.push(...flagged);
    const sample = standard[0] ?? names[0];
    if (sample && !flagged.includes(sample)) {
      tldSamples.push({ tld, domain: sample });
    }
  }

  return { tldSamples, premiums };
}

/** TLDs that can carry premium names — we ask availability for the flag. */
export function tldsNeedingPremiumFlags(
  domains: { domainName: string }[],
): string[] {
  const tlds = new Set<string>();
  for (const d of domains) {
    const tld = tldOf(d.domainName);
    if (tld && !isUniformTld(tld)) tlds.add(tld);
  }
  return [...tlds];
}
