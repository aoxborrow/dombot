import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import { configureStore, hydrateStores } from '../storage/namespace';
import {
  CREDENTIALS_NAMESPACE,
  MARKET_CREDENTIALS_NAMESPACE,
} from '../storage/names';
import { PROXIES_NAMESPACE } from '../../shared/proxy';
import { scrubDiagnostic, storedSecrets } from './stored-secrets';
import { errorSummary } from './error-summary';

const REGISTRAR_KEY = 'FAKE_REGISTRAR_KEY_123';
const MARKET_TOKEN = 'fake/market+token=456';
const PROXY_PASSWORD = 'p@ss:word';

async function seed(): Promise<void> {
  const disk = new MemoryDocStore();
  await disk.put(CREDENTIALS_NAMESPACE, 'acct-1', {
    apiKey: REGISTRAR_KEY,
    // Too short to be a secret: left alone so lines stay readable.
    region: 'eu',
  });
  await disk.put(MARKET_CREDENTIALS_NAMESPACE, 'market-1', {
    apiToken: MARKET_TOKEN,
  });
  await disk.put(PROXIES_NAMESPACE, 'default', {
    id: 'default',
    label: 'Proxy',
    url: `http://proxyuser:${encodeURIComponent(PROXY_PASSWORD)}@203.0.113.7:3128`,
    egressIp: '203.0.113.7',
  });
  configureStore(disk);
  await hydrateStores();
}

describe('storedSecrets', () => {
  it('is empty, not an error, before storage is hydrated', () => {
    configureStore(new MemoryDocStore());
    expect(storedSecrets()).toEqual([]);
    // URLs are still cut back to scheme, host and path.
    expect(scrubDiagnostic('GET https://api.example.com/v1?key=abc')).toBe(
      'GET https://api.example.com/v1',
    );
  });

  it('lists registrar, market and proxy secrets', async () => {
    await seed();
    const secrets = storedSecrets();
    expect(secrets).toContain(REGISTRAR_KEY);
    expect(secrets).toContain(MARKET_TOKEN);
    expect(secrets).toContain('proxyuser');
    expect(secrets).toContain(PROXY_PASSWORD);
    expect(secrets).not.toContain('eu');
  });
});

describe('scrubDiagnostic', () => {
  beforeEach(seed);

  it('redacts stored values, plain or URL-encoded', () => {
    const line = scrubDiagnostic(
      `Dynadot said ${REGISTRAR_KEY} is wrong; Atom token ${encodeURIComponent(MARKET_TOKEN)}; proxy ${PROXY_PASSWORD} in eu`,
    );
    expect(line).not.toContain(REGISTRAR_KEY);
    expect(line).not.toContain(MARKET_TOKEN);
    expect(line).not.toContain(encodeURIComponent(MARKET_TOKEN));
    expect(line).not.toContain(PROXY_PASSWORD);
    expect(line).toContain('[redacted]');
    expect(line).toContain('in eu');
  });

  it('drops URL queries and userinfo, even for keys it was never told', () => {
    const line = scrubDiagnostic(
      'fetch https://user:pw@api.atom.com/seller/listings?api_token=UNKNOWN_TOKEN&user_id=42 failed',
    );
    expect(line).toBe('fetch https://api.atom.com/seller/listings failed');
  });
});

describe('errorSummary', () => {
  it('keeps the class, code, status and request id with the message', () => {
    const error = Object.assign(new Error('Afternic did not respond in time'), {
      name: 'AfternicError',
      code: 'TIMEOUT',
      status: 0,
      requestId: 'req-1',
      url: 'https://example.com/?secret=1',
    });
    expect(errorSummary(error)).toBe(
      'AfternicError code=TIMEOUT status=0 requestId=req-1: Afternic did not respond in time',
    );
    expect(errorSummary('plain')).toBe('plain');
    expect(errorSummary(new TypeError('boom'))).toBe('TypeError: boom');
  });
});
