import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegistrarName } from '@aoxborrow/registrar-client';

// Keep Electron and the filesystem out. loadOverrides reads a JSON file; make it
// throw so overrides start empty, and let tests seed them via setManualPrice.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/dombot-test' } }));

const readFileSync = vi.fn<(...a: unknown[]) => string>();
const writeFileSync = vi.fn<(...a: unknown[]) => void>();
vi.mock('node:fs', () => ({
  default: {
    readFileSync: (...a: unknown[]) => readFileSync(...a),
    writeFileSync: (...a: unknown[]) => writeFileSync(...a),
  },
}));

const getBaseRenewal = vi.fn<(r: string, tld: string) => number | null>();
vi.mock('./base-pricing', () => ({
  getBaseRenewal: (r: string, tld: string) => getBaseRenewal(r, tld),
}));

// Re-import fresh each test so the module-level overrides cache resets.
type PricingModule = typeof import('./pricing');
let pricing: PricingModule;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  readFileSync.mockImplementation(() => {
    throw new Error('ENOENT');
  });
  getBaseRenewal.mockReturnValue(null);
  pricing = await import('./pricing');
});

const reg = (name: string) => name as RegistrarName;

describe('usesPerNameQuote', () => {
  it('is true for gandi/dynadot on a premium-capable TLD', () => {
    expect(pricing.usesPerNameQuote(reg('gandi'), 'io')).toBe(true);
    expect(pricing.usesPerNameQuote(reg('dynadot'), 'DEV')).toBe(true); // case-insensitive
  });

  it('is false on a flat-priced legacy gTLD', () => {
    for (const tld of ['com', 'net', 'org', 'info', 'biz']) {
      expect(pricing.usesPerNameQuote(reg('gandi'), tld)).toBe(false);
    }
  });

  it('is false for a registrar that cannot price per name', () => {
    expect(pricing.usesPerNameQuote(reg('porkbun'), 'io')).toBe(false);
    expect(pricing.usesPerNameQuote(reg('cloudflare'), 'io')).toBe(false);
  });
});

describe('resolvePricing precedence', () => {
  it('base per-TLD when nothing else applies', () => {
    getBaseRenewal.mockReturnValue(9.99);
    const p = pricing.resolvePricing(reg('dynadot'), 'example.com');
    expect(p).toMatchObject({ renewal: 9.99, source: 'base', currency: 'USD' });
  });

  it('unavailable when there is no base rate', () => {
    getBaseRenewal.mockReturnValue(null);
    const p = pricing.resolvePricing(reg('dynadot'), 'example.weird');
    expect(p).toMatchObject({ renewal: null, source: 'unavailable' });
  });

  it('a synced per-name quote beats the base rate', () => {
    getBaseRenewal.mockReturnValue(9.99);
    const p = pricing.resolvePricing(reg('gandi'), 'example.io', {
      renewal: 42,
      currency: 'EUR',
    });
    expect(p).toMatchObject({ renewal: 42, source: 'api', currency: 'EUR' });
  });

  it('ignores a quote whose renewal is null and falls back to base', () => {
    getBaseRenewal.mockReturnValue(9.99);
    const p = pricing.resolvePricing(reg('gandi'), 'example.io', {
      renewal: null,
      currency: 'USD',
    });
    expect(p.source).toBe('base');
  });

  it('a manual override beats both quote and base', () => {
    getBaseRenewal.mockReturnValue(9.99);
    pricing.setManualPrice(reg('dynadot'), 'example.com', 25);
    const p = pricing.resolvePricing(reg('dynadot'), 'example.com', {
      renewal: 42,
      currency: 'USD',
    });
    expect(p).toMatchObject({ renewal: 25, source: 'manual' });
  });
});

describe('setManualPrice', () => {
  it('sets then clears an override (null deletes the key)', () => {
    getBaseRenewal.mockReturnValue(9.99);
    pricing.setManualPrice(reg('dynadot'), 'example.com', 25);
    expect(pricing.resolvePricing(reg('dynadot'), 'example.com').source).toBe('manual');

    pricing.setManualPrice(reg('dynadot'), 'example.com', null);
    expect(pricing.resolvePricing(reg('dynadot'), 'example.com').source).toBe('base');
  });

  it('treats NaN as a clear', () => {
    pricing.setManualPrice(reg('dynadot'), 'example.com', 25);
    pricing.setManualPrice(reg('dynadot'), 'example.com', Number.NaN);
    getBaseRenewal.mockReturnValue(null);
    expect(pricing.resolvePricing(reg('dynadot'), 'example.com').source).toBe(
      'unavailable',
    );
  });

  it('persists overrides to disk', () => {
    pricing.setManualPrice(reg('dynadot'), 'example.com', 25);
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const [, json] = writeFileSync.mock.calls[0];
    expect(JSON.parse(json as string)).toEqual({ 'dynadot:example.com': 25 });
  });
});
