// Pure validation for the URL- and email-forwarding editors, plus the
// `{domain}` template expansion the bulk dialog uses. No React, no IPC.

import type { EmailForward, UrlForwardInput } from '../../shared/ipc';
import { expandTemplate } from '../../shared/domain-ops';

export { expandTemplate };

/** A DNS label sequence relative to the apex ("www", "shop.eu"), or "@". */
const HOST =
  /^(?:@|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/;

/** The local part of an address ("hello", "first.last"), or a catch-all. */
const ALIAS = /^(?:@|\*|[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64})$/i;

/** Good-enough email syntax: something@host.tld. */
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export interface ForwardValidation {
  /** Blocking problems — Save stays disabled while any exist. */
  errors: string[];
  /** Advisory notes. */
  warnings: string[];
}

/** Lowercases and trims a host; an empty host means the apex. */
export function normalizeHost(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  return h === '' ? '@' : h;
}

/** Normalizes a URL rule's fields for comparison and submission. */
export function normalizeUrlForward(f: UrlForwardInput): UrlForwardInput {
  return { host: normalizeHost(f.host), url: f.url.trim(), type: f.type };
}

/** Normalizes an email rule's fields for comparison and submission. */
export function normalizeEmailForward(f: EmailForward): EmailForward {
  return {
    alias: f.alias.trim().toLowerCase(),
    forwardTo: f.forwardTo.trim(),
  };
}

/** True when `url` parses as an absolute http(s) URL (or a `{domain}` template
 *  that does once expanded). */
function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(expandTemplate(url, 'example.com'));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates a URL forwarding rule set. `registrar` adds the provider's own
 * constraints (Gandi can't forward the apex; NameSilo supports a single apex
 * rule). `allowTemplate` permits `{domain}` in URLs (bulk mode).
 */
export function validateUrlForwards(
  rows: readonly UrlForwardInput[],
  registrar?: string,
): ForwardValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const hosts = new Set<string>();

  rows.forEach((raw, i) => {
    const f = normalizeUrlForward(raw);
    const where = `Rule ${i + 1}`;
    if (!HOST.test(f.host))
      errors.push(`${where}: “${f.host}” isn’t a valid host.`);
    if (!f.url) errors.push(`${where}: enter a destination URL.`);
    else if (!isHttpUrl(f.url))
      errors.push(`${where}: the destination must be an http(s) URL.`);
    if (hosts.has(f.host))
      errors.push(`${where}: “${f.host}” is listed twice.`);
    hosts.add(f.host);
    if (registrar === 'gandi' && f.host === '@') {
      errors.push(
        `${where}: Gandi can’t forward the apex (“@”) — use “www” or another subdomain.`,
      );
    }
    if (registrar === 'namesilo' && f.host !== '@') {
      errors.push(
        `${where}: NameSilo only supports a single apex (“@”) forward.`,
      );
    }
  });

  if (registrar === 'namesilo' && rows.length > 1) {
    errors.push('NameSilo supports one forwarding rule per domain.');
  }
  if (rows.length === 0) {
    warnings.push('Saving with no rules removes all URL forwarding.');
  }
  return { errors, warnings };
}

/**
 * Validates an email forwarding rule set. A repeated alias is an error except
 * at NameSilo, which fans one alias out to up to five destinations.
 */
export function validateEmailForwards(
  rows: readonly EmailForward[],
  registrar?: string,
): ForwardValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const perAlias = new Map<string, number>();

  rows.forEach((raw, i) => {
    const f = normalizeEmailForward(raw);
    const where = `Rule ${i + 1}`;
    if (!f.alias) errors.push(`${where}: enter an alias (the part before @).`);
    else if (!ALIAS.test(f.alias))
      errors.push(`${where}: “${f.alias}” isn’t a valid alias.`);
    if (!f.forwardTo) errors.push(`${where}: enter a destination address.`);
    else if (!EMAIL.test(f.forwardTo))
      errors.push(`${where}: “${f.forwardTo}” isn’t a valid email address.`);
    perAlias.set(f.alias, (perAlias.get(f.alias) ?? 0) + 1);
  });

  for (const [alias, n] of perAlias) {
    if (n < 2 || !alias) continue;
    if (registrar === 'namesilo') {
      if (n > 5)
        errors.push(`“${alias}” has ${n} destinations; NameSilo allows five.`);
    } else {
      errors.push(
        `“${alias}” is listed ${n} times; one destination per alias.`,
      );
    }
  }
  if (rows.length === 0) {
    warnings.push('Saving with no rules removes all email forwarding.');
  }
  return { errors, warnings };
}

/** Order-insensitive equality of two URL rule sets (normalized). */
export function sameUrlForwards(
  a: readonly UrlForwardInput[],
  b: readonly UrlForwardInput[],
): boolean {
  const key = (rows: readonly UrlForwardInput[]) =>
    rows
      .map(normalizeUrlForward)
      .map((f) => `${f.host}\t${f.url}\t${f.type}`)
      .sort()
      .join('\n');
  return key(a) === key(b);
}

/** Order-insensitive equality of two email rule sets (normalized). */
export function sameEmailForwards(
  a: readonly EmailForward[],
  b: readonly EmailForward[],
): boolean {
  const key = (rows: readonly EmailForward[]) =>
    rows
      .map(normalizeEmailForward)
      .map((f) => `${f.alias}\t${f.forwardTo}`)
      .sort()
      .join('\n');
  return key(a) === key(b);
}
