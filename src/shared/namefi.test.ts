import { describe, expect, it } from 'vitest';
import type { DomainOp, RegistrarName } from './ipc';
import { REGISTRAR_HELP, connectFailureMessage } from './registrar-help';
import { reportsPrivacy, reportsLock, unsupportedReason } from './domain-ops';
import { registrarHostsDns } from './market-verification';
import { usesPerNameQuote } from '../core/services/pricing';

const namefi: RegistrarName = 'namefi';
describe('Namefi integration', () => {
  it('keeps credential setup and unreported security flags explicit', () => {
    expect(REGISTRAR_HELP.namefi.links[0].url).toBe(
      'https://namefi.io/api-keys',
    );
    expect(REGISTRAR_HELP.namefi.summary).toContain('saved card');
    expect(reportsPrivacy(namefi)).toBe(false);
    expect(reportsLock(namefi)).toBe(false);
  });
  it('hints at the API key on a server error, for Namefi only', () => {
    expect(connectFailureMessage(namefi, 'Failed', 502)).toBe(
      'Failed. Namefi also returns this for an invalid API key, so check the key first.',
    );
    expect(connectFailureMessage(namefi, 'Failed', 401)).toBe('Failed');
    expect(connectFailureMessage('porkbun', 'Failed', 502)).toBe('Failed');
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
