/**
 * One spelling of a domain name. User input, CSV cells, and registrar
 * responses all pass through `toAscii` before a name is used as a stored key,
 * so `  HTTPS://Münich.DE./ ` and `xn--mnich-kva.de` land on the same record.
 * The ASCII (punycode) form is canonical; `toUnicode` is for display only.
 */

// The userland package, imported by file: a bare `from 'punycode'` resolves
// to Node's deprecated built-in module instead.
import punycode from 'punycode/punycode.js';

/** Trim, lowercase, and strip a protocol, trailing slash, and outer dots. */
export function normalizeDomain(domain: string | null | undefined): string {
  if (!domain) return '';
  return String(domain)
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/\/+$/, '')
    .replace(/^\.+|\.+$/g, '')
    .trim();
}

/** Normalized ASCII (punycode) form: the key for anything stored by name. */
export function toAscii(domain: string | null | undefined): string {
  const normalized = normalizeDomain(domain);
  try {
    return punycode.toASCII(normalized);
  } catch {
    // Overflow on absurd input; validation rejects what comes back.
    return normalized;
  }
}

/** Normalized Unicode form, for display. */
export function toUnicode(domain: string | null | undefined): string {
  const normalized = normalizeDomain(domain);
  try {
    return punycode.toUnicode(normalized);
  } catch {
    return normalized;
  }
}

/** True for an internationalized name, in either spelling. */
export function isIdn(domain: string): boolean {
  return toAscii(domain) !== toUnicode(domain);
}

const LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

/** True when `key` (already `toAscii`) has the shape of a registrable name. */
export function isDomainKey(key: string): boolean {
  if (key.length > 253) return false;
  const labels = key.split('.');
  return labels.length >= 2 && labels.every((label) => LABEL.test(label));
}

/** The canonical key for `domain`, or throws when it isn't a domain name. */
export function assertDomainName(domain: string): string {
  const key = toAscii(domain);
  if (!isDomainKey(key)) {
    throw new Error(`“${domain.trim() || 'row'}” is not a domain name.`);
  }
  return key;
}
