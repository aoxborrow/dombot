import { registrars, type RegistrarName } from '@aoxborrow/registrar-client';
import ianaData from '../../../data/iana-registrars.json';
import mappingData from '../../../data/registrar-mapping.json';

// Maps the registrar a WHOIS or RDAP lookup reports ("Name.com, Inc.", IANA ID
// 625) to the formatted name we show ("Name.com"), and to one of our built-in
// registrars when it is one. Both tables ship with the app and are refreshed by
// hand with scripts/update-registrars.mjs (issue #123):
//
// - data/iana-registrars.json: IANA's Registrar ID registry (Accredited and
//   Reserved rows).
// - data/registrar-mapping.json: our registrars, each with its IANA IDs and any
//   raw strings that have no ID (ccTLD registrars, old names). An entry whose
//   key is a registrar-client name is a built-in registrar.

export interface RegistrarMappingEntry {
  name: string;
  ianaIds: number[];
  names?: string[];
  /** Used by the update script only, never at runtime. */
  patterns?: string[];
}

export interface ResolvedRegistrar {
  /** The built-in registrar it maps to, or null for any other registrar. */
  registrar: RegistrarName | null;
  /** What to show: our formatted name, IANA's name for the ID, or the raw name. */
  label: string;
}

const mapping = mappingData as Record<string, RegistrarMappingEntry>;
const ianaNames = new Map<number, string>(
  (ianaData.registrars as [number, string, string][]).map(([id, name]) => [
    id,
    name,
  ]),
);

const LEGAL_SUFFIXES = new Set([
  'llc', 'inc', 'incorporated', 'ltd', 'limited', 'corp', 'corporation', 'co',
  'company', 'gmbh', 'ag', 'sa', 'sas', 'sarl', 'srl', 'sl', 'slu', 'spa',
  'sro', 'bv', 'nv', 'pty', 'pte', 'plc', 'kg', 'ab', 'as', 'oy', 'kk', 'lp',
  'llp',
]); // prettier-ignore

const TRADING_AS = /\b(?:d\/b\/a|dba|t\/a|o\/a|trading as|doing business as)\b/;

function normalizeOne(raw: string): string {
  const tokens = raw
    // "L.L.C.", "S.A.", "B.V." → "llc", "sa", "bv"
    .replace(/\b(?:[a-z]\.){2,}/g, (m) => m.replace(/\./g, ''))
    .replace(/&/g, ' and ')
    .split(/[\s,]+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
  // Strip trailing legal suffixes, and the "and" of "GmbH & Co. KG".
  while (
    tokens.length > 1 &&
    (LEGAL_SUFFIXES.has(tokens[tokens.length - 1]) ||
      tokens[tokens.length - 1] === 'and')
  ) {
    tokens.pop();
  }
  return tokens.join('');
}

/**
 * Comparison keys for a registrar name: the whole name, then each side of a
 * "d/b/a" / "t/a" clause. Case, accents, punctuation, `[Tag = …]` labels and
 * trailing legal suffixes don't count: "Name.com, Inc." and "NAME.COM INC"
 * are both "namecom".
 */
export function registrarNameKeys(name: string): string[] {
  const text = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ');
  const keys = [text, ...text.split(TRADING_AS)].map(normalizeOne);
  return [...new Set(keys.filter(Boolean))];
}

function isBuiltIn(key: string): key is RegistrarName {
  return Object.prototype.hasOwnProperty.call(registrars, key);
}

function labelOf(key: string): string {
  return isBuiltIn(key) ? registrars[key].displayName : mapping[key].name;
}

interface Index {
  byId: Map<number, string>;
  byName: Map<string, string>;
}

let index: Index | null = null;

/** Built once, on first use. Exported for the data checks in tests. */
export function mappingIndex(): Index {
  if (index) return index;
  const byId = new Map<number, string>();
  const byName = new Map<string, string>();
  for (const [key, entry] of Object.entries(mapping)) {
    for (const id of entry.ianaIds) byId.set(id, key);
    const names = [
      labelOf(key),
      entry.name,
      ...(entry.names ?? []),
      ...entry.ianaIds.map((id) => ianaNames.get(id) ?? ''),
    ];
    for (const name of names) {
      // Only the whole name: a d/b/a side of one registrar's legal name
      // mustn't claim a string for it.
      const whole = registrarNameKeys(name)[0];
      if (whole && !byName.has(whole)) byName.set(whole, key);
    }
  }
  index = { byId, byName };
  return index;
}

/** IANA's current name for a registrar ID, if the bundled list has it. */
export function ianaRegistrarName(id: number): string | null {
  return ianaNames.get(id) ?? null;
}

/**
 * The registrar to show for a lookup result, tried in order: a reseller we've
 * mapped (iwantmyname sells through Key-Systems' IANA ID, so only the reseller
 * field tells them apart); the IANA ID; the name, against our mapped names and the IANA names of mapped IDs; IANA's name
 * for an unmapped ID; the raw name. Null when there's neither. Works from a
 * name alone, for WHOIS results with no `Registrar IANA ID:` line (or one we
 * couldn't parse) and for ccTLDs.
 */
export function resolveRegistrar(input: {
  ianaId?: number | null;
  name?: string | null;
  /** WHOIS `Reseller:` or an RDAP `reseller` entity. Unmapped ones are ignored. */
  reseller?: string | null;
}): ResolvedRegistrar | null {
  const { byId, byName } = mappingIndex();
  const hit = (key: string): ResolvedRegistrar => ({
    registrar: isBuiltIn(key) ? key : null,
    label: labelOf(key),
  });
  const id = input.ianaId ?? null;
  const name = input.name?.trim() || null;
  const byNameKeys = (raw: string): string | undefined => {
    for (const candidate of registrarNameKeys(raw)) {
      const key = byName.get(candidate);
      if (key) return key;
    }
    return undefined;
  };
  const reseller = input.reseller?.trim()
    ? byNameKeys(input.reseller)
    : undefined;
  if (reseller) return hit(reseller);
  if (id != null) {
    const key = byId.get(id);
    if (key) return hit(key);
  }
  const named = name ? byNameKeys(name) : undefined;
  if (named) return hit(named);
  const ianaName = id != null ? ianaNames.get(id) : undefined;
  if (ianaName) return { registrar: null, label: ianaName };
  if (name) return { registrar: null, label: name };
  return null;
}
