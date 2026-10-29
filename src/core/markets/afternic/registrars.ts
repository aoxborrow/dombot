import type { RegistrarName } from '@aoxborrow/registrar-client';

// Afternic's `registrar` is free text, not the enum the spec suggests: the
// same registrar shows up as "Dynadot Inc" and "Dynadot, LLC", GoDaddy as
// both "GODADDY" and "GoDaddy.com, LLC", and unknown ones as "UNKNOWN" or
// "Unknown .DE registrar". Match on a squashed form so punctuation and
// corporate suffixes don't matter.

const PATTERNS: [RegExp, RegistrarName][] = [
  [/godaddy|wildwestdomains/, 'godaddy'],
  [/dynadot/, 'dynadot'],
  [/namecheap/, 'namecheap'],
  [/spaceship/, 'spaceship'],
  [/porkbun/, 'porkbun'],
  [/namesilo/, 'namesilo'],
  [/gandi/, 'gandi'],
  [/cloudflare/, 'cloudflare'],
  [/namebright|turncommerce/, 'namebright'],
  [/101domain/, '101domain'],
  [/namecom/, 'namecom'],
];

/** The registrar-client name for Afternic's registrar text, or null. */
export function registrarFromAfternic(
  raw: string | null | undefined,
): RegistrarName | null {
  if (!raw) return null;
  const squashed = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!squashed || squashed.startsWith('unknown')) return null;
  for (const [pattern, name] of PATTERNS) {
    if (pattern.test(squashed)) return name;
  }
  return null;
}
