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
