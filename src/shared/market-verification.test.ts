import { describe, expect, it } from 'vitest';
import { AFTERNIC_NAMESERVERS } from '../core/markets/afternic/nameservers';
import { SEDO_NAMESERVERS } from '../core/markets/sedo/nameservers';
import {
  parseVerificationId,
  registrarHostsDns,
  verificationNameservers,
  verificationTxt,
} from './market-verification';

const SEDO_ID = '0123456789abcdef0123456789abcdef01234567';

describe('parseVerificationId', () => {
  it('reads Afternic’s ID out of either value its page shows', () => {
    expect(
      parseVerificationId('afternic', 'afternic-verification-Abc123XYZ'),
    ).toBe('Abc123XYZ');
    expect(
      parseVerificationId('afternic', 'verification-Abc123XYZ.ns101.verify.hn'),
    ).toBe('Abc123XYZ');
  });

  it('drops spaces, quotes and a trailing dot', () => {
    expect(
      parseVerificationId(
        'afternic',
        '  “verification-Abc1.ns101.verify.hn.” ',
      ),
    ).toBe('Abc1');
    expect(parseVerificationId('sedo', ` '${SEDO_ID.toUpperCase()}' `)).toBe(
      SEDO_ID,
    );
  });

  it('takes Sedo’s and Atom’s 40-character IDs as they are', () => {
    expect(parseVerificationId('sedo', SEDO_ID)).toBe(SEDO_ID);
    expect(parseVerificationId('atom', SEDO_ID)).toBe(SEDO_ID);
  });

  it('clears on a blank value', () => {
    expect(parseVerificationId('atom', '   ')).toBeNull();
  });

  it('refuses a value cut short, saying to use the copy button', () => {
    expect(() =>
      parseVerificationId('atom', '40d64231c272065293ebb694a6…', 'Atom'),
    ).toThrow(/cut short.*copy button beside your TXT Code on Atom/);
  });

  it('refuses anything else, naming what to copy', () => {
    expect(() => parseVerificationId('afternic', 'Abc123', 'Afternic')).toThrow(
      /isn’t Afternic’s Domain Ownership Record/,
    );
    expect(() => parseVerificationId('sedo', 'abc', 'Sedo')).toThrow(
      /Domain Ownership Verification ID/,
    );
  });
});

describe('what Apply sets', () => {
  it('builds each market’s TXT value', () => {
    expect(verificationTxt('afternic', 'Abc1')).toBe(
      'afternic-verification-Abc1',
    );
    expect(verificationTxt('sedo', SEDO_ID)).toBe(SEDO_ID);
  });

  it('adds Afternic’s NS3 to its pair once the ID is saved', () => {
    const afternic = {
      id: 'afternic' as const,
      nameservers: AFTERNIC_NAMESERVERS,
    };
    expect(verificationNameservers(afternic, null)).toEqual([
      'ns1.afternic.com',
      'ns2.afternic.com',
    ]);
    // The NS3 is a hostname, lowercase (Dynadot refuses capitals); the TXT
    // above keeps the ID's case.
    expect(verificationNameservers(afternic, 'Abc1')).toEqual([
      'ns1.afternic.com',
      'ns2.afternic.com',
      'verification-abc1.ns101.verify.hn',
    ]);
    expect(
      verificationNameservers(
        { id: 'sedo', nameservers: SEDO_NAMESERVERS },
        SEDO_ID,
      ),
    ).toEqual(['ns1.sedoparking.com', 'ns2.sedoparking.com']);
  });
});

describe('registrarHostsDns', () => {
  it('is true only while every nameserver is the registrar’s', () => {
    expect(
      registrarHostsDns('godaddy', [
        'ns31.domaincontrol.com',
        'NS32.DomainControl.com.',
      ]),
    ).toBe(true);
    expect(registrarHostsDns('dynadot', ['ns1.dyna-ns.net'])).toBe(true);
    expect(
      registrarHostsDns('namecheap', [
        'dns1.registrar-servers.com',
        'ns1.afternic.com',
      ]),
    ).toBe(false);
    expect(registrarHostsDns('porkbun', ['ns1.sedoparking.com'])).toBe(false);
  });

  it('leaves unknown nameservers to the registrar', () => {
    expect(registrarHostsDns('gandi', [])).toBe(true);
  });
});
