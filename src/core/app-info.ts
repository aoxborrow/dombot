// Which build is running, as far as core needs to know: stamped into exported
// data bundles. Hosts set it at boot; the default only shows up in tests.

export interface AppIdentity {
  version: string;
  /** 'darwin' | 'win32' | 'linux' on the desktop, 'web' on the web host. */
  platform: string;
}

let identity: AppIdentity = { version: '0.0.0', platform: 'unknown' };

export function setAppIdentity(next: AppIdentity): void {
  identity = next;
}

export function getAppIdentity(): AppIdentity {
  return identity;
}

/**
 * Identifies DomBot to the third-party services core calls directly (RDAP,
 * DNS-over-HTTPS). rdap.org answers Node's default fetch User-Agent with a
 * 403. Empty in a browser (the demo), which sends its own User-Agent and
 * where setting one can force a CORS preflight.
 */
export function userAgentHeaders(): Record<string, string> {
  if (typeof (globalThis as { document?: unknown }).document !== 'undefined')
    return {};
  return { 'user-agent': `DomBot/${identity.version} (+https://dombot.ai)` };
}
