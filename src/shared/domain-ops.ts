// Pure capability logic for domain operations, shared by main (the dispatcher's
// up-front check, the MCP tools) and the renderer (disabling controls, bucketing
// a bulk selection). No Electron, no network, no library import — the renderer
// bundle must never resolve registrar-client, so the three feature ids we gate
// on are mirrored here as strings (they match the library's `Feature` values).

import type { DomainOp, DomainOpKind, RegistrarName } from './ipc';

/** Extended features an op needs; ops absent here are core on every provider. */
const REQUIRED_FEATURE: Partial<Record<DomainOpKind, string>> = {
  authCode: 'getAuthCode',
  urlForwarding: 'setDomainForwarding',
  emailForwarding: 'setEmailForwarding',
};

/**
 * Known gaps in the *core* contract. The library lists every core feature on
 * every provider even where the method throws `NotImplementedError` (core is a
 * promise, not a capability probe), so these have to live here. Each returns a
 * human reason, or null when the op is fine. A `NotImplementedError` we didn't
 * predict is still classified `unsupported` at run time — this map is the UX
 * nicety that stops the click from happening in the first place.
 */
const KNOWN_GAPS: Partial<
  Record<RegistrarName, (op: DomainOp) => string | null>
> = {
  cloudflare: (op) =>
    op.kind === 'autoRenew' ||
    op.kind === 'lock' ||
    op.kind === 'nameservers' ||
    op.kind === 'renew'
      ? 'Cloudflare’s API has no post-registration update for this — change it in the Cloudflare dashboard.'
      : null,
  porkbun: (op) =>
    op.kind === 'lock' || op.kind === 'privacy'
      ? 'Porkbun’s API can’t change this after registration.'
      : null,
  godaddy: (op) =>
    op.kind === 'privacy' && op.enabled
      ? 'Enabling privacy at GoDaddy is a purchase the API doesn’t expose; only disabling is supported.'
      : op.kind === 'urlForwarding'
        ? 'GoDaddy forwarding needs a customer ID and legacy key the app no longer collects.'
        : null,
};

/** Short human label per op kind, for reasons and menu items. */
export const OP_LABEL: Record<DomainOpKind, string> = {
  autoRenew: 'auto-renew',
  privacy: 'WHOIS privacy',
  lock: 'transfer lock',
  nameservers: 'nameservers',
  urlForwarding: 'URL forwarding',
  emailForwarding: 'email forwarding',
  authCode: 'auth code',
  renew: 'renewal',
};

/**
 * Why `registrar` can't perform `op`, or null when it can. `features` is the
 * provider's capability list (RegistrarMeta.features). Extended-feature ops
 * are gated on the list; core ops on the known-gaps map.
 */
export function unsupportedReason(
  registrar: RegistrarName,
  features: readonly string[],
  op: DomainOp,
): string | null {
  const required = REQUIRED_FEATURE[op.kind];
  if (required && !features.includes(required)) {
    return `This registrar doesn’t offer ${OP_LABEL[op.kind]} through its API.`;
  }
  return KNOWN_GAPS[registrar]?.(op) ?? null;
}

/** Past-tense summary of a successful op, for toasts and result messages. */
export function opSummary(op: DomainOp): string {
  switch (op.kind) {
    case 'autoRenew':
      return `Auto-renew ${op.enabled ? 'enabled' : 'disabled'}`;
    case 'privacy':
      return `WHOIS privacy ${op.enabled ? 'enabled' : 'disabled'}`;
    case 'lock':
      return op.locked ? 'Locked' : 'Unlocked';
    case 'nameservers':
      return 'Nameservers updated';
    case 'urlForwarding':
      return op.forwards.length === 0
        ? 'URL forwarding cleared'
        : 'URL forwarding updated';
    case 'emailForwarding':
      return op.forwards.length === 0
        ? 'Email forwarding cleared'
        : 'Email forwarding updated';
    case 'authCode':
      return 'Auth code retrieved';
    case 'renew':
      return `Renewed for ${op.years} year${op.years === 1 ? '' : 's'}`;
  }
}

/**
 * The human sentence inside a registrar error. The library wraps HTTP failures
 * as "Request to '<url>' failed with 400 Bad Request: <body>", and the body is
 * usually JSON with the real explanation buried a level or two down. Returns
 * that explanation when it can find one, the raw body otherwise, and the
 * message unchanged when it isn't in that shape.
 */
export function friendlyError(message: string): string {
  const m = /failed with \d{3}[^:]*:\s*([\s\S]+)$/.exec(message);
  if (!m) return message;
  const body = m[1].trim();
  try {
    const parsed: unknown = JSON.parse(body);
    const found = findDescription(parsed);
    if (found) return found;
  } catch {
    // not JSON — the body is the message
  }
  return body;
}

// Depth-first search for the first descriptive string in a registrar error
// body, preferring the keys registrars use for the human explanation.
const DESCRIPTION_KEYS = ['description', 'detail', 'message', 'error'];
function findDescription(value: unknown, depth = 0): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object' || depth > 3) return null;
  const obj = value as Record<string, unknown>;
  // Nested objects first (e.g. { message: "Bad Request", error: { description } })
  // so a generic top-level status text doesn't win over the real reason.
  for (const key of DESCRIPTION_KEYS) {
    if (obj[key] && typeof obj[key] === 'object') {
      const nested = findDescription(obj[key], depth + 1);
      if (nested) return nested;
    }
  }
  for (const key of DESCRIPTION_KEYS) {
    if (typeof obj[key] === 'string' && (obj[key] as string).trim())
      return (obj[key] as string).trim();
  }
  return null;
}

/** True when a registrar says the operation (or TLD) isn't offered via its
 *  API — the user has to do it in the registrar's own dashboard. */
export function isApiUnsupportedMessage(message: string): boolean {
  return /not (?:yet )?(?:supported|available) (?:via|through|in) (?:the |this )?api|isn['’]t supported via the api/i.test(
    message,
  );
}
