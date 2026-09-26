import { describe, expect, it } from 'vitest';
import {
  assertDomainName,
  isIdn,
  normalizeDomain,
  toAscii,
  toUnicode,
} from './domain-name';

describe('domain names', () => {
  it('normalizes messy input to one spelling', () => {
    expect(normalizeDomain('  HTTPS://Example.COM./ ')).toBe('example.com');
    expect(normalizeDomain('..example.com..')).toBe('example.com');
    expect(normalizeDomain(null)).toBe('');
  });

  it('keys an IDN by its punycode form, from either spelling', () => {
    expect(toAscii('  HTTPS://Münich.DE./ ')).toBe('xn--mnich-kva.de');
    expect(toAscii('xn--mnich-kva.de')).toBe('xn--mnich-kva.de');
    expect(toUnicode('xn--mnich-kva.de')).toBe('münich.de');
    expect(isIdn('münich.de')).toBe(true);
    expect(isIdn('xn--mnich-kva.de')).toBe(true);
    expect(isIdn('example.com')).toBe(false);
  });

  it('accepts a real name and rejects what is not one', () => {
    expect(assertDomainName('Münich.de')).toBe('xn--mnich-kva.de');
    expect(assertDomainName('a-b.co.uk')).toBe('a-b.co.uk');
    for (const bad of ['nope', 'a b.com', 'example.com/path', '-a.com', '']) {
      expect(() => assertDomainName(bad)).toThrow(/not a domain name/);
    }
    expect(() => assertDomainName(`${'a'.repeat(64)}.com`)).toThrow();
  });
});

// Ported from the DNS.Tools idn tests: toAscii / toUnicode / isIdn across
// scripts, case, bare TLDs, leading dots, and non-domain input.
describe('idn / punycode', () => {
  describe('toAscii', () => {
    it('converts Unicode names to punycode', () => {
      expect(toAscii('亚马逊.中文网')).toBe('xn--jlq480n2rg.xn--fiq228c5hs');
      expect(toAscii('билеты.сайт')).toBe('xn--90aiim0b4c.xn--80aswg');
      expect(toAscii('insytful.集团')).toBe('insytful.xn--3bst00m');
      expect(toAscii('bücher.de')).toBe('xn--bcher-kva.de');
      expect(toAscii('café.fr')).toBe('xn--caf-dma.fr');
    });

    it('keeps ASCII names, lowercased', () => {
      expect(toAscii('example.com')).toBe('example.com');
      expect(toAscii('sub.example.com')).toBe('sub.example.com');
      expect(toAscii('example.co.uk')).toBe('example.co.uk');
      expect(toAscii('EXAMPLE.COM')).toBe('example.com');
      expect(toAscii('ExAmPlE.cOm')).toBe('example.com');
    });

    it('leaves punycode as punycode', () => {
      expect(toAscii('xn--90aiim0b4c.xn--80aswg')).toBe(
        'xn--90aiim0b4c.xn--80aswg',
      );
      expect(toAscii('xn--bcher-kva.de')).toBe('xn--bcher-kva.de');
      expect(toAscii('xn--caf-dma.fr')).toBe('xn--caf-dma.fr');
      expect(toAscii('XN--BCHER-KVA.DE')).toBe('xn--bcher-kva.de');
    });

    it('lowercases mixed-case Unicode input', () => {
      expect(toAscii('InSyTfUl.集团')).toBe('insytful.xn--3bst00m');
      expect(toAscii('BüCher.DE')).toBe('xn--bcher-kva.de');
      expect(toAscii('CAFÉ.fr')).toBe('xn--caf-dma.fr');
    });

    it('handles bare TLDs and leading dots', () => {
      expect(toAscii('集团')).toBe('xn--3bst00m');
      expect(toAscii('.集团')).toBe('xn--3bst00m');
      expect(toAscii('co.uk')).toBe('co.uk');
      expect(toAscii('.co.uk')).toBe('co.uk');
      expect(toAscii('CO.UK')).toBe('co.uk');
      expect(toAscii('.CO.UK')).toBe('co.uk');
    });
  });

  describe('toUnicode', () => {
    it('converts punycode to Unicode', () => {
      expect(toUnicode('xn--jlq480n2rg.xn--fiq228c5hs')).toBe('亚马逊.中文网');
      expect(toUnicode('xn--90aiim0b4c.xn--80aswg')).toBe('билеты.сайт');
      expect(toUnicode('insytful.xn--3bst00m')).toBe('insytful.集团');
      expect(toUnicode('xn--bcher-kva.de')).toBe('bücher.de');
      expect(toUnicode('xn--caf-dma.fr')).toBe('café.fr');
    });

    it('keeps ASCII names, lowercased', () => {
      expect(toUnicode('example.com')).toBe('example.com');
      expect(toUnicode('sub.example.com')).toBe('sub.example.com');
      expect(toUnicode('example.co.uk')).toBe('example.co.uk');
      expect(toUnicode('EXAMPLE.COM')).toBe('example.com');
      expect(toUnicode('ExAmPlE.cOm')).toBe('example.com');
    });

    it('lowercases every label', () => {
      expect(toUnicode('INSYTFUL.xn--3bst00m')).toBe('insytful.集团');
      expect(toUnicode('ExAmPlE.com')).toBe('example.com');
      expect(toUnicode('XN--BCHER-KVA.DE')).toBe('bücher.de');
      expect(toUnicode('xn--caf-dma.FR')).toBe('café.fr');
    });

    it('handles bare TLDs', () => {
      expect(toUnicode('xn--3bst00m')).toBe('集团');
      expect(toUnicode('.xn--3bst00m')).toBe('集团');
      expect(toUnicode('co.uk')).toBe('co.uk');
      expect(toUnicode('.co.uk')).toBe('co.uk');
      expect(toUnicode('XN--3BST00M')).toBe('集团');
      expect(toUnicode('CO.UK')).toBe('co.uk');
    });
  });

  describe('isIdn', () => {
    it('recognizes an IDN in either spelling and any case', () => {
      for (const idn of [
        '亚马逊.中文网',
        'билеты.сайт',
        'insytful.集团',
        'bücher.de',
        'café.fr',
        'xn--jlq480n2rg.xn--fiq228c5hs',
        'xn--90aiim0b4c.xn--80aswg',
        'insytful.xn--3bst00m',
        'xn--bcher-kva.de',
        'xn--caf-dma.fr',
        'XN--BCHER-KVA.DE',
        'InSyTfUl.集团',
        'BüCher.DE',
        'CAFÉ.fr',
      ]) {
        expect(isIdn(idn), idn).toBe(true);
      }
    });

    it('rejects plain ASCII names in any case', () => {
      for (const name of [
        'example.com',
        'sub.example.com',
        'example.co.uk',
        'insytful.com',
        'EXAMPLE.COM',
        'SUB.EXAMPLE.COM',
        'ExAmPlE.Co.Uk',
        'InSyTfUl.CoM',
      ]) {
        expect(isIdn(name), name).toBe(false);
      }
    });

    it('handles bare TLDs', () => {
      for (const tld of [
        '集团',
        '.集团',
        'xn--3bst00m',
        '.xn--3bst00m',
        'XN--3BST00M',
      ])
        expect(isIdn(tld), tld).toBe(true);
      for (const tld of ['com', '.com', 'co.uk', '.co.uk', 'COM', 'CO.UK'])
        expect(isIdn(tld), tld).toBe(false);
    });

    it('handles blank input, IP addresses, and URLs', () => {
      expect(isIdn('')).toBe(false);
      expect(isIdn('   ')).toBe(false);
      expect(isIdn('192.168.1.1')).toBe(false);
      expect(isIdn('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(false);
      expect(isIdn('http://bücher.de')).toBe(true);
      expect(isIdn('https://example.com/path')).toBe(false);
      expect(isIdn('HTTP://BÜCHER.DE')).toBe(true);
      expect(isIdn('HTTPS://EXAMPLE.COM/PATH')).toBe(false);
    });
  });
});
