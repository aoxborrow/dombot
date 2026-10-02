import { describe, expect, it } from 'vitest';
import { registrars } from '@aoxborrow/registrar-client';
import ianaData from '../../../data/iana-registrars.json';
import mappingData from '../../../data/registrar-mapping.json';
import {
  registrarNameKeys,
  resolveRegistrar,
  type RegistrarMappingEntry,
} from './registrar-mapping';

const mapping = mappingData as Record<string, RegistrarMappingEntry>;
const iana = new Map(
  (ianaData.registrars as [number, string, string][]).map(([id, name]) => [
    id,
    name,
  ]),
);

describe('registrarNameKeys', () => {
  it('ignores case, punctuation and trailing legal suffixes', () => {
    expect(registrarNameKeys('Name.com, Inc.')).toEqual(['namecom']);
    expect(registrarNameKeys('NAME.COM INC')).toEqual(['namecom']);
    expect(registrarNameKeys('Gandi SAS')).toEqual(['gandi']);
    expect(registrarNameKeys('EuroDNS S.A.')).toEqual(['eurodns']);
    expect(registrarNameKeys('NameSecure L.L.C.')).toEqual(['namesecure']);
    expect(registrarNameKeys('INWX GmbH & Co. KG')).toEqual(['inwx']);
  });

  it('keeps a suffix-like word inside the name', () => {
    expect(registrarNameKeys('Hello.co')).toEqual(['helloco']);
    expect(registrarNameKeys('Atlas')).toEqual(['atlas']);
  });

  it('strips accents and Nominet tags', () => {
    expect(registrarNameKeys('Société Ëxample SARL')).toEqual([
      'societeexample',
    ]);
    expect(registrarNameKeys('Coherent Limited [Tag = COHERENT-NZ]')).toEqual([
      'coherent',
    ]);
  });

  it('adds each side of a trading-as clause', () => {
    expect(
      registrarNameKeys('Dynadot, LLC t/a Dynadot [Tag = DYNADOT]'),
    ).toEqual(['dynadotllctadynadot', 'dynadot']);
    expect(registrarNameKeys('8648255 CANADA LTD. O/A Dynadot LLC')).toContain(
      'dynadot',
    );
  });
});

describe('resolveRegistrar', () => {
  it('maps an IANA ID to a built-in registrar', () => {
    expect(resolveRegistrar({ ianaId: 625, name: 'Name.com, Inc.' })).toEqual({
      registrar: 'namecom',
      label: 'Name.com',
    });
    expect(resolveRegistrar({ ianaId: 440 })).toEqual({
      registrar: 'godaddy',
      label: 'GoDaddy',
    });
  });

  it('maps shell entities to their registrar', () => {
    expect(resolveRegistrar({ ianaId: 1559 })?.registrar).toBe('dynadot');
    expect(
      resolveRegistrar({ ianaId: 3546, name: 'DropCatch.com 1337 LLC' }),
    ).toEqual({ registrar: null, label: 'DropCatch.com' });
  });

  it('prefers the ID over the name', () => {
    expect(
      resolveRegistrar({ ianaId: 1068, name: 'GoDaddy.com, LLC' }),
    ).toMatchObject({ registrar: 'namecheap' });
  });

  it('matches a name with no ID', () => {
    expect(resolveRegistrar({ name: 'NAMECHEAP INC' })).toEqual({
      registrar: 'namecheap',
      label: 'Namecheap',
    });
    expect(
      resolveRegistrar({ name: 'Dynadot, LLC t/a Dynadot [Tag = DYNADOT]' }),
    )?.toMatchObject({ registrar: 'dynadot' });
  });

  it('shows a mapped reseller instead of its upstream registrar', () => {
    expect(
      resolveRegistrar({
        ianaId: 269,
        name: 'Key-Systems GmbH',
        reseller: 'iwantmyname',
      }),
    ).toEqual({ registrar: null, label: 'iwantmyname' });
    expect(resolveRegistrar({ ianaId: 69, reseller: 'Hover' })?.label).toBe(
      'Hover',
    );
  });

  it('ignores a reseller it has no mapping for', () => {
    expect(
      resolveRegistrar({ ianaId: 1068, reseller: 'Some Web Host LLC' }),
    ).toMatchObject({ registrar: 'namecheap', label: 'Namecheap' });
  });

  // WHOIS often has only the `Registrar:` string, or an ID we can't parse.
  it.each([
    ['GoDaddy.com, LLC', 'GoDaddy'],
    ['Uniregistrar Corp', 'GoDaddy'],
    ['Wild West Domains, LLC', 'GoDaddy'],
    ['Google LLC', 'Squarespace'],
    ['1&1 IONOS SE', 'IONOS'],
    ['TurnCommerce, Inc. DBA NameBright.com', 'NameBright'],
    ['CanSpace Solutions Inc.', 'CanSpace'],
    ['DNC Holdings, Inc.', 'Directnic'],
    ['Gransy, s.r.o.', 'Regtons'],
    ['Dotster, Inc.', 'Domain.com'],
    ['Reg.com', 'Reg.ru'],
  ])('maps the WHOIS string %s to %s', (name, label) => {
    expect(resolveRegistrar({ name })?.label).toBe(label);
  });

  // Entries with no IANA ID at all: resellers and ccTLD-only registrars.
  it.each([
    ['iwantmyname', 'iwantmyname'],
    ['HOVER', 'Hover'],
    ['NearlyFreeSpeech.NET', 'NearlyFreeSpeech'],
    ['Synergy Wholesale Pty Ltd', 'Synergy Wholesale'],
    ['Dynadot, LLC t/a Dynadot [Tag = DYNADOT]', 'Dynadot'],
  ])('maps the name-only alias %s to %s', (name, label) => {
    expect(resolveRegistrar({ name })?.label).toBe(label);
  });

  it("falls back to IANA's name, then the raw name", () => {
    const unmapped = [...iana.keys()].find(
      (id) => !Object.values(mapping).some((e) => e.ianaIds.includes(id)),
    );
    expect(unmapped).toBeDefined();
    expect(
      resolveRegistrar({ ianaId: unmapped, name: 'Whatever Ltd' }),
    ).toEqual({ registrar: null, label: iana.get(unmapped as number) });
    expect(resolveRegistrar({ name: '  Some ccTLD Registrar ' })).toEqual({
      registrar: null,
      label: 'Some ccTLD Registrar',
    });
    expect(resolveRegistrar({ ianaId: null, name: null })).toBeNull();
  });
});

describe('registrar data', () => {
  it('lists every mapped IANA ID in the IANA registry, under one registrar', () => {
    const seen = new Map<number, string>();
    for (const [key, entry] of Object.entries(mapping)) {
      for (const id of entry.ianaIds) {
        expect(iana.has(id), `${key}: unknown IANA ID ${id}`).toBe(true);
        expect(seen.get(id), `IANA ID ${id} under two registrars`).toBe(
          undefined,
        );
        seen.set(id, key);
      }
    }
  });

  it('maps every built-in registrar, by its registrar-client name', () => {
    for (const [key, info] of Object.entries(registrars)) {
      const entry = mapping[key];
      expect(entry, `no mapping for ${key}`).toBeDefined();
      expect(entry.name).toBe(info.displayName);
      expect(entry.ianaIds.length).toBeGreaterThan(0);
    }
  });

  it("doesn't give one name to two registrars", () => {
    const owner = new Map<string, string>();
    for (const [key, entry] of Object.entries(mapping)) {
      const names = [
        entry.name,
        ...(entry.names ?? []),
        ...entry.ianaIds.map((id) => iana.get(id) ?? ''),
      ];
      for (const name of names) {
        const whole = registrarNameKeys(name)[0];
        if (!whole) continue;
        const other = owner.get(whole);
        expect(
          other === undefined || other === key,
          `"${name}": ${other} and ${key}`,
        ).toBe(true);
        owner.set(whole, key);
      }
    }
  });

  it('keeps valid patterns', () => {
    for (const entry of Object.values(mapping))
      for (const pattern of entry.patterns ?? [])
        expect(() => new RegExp(pattern)).not.toThrow();
  });
});
