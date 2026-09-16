import type {
  Contact,
  DnsRecord,
  RegistrarCredentials,
  RegistrarName,
} from '@aoxborrow/registrar-client';
import type { FolderColor } from '../../shared/ipc';
import { getBaseRenewal } from '../services/base-pricing';
import {
  authCodeFor,
  defaultNameservers,
  hash,
  type DemoDomainRecord,
} from './registrar';

// The demo portfolio: a plausible personal collection of a couple of hundred
// invented domains spread over several real registrars, generated
// deterministically from a seed so every visitor sees the same portfolio and
// a "reset" is just a regeneration. Names are made up; registrar names and
// renewal prices are real, so the pricing views show true numbers.
//
// Nothing here touches the store — `installDemo()` (index.ts) does that.

export interface DemoAccount {
  registrar: RegistrarName;
  /** The default account id is the registrar name (see services/accounts). */
  id: string;
  label: string;
  /** Obviously fake, but shaped like the real thing so the form pre-fills. */
  credentials: RegistrarCredentials;
  /** How many of the generated domains land here. */
  share: number;
}

export interface DemoFolder {
  name: string;
  color: FolderColor;
  description: string;
  /** Domain names assigned to it. */
  domains: string[];
}

export interface DemoSeed {
  accounts: DemoAccount[];
  records: DemoDomainRecord[];
  folders: DemoFolder[];
  /** `${accountId}:${domainName}` → USD, for the "manual price" source. */
  manualPrices: Record<string, number>;
}

export const DEFAULT_DEMO_SEED = 20260907;
export const DEFAULT_DEMO_SIZE = 184;
/** How many domains may share a name with another (on a different TLD). */
const MAX_LABEL_REPEATS = 2;

// ── the registrars in the demo ───────────────────────────────────────────────
// Shares sum to 1. Gandi, NameSilo, NameBright and Name.com are left
// unconfigured so the settings page shows both states.

const ACCOUNTS: Omit<DemoAccount, 'id'>[] = [
  {
    registrar: 'godaddy',
    label: 'Default',
    credentials: { apiToken: 'demo_gd_3f9a1c7e2b4d5a6f8e1c9b7d3a2f4e6c' },
    share: 0.36,
  },
  {
    registrar: 'porkbun',
    label: 'Default',
    credentials: {
      apiKey: 'pk1_demo_0c7d5b3a9e1f2c4d6b8a0e2f4c6d8a1b',
      secretApiKey: 'sk1_demo_8a2b4c6d0e2f4a6b8c0d2e4f6a8b0c2d',
    },
    share: 0.25,
  },
  {
    registrar: 'cloudflare',
    label: 'Default',
    credentials: {
      apiToken: 'demo_cf_Zt7Qk9x2Lm4Pv8Rw1Ny6Hb3Jd5Fg0Sc',
      accountId: '0123456789abcdef0123456789abcdef',
    },
    share: 0.17,
  },
  {
    registrar: 'dynadot',
    label: 'Default',
    credentials: {
      apiKey: 'demo_dyn_7f3e9c1a5b2d8e4f',
      apiSecret: 'demo_dyn_secret_2b8d4f6a1c3e5a7b',
    },
    share: 0.12,
  },
  {
    registrar: 'namecheap',
    label: 'Default',
    credentials: {
      username: 'demo-portfolio',
      apiKey: 'demo_nc_a1b2c3d4e5f60718293a4b5c6d7e8f90',
      clientIp: '203.0.113.42',
    },
    share: 0.06,
  },
  {
    registrar: 'spaceship',
    label: 'Default',
    credentials: {
      apiKey: 'demo_ss_5e7c9a1b3d5f7a9c',
      apiSecret: 'demo_ss_secret_1a3c5e7b9d2f4a6c',
    },
    share: 0.04,
  },
];

// ── vocabulary ───────────────────────────────────────────────────────────────
// Plain dictionary words, one per domain (a couple may recur on a second
// TLD, as real portfolios do). Deliberately no made-up compounds.

const WORDS = [
  'acorn',
  'alder',
  'almond',
  'amber',
  'anchor',
  'anvil',
  'apex',
  'apron',
  'arbor',
  'archer',
  'arrow',
  'ash',
  'aspen',
  'atlas',
  'aurora',
  'badger',
  'balsam',
  'bamboo',
  'banner',
  'barley',
  'basalt',
  'basin',
  'bay',
  'beacon',
  'beech',
  'bellow',
  'birch',
  'bison',
  'blaze',
  'bloom',
  'blossom',
  'bluff',
  'bolt',
  'boulder',
  'bramble',
  'brass',
  'breeze',
  'brick',
  'bridge',
  'brook',
  'bumble',
  'burrow',
  'cabin',
  'cactus',
  'cairn',
  'canopy',
  'canyon',
  'canvas',
  'cape',
  'caravan',
  'cardinal',
  'cargo',
  'cascade',
  'cedar',
  'cellar',
  'chalk',
  'chapel',
  'cider',
  'cinder',
  'cipher',
  'citrus',
  'clay',
  'cliff',
  'clover',
  'cobalt',
  'comet',
  'compass',
  'copper',
  'coral',
  'cove',
  'crane',
  'creek',
  'crest',
  'crimson',
  'crocus',
  'crystal',
  'current',
  'cypress',
  'dahlia',
  'daisy',
  'dawn',
  'delta',
  'dew',
  'dock',
  'dove',
  'drift',
  'dune',
  'dusk',
  'eagle',
  'ebb',
  'echo',
  'ember',
  'emerald',
  'ferry',
  'fable',
  'falcon',
  'fathom',
  'fern',
  'fig',
  'finch',
  'fjord',
  'flame',
  'flint',
  'flora',
  'forge',
  'fossil',
  'fountain',
  'fox',
  'frost',
  'galaxy',
  'garnet',
  'gale',
  'garden',
  'gazelle',
  'geyser',
  'ginger',
  'glacier',
  'glade',
  'glen',
  'granite',
  'grove',
  'gull',
  'gust',
  'harbor',
  'harvest',
  'hawk',
  'hazel',
  'heather',
  'heron',
  'hickory',
  'hollow',
  'honey',
  'horizon',
  'iris',
  'ivory',
  'ivy',
  'jade',
  'jasper',
  'jetty',
  'juniper',
  'kestrel',
  'kiln',
  'lagoon',
  'lantern',
  'larch',
  'lark',
  'lattice',
  'ledger',
  'lichen',
  'lilac',
  'linen',
  'lotus',
  'lumen',
  'lupine',
  'magnet',
  'mango',
  'maple',
  'marble',
  'marigold',
  'marsh',
  'meadow',
  'meridian',
  'mesa',
  'mica',
  'mineral',
  'mist',
  'monsoon',
  'moss',
  'moth',
  'nectar',
  'nettle',
  'nimbus',
  'north',
  'nova',
  'oak',
  'oasis',
  'ocean',
  'olive',
  'onyx',
  'opal',
  'orbit',
  'orchard',
  'oriole',
  'osprey',
  'otter',
  'oyster',
  'paddle',
  'pebble',
  'pelican',
  'peppermint',
  'petal',
  'pine',
  'pier',
  'pillar',
  'plum',
  'pollen',
  'poppy',
  'prairie',
  'prism',
  'puffin',
  'quail',
  'quartz',
  'quill',
  'quiver',
  'raven',
  'reef',
  'ridge',
  'river',
  'robin',
  'rook',
  'rowan',
  'rune',
  'saffron',
  'sage',
  'sandbar',
  'sapling',
  'scarlet',
  'sequoia',
  'shale',
  'shore',
  'sierra',
  'silk',
  'slate',
  'sorrel',
  'sparrow',
  'spruce',
  'starling',
  'summit',
  'sundial',
  'sycamore',
  'tamarind',
  'tern',
  'thistle',
  'thunder',
  'tide',
  'timber',
  'topaz',
  'trellis',
  'trout',
  'tulip',
  'tundra',
  'turret',
  'twilight',
  'umber',
  'valley',
  'velvet',
  'verdant',
  'vista',
  'walnut',
  'wander',
  'willow',
  'wren',
  'yarrow',
  'zenith',
  'zephyr',
  'zinnia',
];

// TLD weights: the shape of a real personal portfolio, .com-heavy with a tail.
const TLDS: [string, number][] = [
  ['com', 46],
  ['net', 6],
  ['org', 7],
  ['io', 9],
  ['dev', 6],
  ['app', 4],
  ['co', 5],
  ['ai', 3],
  ['xyz', 3],
  ['me', 3],
  ['sh', 1],
  ['design', 1],
  ['studio', 2],
  ['cafe', 1],
  ['club', 1],
  ['tech', 2],
];

const CLOUDFLARE_NS = [
  ['ada.ns.cloudflare.com', 'rob.ns.cloudflare.com'],
  ['gina.ns.cloudflare.com', 'kip.ns.cloudflare.com'],
  ['leah.ns.cloudflare.com', 'ivan.ns.cloudflare.com'],
];
const CUSTOM_NS = [
  ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
  ['dns1.p03.nsone.net', 'dns2.p03.nsone.net', 'dns3.p03.nsone.net'],
  ['ns-1234.awsdns-27.org', 'ns-567.awsdns-06.net', 'ns-89.awsdns-11.com'],
  ['ns1.digitalocean.com', 'ns2.digitalocean.com', 'ns3.digitalocean.com'],
  ['ns1.hover.com', 'ns2.hover.com'],
];

const REGISTRANT: Contact = {
  firstName: 'Alex',
  lastName: 'Rivera',
  organization: 'Rivera Digital LLC',
  email: 'domains@example.com',
  phone: '+1.5035550142',
  address1: '2140 SE Division St',
  address2: 'Suite 210',
  city: 'Portland',
  state: 'OR',
  postalCode: '97202',
  country: 'US',
};

// ── generator ────────────────────────────────────────────────────────────────

/** mulberry32: small, fast, good enough for a demo. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)];
}

function weighted(r: () => number, entries: [string, number][]): string {
  const total = entries.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [v, w] of entries) {
    x -= w;
    if (x < 0) return v;
  }
  return entries[entries.length - 1][0];
}

function makeLabel(r: () => number): string {
  return pick(r, WORDS);
}

/** A TLD the registrar actually prices, so every row has a real renewal. */
function pickTld(r: () => number, registrar: RegistrarName): string {
  for (let i = 0; i < 8; i++) {
    const tld = weighted(r, TLDS);
    if (getBaseRenewal(registrar, tld) !== null) return tld;
  }
  return 'com';
}

function pickNameservers(r: () => number, registrar: RegistrarName): string[] {
  const roll = r();
  if (registrar === 'cloudflare' || roll < 0.55) {
    return registrar === 'cloudflare'
      ? [...pick(r, CLOUDFLARE_NS)]
      : defaultNameservers(registrar);
  }
  if (roll < 0.8) return [...pick(r, CLOUDFLARE_NS)];
  return [...pick(r, CUSTOM_NS)];
}

function dnsFor(
  r: () => number,
  domainName: string,
  ns: string[],
): DnsRecord[] {
  // Registrar-hosted DNS gets a few records; delegated-away domains get none.
  const hosted = ns.some(
    (n) => !n.includes('cloudflare') && !CUSTOM_NS.some((c) => c.includes(n)),
  );
  if (!hosted) return [];
  const ip = `203.0.113.${(hash(domainName) % 200) + 10}`;
  const out: DnsRecord[] = [
    { type: 'A', name: '@', value: ip, ttl: 3600 },
    { type: 'CNAME', name: 'www', value: `${domainName}.`, ttl: 3600 },
  ];
  if (r() < 0.45) {
    out.push(
      {
        type: 'MX',
        name: '@',
        value: `aspmx.l.google.com.`,
        ttl: 3600,
        priority: 1,
      },
      {
        type: 'MX',
        name: '@',
        value: `alt1.aspmx.l.google.com.`,
        ttl: 3600,
        priority: 5,
      },
      {
        type: 'TXT',
        name: '@',
        value: 'v=spf1 include:_spf.google.com ~all',
        ttl: 3600,
      },
    );
  }
  return out;
}

/**
 * Builds the demo dataset. `size` domains are dealt across the configured
 * accounts by share; the same seed always yields the same portfolio.
 */
export function generateDemoSeed(
  seed = DEFAULT_DEMO_SEED,
  size = DEFAULT_DEMO_SIZE,
  now = new Date('2026-09-07T12:00:00Z'),
): DemoSeed {
  const r = rng(seed);
  const accounts: DemoAccount[] = ACCOUNTS.map((a) => ({
    ...a,
    id: a.registrar,
  }));
  const records: DemoDomainRecord[] = [];
  const used = new Set<string>();
  const usedLabels = new Set<string>();
  let repeats = 0;
  const dayMs = 24 * 60 * 60 * 1000;

  // Deal domains to accounts by share (largest remainder keeps the total exact).
  const quotas = accounts.map((a) => Math.floor(a.share * size));
  let left = size - quotas.reduce((n, q) => n + q, 0);
  for (let i = 0; left > 0; i = (i + 1) % quotas.length, left--) quotas[i]++;

  accounts.forEach((account, ai) => {
    for (let i = 0; i < quotas[ai]; i++) {
      let domainName = '';
      for (let tries = 0; tries < 200; tries++) {
        const label = makeLabel(r);
        const candidate = `${label}.${pickTld(r, account.registrar)}`;
        if (used.has(candidate)) continue;
        if (usedLabels.has(label)) {
          if (repeats >= MAX_LABEL_REPEATS) continue;
          repeats++;
        }
        domainName = candidate;
        break;
      }
      if (!domainName) continue;
      used.add(domainName);
      usedLabels.add(domainName.slice(0, domainName.indexOf('.')));

      // Expiry: most within the next 18 months, a handful overdue/grace, a
      // few far out (multi-year renewals). Created 1–9 years ago.
      const roll = r();
      const daysOut =
        roll < 0.05
          ? -Math.floor(r() * 25) - 1
          : roll < 0.15
            ? Math.floor(r() * 30)
            : roll < 0.85
              ? 30 + Math.floor(r() * 520)
              : 550 + Math.floor(r() * 1500);
      const expirationDate = new Date(now.getTime() + daysOut * dayMs);
      // Registered 1–9 years before expiry, but never in the future: a
      // multi-year renewal pushes expiry out without moving the birthday.
      const ageYears = 1 + Math.floor(r() * 9);
      const createdDate = new Date(
        Math.min(
          expirationDate.getTime() -
            ageYears * 365.25 * dayMs -
            Math.floor(r() * 300) * dayMs,
          now.getTime() - (45 + Math.floor(r() * 400)) * dayMs,
        ),
      );
      const nameservers = pickNameservers(r, account.registrar);
      const parked =
        nameservers[0] === defaultNameservers(account.registrar)[0] &&
        r() < 0.5;

      records.push({
        domainName,
        registrar: account.registrar,
        accountId: account.id,
        status: daysOut < 0 ? 'expired' : 'active',
        createdDate,
        expirationDate,
        autoRenew: r() < 0.7,
        locked: r() < 0.85,
        privacy: r() < 0.8,
        nameservers,
        contacts: {
          registrant: { ...REGISTRANT },
          admin: { ...REGISTRANT },
          tech: { ...REGISTRANT },
          billing: { ...REGISTRANT },
        },
        dnsRecords: parked ? [] : dnsFor(r, domainName, nameservers),
        emailForwards:
          !parked && r() < 0.2
            ? [{ alias: 'hello', forwardTo: 'domains@example.com' }]
            : [],
        domainForwards:
          parked && r() < 0.4
            ? [
                {
                  host: '@',
                  url: 'https://riveradigital.example',
                  type: 'permanent',
                },
              ]
            : [],
        dnssec: {
          enabled: r() < 0.12,
          dsRecords: [],
        },
        authCode: authCodeFor(domainName),
      });
    }
  });
  for (const rec of records) {
    if (rec.dnssec.enabled) {
      rec.dnssec.dsRecords = [
        {
          keyTag: 2371 + (hash(rec.domainName) % 60000),
          algorithm: 13,
          digestType: 2,
          digest: hash(rec.domainName + 'ds')
            .toString(16)
            .padStart(8, '0')
            .repeat(8),
        },
      ];
    }
  }

  // Folders: a few themes, each holding a slice of the portfolio.
  const names = records.map((x) => x.domainName);
  const byTld = (tlds: string[]) =>
    names.filter((n) => tlds.includes(n.slice(n.indexOf('.') + 1)));
  const folders: DemoFolder[] = [
    {
      name: 'Client sites',
      color: 'blue',
      description: 'Managed on behalf of clients',
      domains: byTld(['studio', 'design', 'cafe', 'co']).concat(
        names.filter((_, i) => i % 13 === 4).slice(0, 8),
      ),
    },
    {
      name: 'Side projects',
      color: 'violet',
      description: 'Things that shipped, or nearly did',
      domains: byTld(['dev', 'app', 'sh', 'tech']),
    },
    {
      name: 'Keepers',
      color: 'green',
      description: 'Never let these lapse',
      domains: names.filter((_, i) => i % 9 === 0).slice(0, 14),
    },
    {
      name: 'For sale',
      color: 'amber',
      description: 'Listed, or should be',
      domains: names.filter((_, i) => i % 11 === 3).slice(0, 12),
    },
  ];
  // A domain lives in one folder at most; earlier folders win.
  const taken = new Set<string>();
  for (const f of folders) {
    f.domains = f.domains.filter((d) => !taken.has(d) && taken.add(d));
  }

  // Manual prices: the odd domain whose renewal the owner has overridden.
  const manualPrices: Record<string, number> = {};
  for (const rec of records.filter((_, i) => i % 23 === 5).slice(0, 6)) {
    const base = getBaseRenewal(
      rec.registrar,
      rec.domainName.slice(rec.domainName.indexOf('.') + 1),
    );
    manualPrices[`${rec.accountId}:${rec.domainName}`] =
      Math.round((base ?? 12) * (0.8 + r() * 0.5) * 100) / 100;
  }

  return { accounts, records, folders, manualPrices };
}
