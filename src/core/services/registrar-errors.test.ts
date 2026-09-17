import { afterEach, expect, it, vi } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import {
  getMergedPortfolio,
  resetRegistrarClients,
  saveRegistrarCredentials,
  syncRegistrar,
} from './registrars';
import { protectRegistrar, redactRegistrarMessage } from './registrar-errors';
import { RateLimitError } from '@aoxborrow/registrar-client';

afterEach(() => {
  vi.unstubAllGlobals();
  resetRegistrarClients();
});

it('keeps query credentials out of portfolio storage and MCP errors', async () => {
  const disk = new MemoryDocStore();
  configureStore(disk);
  await hydrateStores();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('denied', { status: 403 })),
  );
  await saveRegistrarCredentials('namesilo', {
    apiKey: 'AUDIT_FAKE_SECRET_123',
  });
  await syncRegistrar('namesilo');
  await flushWrites();
  expect(JSON.stringify(await disk.list('cache-portfolio'))).not.toContain(
    'AUDIT_FAKE_SECRET_123',
  );
  expect(JSON.stringify(getMergedPortfolio().errors)).not.toContain(
    'AUDIT_FAKE_SECRET_123',
  );
  expect(getMergedPortfolio().errors[0].message).toContain('403');
});

it('redacts raw and encoded secrets, soft failures, and extended-method exceptions', async () => {
  const key = 'secret/+ value';
  const client = protectRegistrar(
    {
      async testConnection() {
        return { success: false, message: `bad ${encodeURIComponent(key)}` };
      },
      async getAuthCode() {
        throw new RateLimitError(`bad ${key}`);
      },
    },
    { apiKey: key },
  );
  expect((await client.testConnection()).message).toBe('bad [redacted]');
  await expect(client.getAuthCode()).rejects.toBeInstanceOf(RateLimitError);
  await expect(client.getAuthCode()).rejects.toThrow('bad [redacted]');
  expect(
    redactRegistrarMessage(
      'Failed https://user:pass@api.example/path?unknown=old-secret',
    ),
  ).not.toContain('old-secret');
});
