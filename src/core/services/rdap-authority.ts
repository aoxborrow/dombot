import { Namespace } from '../storage/namespace';

const bootstrap = new Namespace<{
  services: [string[], string[]][];
  fetchedAt: number;
}>('rdap-authorities', { cache: true });
const DAY_MS = 86_400_000;
const MAX_BYTES = 1_000_000;

/** Bounded public RDAP/bootstrap JSON; no response body is kept in the cache. */
export async function readRdapJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw Error('Empty RDAP response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw Error('RDAP response too large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function safeAuthority(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i.test(url.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|localdomain)$/i.test(url.hostname) ||
      url.search ||
      url.hash
    )
      return null;
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
  } catch {
    return null;
  }
}

/** The TLD registry authority published by IANA, never a URL supplied by a caller. */
export async function rdapAuthorities(): Promise<Map<string, string>> {
  let cached = bootstrap.get('dns');
  if (!cached || Date.now() - cached.fetchedAt >= DAY_MS) {
    try {
      const response = await fetch('https://data.iana.org/rdap/dns.json', {
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw Error('RDAP bootstrap unavailable');
      }
      const doc = await readRdapJson(response);
      if (
        !doc ||
        typeof doc !== 'object' ||
        !Array.isArray(Reflect.get(doc, 'services'))
      )
        throw Error('Invalid RDAP bootstrap');
      const services: [string[], string[]][] = [];
      for (const entry of Reflect.get(doc, 'services')) {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          !Array.isArray(entry[0]) ||
          !Array.isArray(entry[1]) ||
          !entry[0].every((v: unknown) => typeof v === 'string') ||
          !entry[1].every((v: unknown) => typeof v === 'string')
        )
          throw Error('Invalid RDAP authority');
        services.push([entry[0], entry[1]]);
      }
      cached = { services, fetchedAt: Date.now() };
      await bootstrap.set('dns', cached);
    } catch {
      /* A previously verified bootstrap remains usable during an outage. */
    }
  }
  const out = new Map<string, string>();
  for (const [tlds, urls] of cached?.services ?? []) {
    const authority = urls.map(safeAuthority).find((url) => url !== null);
    if (authority)
      for (const tld of tlds) out.set(tld.toLowerCase(), authority);
  }
  return out;
}
