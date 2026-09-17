// Which host the renderer is running under. Desktop is the default; the web
// bootstrap (main.tsx) marks the web host and records its auth mode before
// the app renders. Kept tiny and synchronous so any component can branch on
// it without a store round trip.

export type AuthMode = 'password' | 'cloudflare-access' | 'external';

let web = false;
let demo = false;
let authMode: AuthMode | null = null;

export function markWeb(mode: AuthMode): void {
  web = true;
  authMode = mode;
}

/** The demo build: a browser host (downloads, no stdio) with a few controls
 *  disabled. Reports the plain web mode so every page keeps its normal copy;
 *  the footer and the disabled controls branch on isDemo(). See docs/demo.md. */
export function markDemo(): void {
  web = true;
  demo = true;
  authMode = 'password';
}

/** True only in the demo build. */
export function isDemo(): boolean {
  return demo;
}

/** True in the self-hosted browser build; false in Electron. */
export function isWeb(): boolean {
  return web;
}

/** The web host's DOMBOT_AUTH mode; null on desktop. */
export function webAuthMode(): AuthMode | null {
  return authMode;
}

/** True when the web build is served from this machine (`npm run web:dev`),
 *  where "external" auth just means no login, not a real gate in front. */
export function isLocalWeb(): boolean {
  return (
    isWeb() &&
    ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  );
}

/** Ends the web session (password mode) and returns to the login screen. */
export async function signOut(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.reload();
}
