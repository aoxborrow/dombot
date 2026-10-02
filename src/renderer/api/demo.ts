import { z } from 'zod';
import type { DombotApi } from '../../shared/ipc';
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
import { localDay } from '../../shared/domain-events';
import { setDispositions } from '../../core/services/domain-history';
import { setPurchase, setSale } from '../../core/services/purchases';
import { setAskingPrices } from '../../core/services/asking-prices';
import { setManualPrice } from '../../core/services/pricing';
import { addManualDomains } from '../../core/services/manual-domains';
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
const demoMethods: Omit<ApiTable, CoreMethodName> = {
  ping: method(none, async () => 'pong'),
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
 * Asking prices on a few names, so the Asking column has something in it,
 * and one renewal price in another currency.
 */
function recordSampleAskingPrices(): void {
  const owned = getMergedPortfolio().domains.map((d) => d.domainName);
  const samples = [
    { amount: '4800', minOffer: '1500', floor: '2500', currency: 'USD' },
    { amount: '12500', minOffer: '5000', floor: null, currency: 'USD' },
    { amount: '950', minOffer: null, floor: null, currency: 'EUR' },
    { amount: null, minOffer: '250', floor: null, currency: 'USD' },
  ];
  setAskingPrices(
    samples
      .map((s, i) => ({ domainName: owned[i * 2], ...s }))
      .filter((s) => s.domainName),
  );
  // A renewal price in euros: Renewals lists it beside the dollar totals.
  if (owned[1]) setManualPrice(owned[1], { amount: '45', currency: 'EUR' });
}

/**
 * Two names you added by hand: one at a registrar DomBot supports but you
 * haven't connected, one at a registrar it doesn't know.
 */
function recordSampleManualDomains(): void {
  const day = (daysAhead: number) =>
    localDay(Date.now() + daysAhead * 86_400_000);
  addManualDomains(
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
  recordSampleAskingPrices();
  recordSampleManualDomains();
  if (options.sampleChanges) {
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
  > = {
    onBulkProgress: (cb) => onCoreEvent('bulkProgress', cb),
    onBulkFinished: (cb) => onCoreEvent('bulkFinished', cb),
    onApprovalsChanged: (cb) => onCoreEvent('approvalsChanged', cb),
    onPortfolioChanged: (cb) => onCoreEvent('portfolioChanged', cb),
    // No app menu in the browser.
    onSyncRequested: () => () => {},
  };
  return { api: { ...api, ...events } as DombotApi, demo };
}
