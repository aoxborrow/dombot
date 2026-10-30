import { z } from 'zod';
import type { DombotApi, DomainTarget, RegistrarName } from '../../shared/ipc';
import {
  coreMethods,
  invoke,
  method,
  type ApiMethod,
  type ApiMethodName,
  type ApiTable,
  type CoreMethodName,
} from '../../core/api';
import { setAppIdentity } from '../../core/app-info';
import {
  installDemo,
  type DemoInstallation,
  type DemoWorld,
} from '../../core/demo';
import { onCoreEvent } from '../../core/events';
import { setBulkAutoDrive } from '../../core/services/bulk-jobs';
import {
  getMergedPortfolio,
  getPortfolio,
} from '../../core/services/registrars';
import { listEvents } from '../../core/services/domain-events';
import { marketListings, syncMarkets } from '../../core/services/markets/sync';
import { marketAdapter } from '../../core/services/markets/accounts';
import { syncDomainTraffic } from '../../core/services/markets/traffic';
import { DomainEventSource, localDay } from '../../shared/domain-events';
import { applyDomainOp } from '../../core/services/domain-ops';
import { setDispositions } from '../../core/services/domain-history';
import { setNotes, setPurchase, setSale } from '../../core/services/purchases';
import { setManualPrice } from '../../core/services/pricing';
import { addImportedDomains } from '../../core/services/imported-domains';
import { MemoryDocStore } from '../../core/storage/doc-store';
import { configureStore, hydrateStores } from '../../core/storage/namespace';
import pkg from '../../../package.json';
import { openExternalInBrowser, saveTextFileInBrowser } from './http';

// `window.api` for the demo build: the whole core runs inside the page, over
// an in-memory store, against the in-memory registrar (src/core/demo). This
// is the third host after the Electron preload bridge and the HTTP client —
// and the simplest: every method call goes straight into the same validated
// method table the other two hosts dispatch through, with no transport, so
// Dates and events don't need reviving or polling. Bulk jobs auto-drive
// in-process exactly as on the desktop.
//
// Nothing here persists: a reload regenerates the portfolio from the seed.

export const DEMO_VERSION: string = pkg.version;

const none = z.tuple([]);

/** The host-specific half of the table (cf. src/worker/api.ts). */
const DEMO_UPDATE = {
  supported: false,
  unsupportedReason: 'The demo doesn’t update.',
  status: 'idle' as const,
  error: null,
};

const demoMethods: Omit<ApiTable, CoreMethodName> = {
  ping: method(none, async () => 'pong'),
  getUpdaterState: method(none, async () => DEMO_UPDATE),
  downloadUpdate: method(none, async () => DEMO_UPDATE),
  installUpdate: method(none, async () => {}),
  getAppInfo: method(none, async () => ({
    name: 'DomBot',
    version: DEMO_VERSION,
    electron: '',
    chrome: '',
    node: '',
    platform: 'web' as const,
  })),
  openExternal: method(z.tuple([z.string()]), async (url) => {
    openExternalInBrowser(url);
  }),
  saveTextFile: method(z.tuple([z.string(), z.string()]), async (c, n) =>
    saveTextFileInBrowser(c, n),
  ),
  // No MCP server in a static page; the settings tab is hidden in the demo.
  getMcpInfo: method(none, async () => ({
    running: false,
    url: '',
    stdioCommand: '',
    stdioArgs: [],
  })),
};

export interface DemoApiOptions {
  /** Per-call latency of the fake registrar, ms. Default 150. */
  latencyMs?: number;
  /** Portfolio size. Default: the seed's. */
  size?: number;
  /**
   * After the baseline sync, drop one sample name, move one between accounts,
   * and add one. The browser demo uses this so the alerts can be clicked
   * without touching a real registrar.
   */
  sampleChanges?: boolean;
}

export interface DemoApi {
  api: DombotApi;
  demo: DemoInstallation;
}

/**
 * Changes after the baseline sync, so every kind of alert shows: departures
 * from several accounts, arrivals, and a move.
 */
function stageSampleChanges(world: DemoWorld): void {
  const records = world.all();
  const of = (registrar: string) =>
    records.filter((record) => record.registrar === registrar);
  const godaddy = of('godaddy');
  const porkbun = of('porkbun');
  if (godaddy.length < 3 || porkbun.length < 2) return;

  // Departures: the last name in several accounts.
  for (const registrar of ['godaddy', 'namecheap', 'cloudflare', 'dynadot']) {
    const list = of(registrar);
    if (list.length > 0) world.remove(list[list.length - 1].domainName);
  }

  const moving = godaddy[0];
  world.remove(moving.domainName);
  world.add({
    ...moving,
    registrar: porkbun[0].registrar,
    accountId: porkbun[0].accountId,
  });

  // Arrivals: fresh registrations in two accounts.
  const now = new Date();
  const arrive = (domainName: string, host: (typeof records)[number]) => {
    world.remove(domainName);
    world.add({
      ...host,
      domainName,
      createdDate: now,
      expirationDate: new Date(now.getTime() + 365.25 * 24 * 60 * 60 * 1000),
      nameservers: [...host.nameservers],
      dnsRecords: [],
      emailForwards: [],
      domainForwards: [],
    });
  };
  arrive('just-registered.com', godaddy[1]);
  arrive('fresh-find.io', porkbun[1]);
  arrive('new-brand.co', godaddy[2]);
}

/**
 * Some answered alerts and recorded purchases, so Activity shows history
 * beside what still needs review.
 */
function recordSampleHistory(): void {
  const departures = listEvents().filter((e) => e.type === 'removed');
  const [sold, dropped] = departures;
  if (sold) {
    setSale({
      domainName: sold.domain,
      saleDate: localDay(),
      amount: '2500',
      currency: 'USD',
      notes: '',
      mark: true,
      resolves: sold.id,
    });
  }
  if (dropped) {
    setDispositions(
      [{ domainName: dropped.domain, resolves: dropped.id }],
      'dropped',
    );
  }
  const owned = getMergedPortfolio().domains.map((d) => d.domainName);
  const day = (daysAgo: number) => localDay(Date.now() - daysAgo * 86_400_000);
  owned.slice(3, 5).forEach((domainName, i) =>
    setPurchase({
      domainName,
      purchaseDate: day(20 + i * 40),
      amount: i === 0 ? '1200' : '85',
      currency: 'USD',
      notes: '',
    }),
  );
}

/**
 * One renewal price in another currency: Renewals lists it beside the dollar
 * totals. (Asking prices come with the seed: core/demo.)
 */
function recordSampleRenewalPrice(): void {
  const owned = getMergedPortfolio().domains.map((d) => d.domainName);
  if (owned[1]) setManualPrice(owned[1], { amount: '45', currency: 'EUR' });
}

/** Notes a portfolio owner keeps, put on a spread of names. */
const SAMPLE_NOTES = [
  'Buyer emailed 2026-08 asking for a price; offered $4k, no reply yet.',
  'Bought at NameJet. Strong .com, hold for end user.',
  'Renew even if unsold: it forwards to the old shop.',
  'Brandable shortlist. Try Atom Premium next round?',
  'Inbound offer via Afternic at $1,200 declined. Floor $2,500.',
  'Old side project. Keep until the redirect traffic dies down.',
  'Trademark check done (clear in US/EU).',
  'Was parked at Sedo; moved listing to Afternic for Fast Transfer.',
  'Price high on purpose; comps at $8–12k.',
  'Expiring soon: decide on renewal by next month.',
] as const;

/**
 * Notes on ten names, a few of them on the first page of Domains (sorted by
 * name), so the notes icon shows without scrolling.
 */
function recordSampleNotes(): void {
  const owned = getMergedPortfolio()
    .domains.map((d) => d.domainName)
    .sort((a, b) => a.localeCompare(b));
  [1, 6, 13, 27, 44, 70, 103, 140, 182, 220].forEach((at, i) => {
    const domainName = owned[at];
    if (domainName) setNotes(domainName, SAMPLE_NOTES[i]);
  });
}

/**
 * Two names you added by hand: one at Gandi (a registrar DomBot supports,
 * and the demo also syncs a Gandi account, so both show), one at a
 * registrar it doesn't know.
 */
function recordSampleImportedDomains(): void {
  const day = (daysAhead: number) =>
    localDay(Date.now() + daysAhead * 86_400_000);
  addImportedDomains(
    [
      {
        domainName: 'harborlight.com',
        fields: {
          registrar: 'gandi',
          createdDate: '2019-04-02',
          expirationDate: day(140),
          autoRenew: true,
        },
      },
      {
        domainName: 'quietfield.net',
        fields: {
          registrarLabel: 'Epik',
          expirationDate: day(45),
          autoRenew: false,
        },
      },
    ],
    { source: 'user' },
  );
}

/**
 * A few settings changed through the real write path, so Activity shows
 * Changed rows from you and from an agent: auto-renew off on two names
 * (letting them go), privacy on, and nameservers moved.
 */
async function recordSampleSettingsChanges(): Promise<void> {
  // Names from the middle of accounts whose API changes all four, clear of
  // the ones the sample departures and moves take.
  const names = getMergedPortfolio().domains.filter(
    (d) => d.registrar === 'namecheap' || d.registrar === 'dynadot',
  );
  const pick = (at: number) => names[Math.floor((names.length * at) / 10)];
  const targetOf = (d: (typeof names)[number]): DomainTarget => ({
    registrar: d.registrar as RegistrarName,
    accountId: d.accountId,
    domainName: d.domainName,
  });
  const letGo = [pick(2), pick(5)].filter((d) => d?.autoRenew);
  for (const d of letGo)
    await applyDomainOp(targetOf(d), { kind: 'autoRenew', enabled: false });
  const privacy = names
    .slice(Math.floor(names.length * 0.3))
    .find((d) => !d.privacy && !letGo.includes(d));
  if (privacy)
    await applyDomainOp(targetOf(privacy), { kind: 'privacy', enabled: true });
  const moved = pick(7);
  if (moved)
    await applyDomainOp(
      targetOf(moved),
      {
        kind: 'nameservers',
        nameservers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
      },
      { source: DomainEventSource.Agent },
    );
}

/**
 * Boots a fresh in-memory core, installs the demo, runs the first sync so
 * the portfolio is full before anything renders, and returns the API.
 */
export async function createDemoApi(
  options: DemoApiOptions = {},
): Promise<DemoApi> {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  setAppIdentity({ version: DEMO_VERSION, platform: 'web' });
  setBulkAutoDrive(true);
  // Boot at full speed — the first sync happens before anything renders —
  // then pace the registrar so interactive work (bulk jobs, detail fetches)
  // looks like the real thing.
  const demo = await installDemo({ latencyMs: 0, size: options.size });
  await getPortfolio(true);
  // After the portfolio, so market sales know which names you still hold.
  await syncMarkets();
  // A real sync fetches per-name traffic a slice at a time; the demo has it
  // all from the start.
  for (const accountId of new Set(marketListings().map((l) => l.accountId))) {
    await syncDomainTraffic(
      marketAdapter(accountId),
      marketListings().filter((l) => l.accountId === accountId),
      Infinity,
    );
  }
  recordSampleRenewalPrice();
  recordSampleNotes();
  recordSampleImportedDomains();
  if (options.sampleChanges) {
    await recordSampleSettingsChanges();
    stageSampleChanges(demo.world);
    await getPortfolio(true);
    recordSampleHistory();
  }
  demo.setLatency(options.latencyMs ?? 150);

  const table: ApiTable = { ...coreMethods, ...demoMethods };
  const api: Record<string, unknown> = {};
  for (const name of Object.keys(table) as ApiMethodName[]) {
    api[name] = (...args: unknown[]) =>
      invoke(name, table[name] as ApiMethod, args);
  }
  const events: Pick<
    DombotApi,
    | 'onBulkProgress'
    | 'onBulkFinished'
    | 'onApprovalsChanged'
    | 'onPortfolioChanged'
    | 'onSyncRequested'
    | 'onNavigateRequested'
  > = {
    onBulkProgress: (cb) => onCoreEvent('bulkProgress', cb),
    onBulkFinished: (cb) => onCoreEvent('bulkFinished', cb),
    onApprovalsChanged: (cb) => onCoreEvent('approvalsChanged', cb),
    onPortfolioChanged: (cb) => onCoreEvent('portfolioChanged', cb),
    // No app menu in the browser.
    onSyncRequested: () => () => {},
    onNavigateRequested: () => () => {},
  };
  return { api: { ...api, ...events } as DombotApi, demo };
}
