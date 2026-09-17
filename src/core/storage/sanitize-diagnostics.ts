import type { DocStore } from './doc-store';
import { redactRegistrarMessage } from '../services/registrar-errors';
import { PROXIES_NAMESPACE, proxySecrets } from '../../shared/proxy';

const DIAGNOSTIC_NAMESPACES = ['cache-portfolio', 'bulk-jobs'];

/** Also remove leaked diagnostics from older backups, not just new requests. */
export function sanitizeBundleDiagnostics(
  data: Record<string, Record<string, unknown>>,
): void {
  const credentials: Record<string, string> = {};
  for (const bag of Object.values(data.credentials ?? {})) {
    if (!bag || typeof bag !== 'object') continue;
    for (const value of Object.values(bag)) {
      if (typeof value === 'string' && value)
        credentials[String(Object.keys(credentials).length)] = value;
    }
  }
  // Only a proxy's URL and the credentials inside it: its id and label are
  // ordinary words that would mangle unrelated messages.
  for (const profile of Object.values(data[PROXIES_NAMESPACE] ?? {})) {
    const url = (profile as { url?: unknown } | null)?.url;
    if (typeof url === 'string')
      for (const secret of proxySecrets(url))
        credentials[String(Object.keys(credentials).length)] = secret;
  }
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object' || value instanceof Date)
      return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        ['message', 'lastError'].includes(key) && typeof child === 'string'
          ? redactRegistrarMessage(child, credentials)
          : walk(child),
      ]),
    );
  };
  for (const name of DIAGNOSTIC_NAMESPACES) {
    if (data[name]) data[name] = walk(data[name]) as Record<string, unknown>;
  }
}

/** Desktop startup: clean legacy plaintext diagnostics before exposing them. */
export async function sanitizeStoredDiagnostics(
  store: DocStore,
): Promise<void> {
  const data: Record<string, Record<string, unknown>> = {
    credentials: await store.list('credentials'),
    [PROXIES_NAMESPACE]: await store.list(PROXIES_NAMESPACE),
  };
  for (const name of DIAGNOSTIC_NAMESPACES) data[name] = await store.list(name);
  const before = structuredClone(data);
  sanitizeBundleDiagnostics(data);
  for (const name of DIAGNOSTIC_NAMESPACES) {
    for (const [key, value] of Object.entries(data[name])) {
      if (JSON.stringify(value) !== JSON.stringify(before[name][key]))
        await store.put(name, key, value);
    }
  }
}
