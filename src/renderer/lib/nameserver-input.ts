// Pure helpers behind the nameservers editor: parsing/validating the pasted
// text, and deriving the preset list from the portfolio. No React, no IPC.

import { nameserverGroup } from './nameservers';

/** Registries cap the delegation at 13 nameservers. */
export const MAX_NAMESERVERS = 13;

/**
 * A syntactically valid hostname: two or more labels of letters/digits/
 * hyphens (no leading/trailing hyphen, ≤63 chars each), a TLD that starts
 * with a letter, ≤253 chars overall. Lowercase input expected.
 */
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export interface NameserverInput {
  /** The cleaned, deduped set in input order. */
  nameservers: string[];
  /** Blocking problems — Save stays disabled while any exist. */
  errors: string[];
  /** Advisory notes (a single nameserver, dropped duplicates). */
  warnings: string[];
}

/** Trim, lowercase, and strip a trailing dot from one host. */
export function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Parses editor text — one host per line (commas and whitespace also
 * separate) — into a validated nameserver set.
 */
export function validateNameservers(text: string): NameserverInput {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const nameservers: string[] = [];

  for (const raw of text.split(/[\s,]+/)) {
    const host = normalizeHost(raw);
    if (!host) continue;
    if (!HOSTNAME.test(host)) {
      errors.push(`Not a valid hostname: ${host}`);
      continue;
    }
    if (seen.has(host)) {
      warnings.push(`Duplicate removed: ${host}`);
      continue;
    }
    seen.add(host);
    nameservers.push(host);
  }

  if (nameservers.length === 0 && errors.length === 0) {
    errors.push('Enter at least one nameserver.');
  } else if (nameservers.length === 1) {
    warnings.push('Most registries require at least two nameservers.');
  } else if (nameservers.length > MAX_NAMESERVERS) {
    errors.push(`At most ${MAX_NAMESERVERS} nameservers.`);
  }

  return { nameservers, errors, warnings };
}

/** Order-insensitive identity of a set, for dedupe and "unchanged" checks. */
export function nameserverSetKey(nameservers: string[]): string {
  return nameservers.map(normalizeHost).filter(Boolean).sort().join('\n');
}

export function sameNameservers(a: string[], b: string[]): boolean {
  return nameserverSetKey(a) === nameserverSetKey(b);
}

export interface NameserverPreset {
  key: string;
  /** e.g. "cloudflare.com · 120 domains" or "Recent · dyna-ns.net". */
  label: string;
  nameservers: string[];
}

/** Label for a set: its first host's provider group, or the host itself. */
function providerLabel(nameservers: string[]): string {
  const first = nameservers[0] ?? '';
  return nameserverGroup(first)?.label ?? first;
}

/**
 * The preset list for the editor: the user's most recently saved sets first,
 * then the most common distinct sets across the portfolio (up to `max`). Sets
 * that appear in both are listed once, under Recent.
 */
export function nameserverPresets(
  domains: readonly { nameservers: string[] }[],
  recent: readonly string[][],
  max = 8,
): NameserverPreset[] {
  const out: NameserverPreset[] = [];
  const used = new Set<string>();

  for (const set of recent) {
    const normalized = set.map(normalizeHost).filter(Boolean);
    const key = nameserverSetKey(normalized);
    if (!key || used.has(key)) continue;
    used.add(key);
    out.push({
      key: `recent:${key}`,
      label: `Recent · ${providerLabel(normalized)}`,
      nameservers: normalized,
    });
  }

  const counts = new Map<string, { nameservers: string[]; count: number }>();
  for (const d of domains) {
    const normalized = d.nameservers.map(normalizeHost).filter(Boolean);
    const key = nameserverSetKey(normalized);
    if (!key) continue;
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { nameservers: normalized, count: 1 });
  }
  const common = [...counts.entries()]
    .filter(([key]) => !used.has(key))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, max);
  for (const [key, { nameservers, count }] of common) {
    out.push({
      key: `portfolio:${key}`,
      label: `${providerLabel(nameservers)} · ${count} domain${count === 1 ? '' : 's'}`,
      nameservers,
    });
  }
  return out;
}
