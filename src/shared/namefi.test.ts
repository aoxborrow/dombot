import { describe, expect, it } from 'vitest';
import type { DomainOp, RegistrarName } from './ipc';
import { REGISTRAR_HELP } from './registrar-help';
import { reportsPrivacy, reportsLock, unsupportedReason } from './domain-ops';
import { registrarHostsDns } from './market-verification';
import { usesPerNameQuote } from '../core/services/pricing';

// The SDK provider is a separate pending release. Keep preparation testable
// against the pinned catalog and rerun against the provider candidate as well.
const namefi = 'namefi' as RegistrarName;
describe('prepared Namefi integration', () => {
  it('keeps credential setup and unreported security flags explicit', () => {
    expect(REGISTRAR_HELP.namefi.links[0].url).toBe(
      'https://namefi.io/api-keys',
    );
    expect(REGISTRAR_HELP.namefi.summary).toContain('saved card');
    expect(reportsPrivacy(namefi)).toBe(false);
    expect(reportsLock(namefi)).toBe(false);
  });
  it('blocks absent API changes and keeps auto-renew available to the provider', () => {
    const blocked: DomainOp[] = [
      { kind: 'privacy', enabled: true },
      { kind: 'lock', locked: false },
      { kind: 'nameservers', nameservers: ['ns1.example.net'] },
      { kind: 'renew', years: 1 },
    ];
    for (const op of blocked)
      expect(unsupportedReason(namefi, [], op)).toContain('Namefi');
    expect(
      unsupportedReason(namefi, [], { kind: 'autoRenew', enabled: true }),
    ).toBeNull();
  });
  it('uses Namefi DNS and real per-name quotes rather than a fabricated base rate', () => {
    expect(registrarHostsDns(namefi, ['NS3.NAMEFI.IO.', 'ns4.namefi.io'])).toBe(
      true,
    );
    expect(registrarHostsDns(namefi, ['ns1.other.example'])).toBe(false);
    expect(usesPerNameQuote(namefi, 'com')).toBe(true);
    expect(usesPerNameQuote(namefi, 'io')).toBe(true);
  });
});
