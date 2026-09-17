import { describe, expect, it } from 'vitest';
import { getBaseRenewal } from '../services/base-pricing';
import { tldOf } from './registrar';
import { DEFAULT_DEMO_SIZE, generateDemoSeed } from './seed';

describe('generateDemoSeed', () => {
  const seed = generateDemoSeed();

  it('is deterministic and the requested size', () => {
    const again = generateDemoSeed();
    expect(again.records.map((r) => r.domainName)).toEqual(
      seed.records.map((r) => r.domainName),
    );
    expect(seed.records).toHaveLength(DEFAULT_DEMO_SIZE);
    expect(generateDemoSeed(7, 40).records).toHaveLength(40);
    expect(generateDemoSeed(7).records[0].domainName).not.toBe(
      seed.records[0].domainName,
    );
  });

  it('names are unique, lowercase, and look like domains', () => {
    const names = seed.records.map((r) => r.domainName);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.[a-z]+$/);
    }
  });

  it('deals domains across accounts by share, with real prices for every TLD', () => {
    const counts = new Map<string, number>();
    for (const r of seed.records) {
      counts.set(r.accountId, (counts.get(r.accountId) ?? 0) + 1);
      expect(r.accountId).toBe(r.registrar);
      expect(getBaseRenewal(r.registrar, tldOf(r.domainName))).not.toBeNull();
    }
    for (const a of seed.accounts) {
      expect(counts.get(a.id)).toBeGreaterThanOrEqual(
        Math.floor(a.share * DEFAULT_DEMO_SIZE),
      );
    }
    expect(counts.get('godaddy')!).toBeGreaterThan(counts.get('porkbun')!);
    expect(counts.has('gandi')).toBe(false); // left unconfigured
  });

  it('has a realistic spread of expiries, flags, and delegation', () => {
    const now = new Date('2026-09-07T12:00:00Z').getTime();
    const overdue = seed.records.filter(
      (r) => r.expirationDate.getTime() < now,
    );
    const soon = seed.records.filter((r) => {
      const d = (r.expirationDate.getTime() - now) / 86_400_000;
      return d >= 0 && d < 30;
    });
    expect(overdue.length).toBeGreaterThan(2);
    expect(overdue.every((r) => r.status === 'expired')).toBe(true);
    expect(soon.length).toBeGreaterThan(5);
    for (const r of seed.records) {
      expect(r.createdDate.getTime()).toBeLessThan(r.expirationDate.getTime());
      expect(r.createdDate.getTime()).toBeLessThan(now);
      expect(r.nameservers.length).toBeGreaterThanOrEqual(2);
      expect(r.authCode).toMatch(/^DEMO-/);
      expect(r.contacts.registrant?.email).toBe('domains@example.com');
    }
    const off = seed.records.filter((r) => !r.autoRenew).length;
    expect(off).toBeGreaterThan(20);
    expect(off).toBeLessThan(seed.records.length / 2);
    const cfDelegated = seed.records.filter(
      (r) =>
        r.registrar !== 'cloudflare' && r.nameservers[0].includes('cloudflare'),
    );
    expect(cfDelegated.length).toBeGreaterThan(10);
    expect(
      seed.records.some(
        (r) => r.dnssec.enabled && r.dnssec.dsRecords.length === 1,
      ),
    ).toBe(true);
    expect(
      seed.records.some((r) => r.dnsRecords.some((d) => d.type === 'MX')),
    ).toBe(true);
  });

  it('folders hold real domains, each in at most one folder', () => {
    const names = new Set(seed.records.map((r) => r.domainName));
    const seen = new Set<string>();
    expect(seed.folders.length).toBe(4);
    for (const f of seed.folders) {
      expect(f.domains.length).toBeGreaterThan(0);
      for (const d of f.domains) {
        expect(names.has(d)).toBe(true);
        expect(seen.has(d)).toBe(false);
        seen.add(d);
      }
    }
  });

  it('manual prices point at real domains and differ from the base rate', () => {
    const entries = Object.entries(seed.manualPrices);
    expect(entries.length).toBeGreaterThan(3);
    for (const [key, price] of entries) {
      const [accountId, domainName] = key.split(':');
      const r = seed.records.find((x) => x.domainName === domainName)!;
      expect(r.accountId).toBe(accountId);
      expect(price).toBeGreaterThan(0);
      expect(price).not.toBe(getBaseRenewal(r.registrar, tldOf(domainName)));
    }
  });
});
