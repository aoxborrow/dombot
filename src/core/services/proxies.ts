import {
  DEFAULT_PROXY_ID,
  PROXIES_NAMESPACE,
  parseProxy,
  type ProxyProfile,
  type ProxyRoute,
} from '../../shared/proxy';
import { parseNamecheapProxy } from '../../shared/namecheap-proxy';
import type {
  ProxySettings,
  ProxyTestResult,
  RegistrarAccount,
} from '../../shared/ipc';
import { proxySecrets } from '../../shared/proxy';
import { getProxyTransport } from './namecheap-proxy';
import { redactRegistrarMessage } from './registrar-errors';
import { Namespace } from '../storage/namespace';
import { isSavedAccount, listAccounts, setAccountProxy } from './accounts';
import { getStoredCredentials, setStoredCredentials } from './credentials';

// The fixed IP proxy, configured once and switched on per account. Stored like
// credentials (the URL carries a password): sealed at rest, included in data
// exports, kept out of diagnostics. The store holds a list so a second egress
// IP never needs a migration, but the app manages exactly one: `default`.

const store = new Namespace<ProxyProfile>(PROXIES_NAMESPACE);

export function getProxyProfile(id = DEFAULT_PROXY_ID): ProxyProfile | null {
  return store.get(id) ?? null;
}

export function listProxyProfiles(): ProxyProfile[] {
  return Object.values(store.all());
}

/** The route for an account, or null for a direct connection. An account that
 * points at a missing profile fails loudly: it must never quietly go direct
 * from an address the registrar hasn't allowlisted. */
export function accountProxyRoute(
  account: RegistrarAccount,
): ProxyRoute | null {
  if (!account.proxyId) return null;
  const profile = getProxyProfile(account.proxyId);
  if (!profile)
    throw new Error(
      'This account uses the fixed IP proxy, but no proxy is configured. Add one in Settings → Proxy.',
    );
  return { url: profile.url, ip: profile.egressIp };
}

/** Saved accounts routed through a profile. */
export function proxyUsers(id = DEFAULT_PROXY_ID): RegistrarAccount[] {
  return listAccounts().filter((a) => a.proxyId === id && isSavedAccount(a.id));
}

/** Validates and stores the proxy. Registrar clients notice the change through
 * their fingerprint and rebuild on next use. */
export async function saveProxyProfile(
  input: { url: string; egressIp: string },
  id = DEFAULT_PROXY_ID,
): Promise<ProxyProfile> {
  const route = parseProxy(input);
  if (!route)
    throw new Error('Enter both the proxy URL and its outgoing IPv4 address.');
  const profile: ProxyProfile = {
    id,
    label: getProxyProfile(id)?.label ?? 'Fixed IP proxy',
    url: route.url,
    egressIp: route.ip,
  };
  await store.set(id, profile);
  return profile;
}

/** Refused while any account still depends on it. */
export async function removeProxyProfile(id = DEFAULT_PROXY_ID): Promise<void> {
  const users = proxyUsers(id);
  if (users.length)
    throw new Error(
      `${users.length} account${users.length === 1 ? ' still uses' : 's still use'} this proxy. Turn off “Use fixed IP proxy” on ${users.length === 1 ? 'it' : 'them'} first.`,
    );
  await store.delete(id);
}

/**
 * Lifts the proxy a Namecheap account used to keep in its own credentials
 * (`proxyUrl` / `proxyIp`) into a profile, points the account at it, and
 * removes the fields. Idempotent: it only acts on credentials that still carry
 * them, so it is safe after every hydrate and every import.
 *
 * The first proxy found becomes `default`. An account with a different proxy
 * gets its own profile and keeps working; the UI just can't edit that one.
 */
export async function migrateLegacyProxies(): Promise<number> {
  let migrated = 0;
  for (const account of listAccounts()) {
    const { proxyUrl, proxyIp, ...rest } = getStoredCredentials(account.id);
    if (proxyUrl === undefined && proxyIp === undefined) continue;
    let route: ProxyRoute | null = null;
    try {
      route = parseNamecheapProxy({ proxyUrl, proxyIp });
    } catch {
      // A malformed legacy proxy already left the account unusable; drop it.
      console.warn(
        `[proxy] dropped an invalid stored proxy from account ${account.id}`,
      );
    }
    if (route) {
      const match = listProxyProfiles().find(
        (p) => p.url === route.url && p.egressIp === route.ip,
      );
      const id =
        match?.id ??
        (getProxyProfile() ? crypto.randomUUID() : DEFAULT_PROXY_ID);
      if (!match) {
        await store.set(id, {
          id,
          label:
            id === DEFAULT_PROXY_ID
              ? 'Fixed IP proxy'
              : `${account.label} proxy`,
          url: route.url,
          egressIp: route.ip,
        });
        if (id !== DEFAULT_PROXY_ID)
          console.warn(
            `[proxy] account ${account.id} used a second proxy; kept as profile ${id}`,
          );
      }
      await setAccountProxy(account.id, id);
      // A proxy-only account had the proxy's address written in as its Client
      // IP. That was never a direct IP, so don't keep it as one.
      if (rest.clientIp === route.ip) delete rest.clientIp;
    }
    await setStoredCredentials(account.id, rest);
    migrated++;
  }
  return migrated;
}

/** What the Proxy settings page shows: the one managed proxy and who uses it. */
export function getProxySettings(): ProxySettings {
  const profile = getProxyProfile();
  return {
    proxy: profile ? { url: profile.url, egressIp: profile.egressIp } : null,
    users: proxyUsers().map((a) => ({
      accountId: a.id,
      registrar: a.registrar,
      label: a.label,
    })),
  };
}

// Plain-text services that echo the caller's address. Cloudflare first; a
// second provider so one outage doesn't read as a broken proxy.
const IP_PROBES: { url: string; read: (body: string) => string | undefined }[] =
  [
    {
      url: 'https://www.cloudflare.com/cdn-cgi/trace',
      read: (body) => /^ip=(.+)$/m.exec(body)?.[1],
    },
    {
      url: 'https://ipinfo.io/json',
      read: (body) => (JSON.parse(body) as { ip?: string }).ip,
    },
  ];
const PROBE_TIMEOUT_MS = 15_000;

/**
 * Makes one request through the proxy and reports the address the internet saw,
 * so a wrong outgoing IP shows up here rather than as a registrar rejection.
 * Tests the values given, saved or not.
 */
export async function testProxy(input: {
  url: string;
  egressIp: string;
}): Promise<ProxyTestResult> {
  const route = parseProxy(input);
  if (!route)
    throw new Error('Enter both the proxy URL and its outgoing IPv4 address.');
  const send = getProxyTransport();
  if (!send) throw new Error('Proxy connections are not available here.');
  let failure = 'no response';
  for (const probe of IP_PROBES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await send(route, probe.url, {
        method: 'GET',
        headers: { Accept: '*/*', 'Accept-Encoding': 'identity' },
        redirect: 'manual',
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          `${new URL(probe.url).hostname} answered ${response.status}`,
        );
      const ip = probe.read(await response.text())?.trim();
      if (!ip) throw new Error('the address check returned no address');
      return { ip, expected: route.ip, matches: ip === route.ip };
    } catch (error) {
      failure = controller.signal.aborted
        ? `timed out after ${PROBE_TIMEOUT_MS / 1000}s`
        : error instanceof Error
          ? error.message
          : String(error);
    } finally {
      clearTimeout(timer);
    }
  }
  const secrets: Record<string, string> = {};
  proxySecrets(route.url).forEach((v, i) => (secrets[String(i)] = v));
  throw new Error(
    `Could not connect through the proxy: ${redactRegistrarMessage(failure, secrets)}`,
  );
}
