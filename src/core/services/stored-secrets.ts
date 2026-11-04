import { storedCredentialValues } from './credentials';
import { marketCredentialValues } from './markets/accounts';
import { proxySecretValues } from './proxies';
import { redactSecrets } from '@aoxborrow/registrar-client';

// The second layer of scrubbing, for diagnostics that outlive the moment (the
// desktop's log file). Registrar errors are already scrubbed where they're
// thrown (protectRegistrar) and market clients write their own messages with
// no URLs or keys; this catches whatever slips past either.

/** Shorter than this is no secret, and blanking it would mangle every line. */
const MIN_SECRET_LENGTH = 4;

/**
 * Every secret DomBot holds: each value saved for a registrar or market
 * account, and each proxy URL with the username and password inside it.
 * Empty before storage is hydrated (nothing has been read yet).
 */
export function storedSecrets(): string[] {
  const all = [
    ...storedCredentialValues(),
    ...marketCredentialValues(),
    ...proxySecretValues(),
  ];
  return [...new Set(all)].filter((v) => v.length >= MIN_SECRET_LENGTH);
}

/** `text` with URL queries and userinfo dropped and every stored secret
 *  (plain or URL-encoded) replaced with [redacted]. */
export function scrubDiagnostic(text: string): string {
  return redactSecrets(text, storedSecrets());
}
