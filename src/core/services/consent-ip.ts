// The consenting user's IP address, for registrars that record it with an
// agreement (GoDaddy, when WHOIS privacy is turned off; see
// `recordsPrivacyConsent`). Only the host knows where the user is: the desktop
// asks a lookup service for its public address, the Worker reads the request's
// CF-Connecting-IP, and the demo uses a documentation address.

export type ConsentIpSource = () => Promise<string>;

let source: ConsentIpSource | undefined;
export function configureConsentIp(next?: ConsentIpSource): void {
  source = next;
}

/** The user's IP address, or a rejection saying why it can't be found. */
export async function consentIp(): Promise<string> {
  if (!source) throw new Error('No source for the user’s IP address.');
  return source();
}
