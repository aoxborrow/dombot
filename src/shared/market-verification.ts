import { normalizeNameserver } from './domain-name';
import type { RegistrarName } from './ipc';
import {
  defaultMarketNameservers,
  type MarketId,
  type MarketInfo,
} from './markets';

// Ownership verification (docs/markets.md, "Ownership verification"): the
// value each market gives an account to prove it owns a name, read out of
// whatever the user pastes, and what DomBot sets with it: the TXT record
// (Ownership verification TXT…) and the market's nameservers (a preset in
// the nameserver editor). Pure: Settings shows it, main applies it.

interface VerificationInfo {
  /** What the market calls the value. */
  term: string;
  /** The page that shows it. */
  url: string;
  /** Where the market shows it: its menu path, as the market names it. */
  path: string;
  /** The ID in the pasted value, or null when it isn't one. */
  parse: (value: string) => string | null;
  /** The TXT record's value for an ID. */
  txt: (id: string) => string;
  /** A nameserver assigned to the account, set with the market's pair. */
  nameserver?: (id: string) => string;
}

const HEX40 = /^[0-9a-f]{40}$/i;

const VERIFICATION: Record<MarketId, VerificationInfo> = {
  afternic: {
    term: 'Domain Ownership Record',
    url: 'https://www.afternic.com/account/ownership',
    path: 'Ownership Settings → Domain Ownership Record',
    parse: (value) =>
      /^afternic-verification-([a-z0-9]+)$/i.exec(value)?.[1] ??
      /^verification-([a-z0-9]+)\.ns101\.verify\.hn$/i.exec(value)?.[1] ??
      null,
    // The TXT keeps the ID as Afternic shows it (TXT values are
    // case-sensitive); the NS3 is a hostname, so it's lowercase.
    txt: (id) => `afternic-verification-${id}`,
    nameserver: (id) =>
      normalizeNameserver(`verification-${id}.ns101.verify.hn`),
  },
  atom: {
    term: 'TXT Code',
    url: 'https://www.atom.com/dashboard/account/details',
    path: 'Account Details → TXT Code',
    parse: (value) => (HEX40.test(value) ? value.toLowerCase() : null),
    txt: (id) => id,
  },
  sedo: {
    term: 'Domain Ownership Verification ID',
    url: 'https://sedo.com/member/ownership_verification.php',
    path: 'My Domains → Domain Ownership Verification',
    parse: (value) => (HEX40.test(value) ? value.toLowerCase() : null),
    txt: (id) => id,
  },
};

/** What a market calls its value, where it is, and the page that shows it. */
export function verificationHelp(market: MarketId): {
  term: string;
  url: string;
  path: string;
} {
  const { term, url, path } = VERIFICATION[market];
  return { term, url, path };
}

/**
 * The ID in a pasted value, or null for a blank one (which clears it).
 * Throws, with what to do, when it isn't one.
 */
export function parseVerificationId(
  market: MarketId,
  pasted: string,
  marketName: string = market,
): string | null {
  const value = pasted
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()
    .replace(/\.$/, '');
  if (!value) return null;
  const info = VERIFICATION[market];
  if (/…|\.\.\.$/.test(value)) {
    throw new Error(
      `That’s cut short. Use the copy button beside your ${info.term} on ${marketName}.`,
    );
  }
  const id = info.parse(value);
  if (!id) {
    throw new Error(
      `That isn’t ${marketName}’s ${info.term}. Copy it from ${info.url}.`,
    );
  }
  return id;
}

/** The TXT record's value for an account's ID. */
export function verificationTxt(market: MarketId, id: string): string {
  return VERIFICATION[market].txt(id);
}

/** The nameserver assigned to an account (Afternic's NS3), if any. */
export function verificationNameserver(
  market: MarketId,
  id: string | null,
): string | null {
  const ns = VERIFICATION[market].nameserver;
  return ns && id ? ns(id) : null;
}

/**
 * The nameservers Apply points a name at: the market's pair, plus the
 * account's own nameserver where the market has one and the ID is saved.
 */
export function verificationNameservers(
  info: Pick<MarketInfo, 'id' | 'nameservers'>,
  id: string | null,
): string[] {
  const own = verificationNameserver(info.id, id);
  return [...defaultMarketNameservers(info), ...(own ? [own] : [])];
}

/**
 * The registrable domains of the nameservers each registrar hosts DNS on (its
 * defaults, parking and premium DNS). A TXT record written at the registrar
 * only takes effect while the name uses one of them.
 */
const REGISTRAR_DNS: Record<RegistrarName, readonly string[]> = {
  '101domain': ['101domain.com'],
  cloudflare: ['ns.cloudflare.com'],
  dynadot: ['dynadot.com', 'dyna-ns.net'],
  gandi: ['gandi.net'],
  godaddy: ['domaincontrol.com'],
  namebright: ['namebrightdns.com'],
  namecheap: ['registrar-servers.com'],
  namecom: ['name.com'],
  namesilo: ['dnsowl.com'],
  porkbun: ['porkbun.com'],
  spaceship: ['spaceship.net'],
};

/**
 * Whether a name with these nameservers has its DNS at `registrar`: every
 * nameserver is one of the registrar's. Unknown (empty) counts as yes, so
 * the registrar's own answer decides.
 */
export function registrarHostsDns(
  registrar: RegistrarName,
  nameservers: readonly string[],
): boolean {
  const own = REGISTRAR_DNS[registrar];
  if (!own || nameservers.length === 0) return true;
  return nameservers.every((ns) => {
    const host = normalizeNameserver(ns);
    return own.some((d) => host === d || host.endsWith(`.${d}`));
  });
}
