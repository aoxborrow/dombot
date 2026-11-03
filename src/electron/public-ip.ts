import { isIP } from 'node:net';

// This machine's public IP address, for registrar agreements that record it
// (GoDaddy, when WHOIS privacy is turned off; see core/services/consent-ip.ts).
// Asked of ipify only at that moment, never cached: the network can change.
export async function publicIp(): Promise<string> {
  const res = await fetch('https://api.ipify.org', {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ipify answered ${res.status}`);
  const ip = (await res.text()).trim();
  if (!isIP(ip)) throw new Error('ipify returned no IP address');
  return ip;
}
