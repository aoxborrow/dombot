import { create } from 'zustand';
import type {
  Aftermarket,
  AppInfo,
  AppSettings,
  Domain,
  Folder,
  FolderInput,
  FolderPatch,
  McpInfo,
  PortfolioErrorInfo,
  RegistrarMeta,
  RegistrarName,
  RegistrarSync,
  RenewalPricing,
} from '../../shared/ipc';

/** Stable per-domain key across registrars. */
const domainKey = (d: Domain): string => `${d.registrar}:${d.domainName}`;

/** Hard ceiling on any sync — if the main-process fetch hangs (a registrar API
 * that never responds), reject so the "Syncing…" state can't stick forever. */
const SYNC_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
function withSyncTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Sync timed out after 5 minutes')),
      SYNC_TIMEOUT_MS,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// Tracks detail fetches in flight so concurrent enrich calls don't duplicate
// work, and ones that failed / have no detail so we don't retry them on every
// page revisit. Kept outside the store so they don't trigger re-renders.
const enrichInFlight = new Set<string>();
const enrichFailed = new Set<string>();

// Same idea for aftermarket lookups, keyed by domain name (DomDB is per-domain).
const marketInFlight = new Set<string>();
const marketDone = new Set<string>();

// Renewal-price lookups in flight, keyed by `${registrar}:${domainName}`.
const pricingInFlight = new Set<string>();

// Guards so the eager whole-portfolio loads don't overlap themselves (which
// would toggle their loading flag off while a pass is still running).
let detailAllInFlight = false;
let marketAllInFlight = false;

interface AppState {
  appInfo: AppInfo | null;
  mcpInfo: McpInfo | null;
  domains: Domain[];
  domainsLoading: boolean;
  domainsError: string | null;
  loadAppInfo: () => Promise<void>;
  loadMcpInfo: () => Promise<void>;
  loadDynadotDomains: () => Promise<void>;

  // Aggregated portfolio across every configured registrar.
  portfolio: Domain[];
  portfolioErrors: PortfolioErrorInfo[];
  portfolioRegistrars: string[];
  /** Map of registrar id → nicely capitalized display name. */
  portfolioRegistrarLabels: Record<string, string>;
  portfolioLoading: boolean;
  portfolioError: string | null;
  /** When the portfolio data was last fetched from the registrars (ms epoch),
   * or null. Comes from the cache on launch, or Date.now() on a live refresh. */
  portfolioLoadedAt: number | null;
  /** How the current portfolio arrived: restored from cache on launch, or a
   * live fetch. Gates work that should only follow an explicit refresh (e.g.
   * the Renewals page auto-fetching per-name prices). */
  portfolioSource: 'cache' | 'live' | null;
  /** Bumped on every live refresh so views can force-refresh their lazy data. */
  refreshTick: number;
  /** Live registrar metadata (configured flag + per-registrar sync state), from
   * `getRegistrarMetadata`. `null` until first loaded. Shared source of truth so
   * the Settings cards, status bar, and Domains empty state never disagree —
   * cached portfolio counts must not show when nothing is configured, and
   * configuring/syncing a registrar updates every surface immediately. */
  registrars: RegistrarMeta[] | null;
  /** Refresh `registrars` metadata from the main process. */
  loadRegistrars: () => Promise<void>;
  /** Sync one registrar's domains (e.g. after saving its credentials), merge the
   * result into the portfolio, refresh `registrars`, and return its sync state. */
  syncRegistrar: (name: RegistrarName) => Promise<RegistrarSync>;
  /** Restore portfolio + detail + aftermarket + pricing from the on-disk cache
   * with no network calls. Call once on app launch. */
  hydrateFromCache: () => Promise<void>;
  /** Re-read the portfolio + detail cache after an out-of-band write (an MCP
   * tool) and overlay the changes onto the current view, so an open Domains
   * table reflects them without a manual Sync. Unlike hydrateFromCache, this
   * runs regardless of `portfolioSource` and never blanks a live portfolio. */
  applyPortfolioCacheUpdate: () => Promise<void>;
  /** Drop every on-disk cache and reset the in-memory portfolio to empty, so
   * the app returns to its unloaded state and the next Load re-fetches fresh. */
  clearAllCaches: () => Promise<void>;
  loadPortfolio: () => Promise<void>;

  // Lazy per-domain detail (nameservers/privacy/lock), keyed by `${registrar}:${domainName}`.
  // Some registrars' list endpoints omit these; we fetch full detail only for
  // on-screen rows that the list left without nameservers. See `enrichVisible`.
  enriched: Record<string, Domain>;
  /** Domains whose detail fetch is currently in flight (for per-cell loading). */
  enriching: Record<string, boolean>;
  /** Fetch detail for on-screen rows. `force` re-fetches even cached rows and
   * bypasses the registrar/registry cache in main (used after a live refresh). */
  enrichVisible: (domains: Domain[], force?: boolean) => Promise<void>;
  /** True while a whole-portfolio detail (nameserver) load runs, so the
   * Nameservers filter can show that its groups aren't complete yet. */
  detailAllLoading: boolean;
  /** Enrich every domain still missing detail — the eager whole-portfolio load
   * that backs the Nameservers filter. */
  loadAllDetail: (domains: Domain[]) => Promise<void>;

  // Per-domain writes currently in flight, keyed `${registrar}:${domainName}`,
  // so a toggled cell can disable itself until the round trip settles.
  mutating: Record<string, boolean>;
  /**
   * Toggle a domain's auto-renew at its registrar. Optimistically updates the
   * merged view (via `enriched`), then rolls back and rethrows if the registrar
   * rejects — the caller surfaces the error.
   */
  setAutoRenew: (
    registrar: RegistrarName,
    domainName: string,
    enabled: boolean,
  ) => Promise<void>;

  // Aftermarket pricing (DomDB), keyed by domain name. `null` = fetched but
  // untracked/unavailable. `marketLoading` drives the Market cell's spinner.
  aftermarket: Record<string, Aftermarket | null>;
  marketLoading: Record<string, boolean>;
  /** Fetch aftermarket data for on-screen rows. `force` bypasses the on-disk
   * cache in main and re-fetches (used after a live refresh). */
  loadAftermarketVisible: (domains: Domain[], force?: boolean) => Promise<void>;
  /** True while a whole-portfolio aftermarket load runs, so the Price filter
   * can show that not every domain is priced yet. */
  marketAllLoading: boolean;
  /** Fetch aftermarket for every domain still missing it — the eager
   * whole-portfolio load that backs the Price filter. */
  loadAllMarket: (domains: Domain[]) => Promise<void>;

  // Annual renewal pricing, keyed by `${registrar}:${domainName}`. Backs the
  // Renewals dashboard; fetched for the whole portfolio at once (cached in main).
  pricing: Record<string, RenewalPricing>;
  pricingLoading: boolean;
  pricingLoadedAt: number | null;
  loadPricingAll: (domains: Domain[]) => Promise<void>;
  setManualPrice: (
    registrar: string,
    domain: string,
    price: number | null,
  ) => Promise<void>;
  refreshPricing: () => Promise<void>;

  // User-defined folders for organizing domains, plus the domain→folder map
  // (keyed `${registrar}:${domainName}`, the same key as `pricing`/`enriched`).
  // Folders are user data, not cache — `clearAllCaches` leaves them untouched.
  folders: Folder[];
  folderAssignments: Record<string, string>;
  /** Load folder definitions + assignments from disk. Called once on launch. */
  loadFolders: () => Promise<void>;
  createFolder: (input: FolderInput) => Promise<Folder>;
  updateFolder: (id: string, patch: FolderPatch) => Promise<void>;
  /** Delete a folder; also drops any local assignments pointing at it. */
  deleteFolder: (id: string) => Promise<void>;
  /** Assign a domain to a folder, or unassign it with a null folderId. */
  assignFolder: (domainKey: string, folderId: string | null) => Promise<void>;

  // User-adjustable app settings (e.g. the background-sync interval). `null`
  // until first loaded.
  settings: AppSettings | null;
  /** Load app settings from disk. Called once on launch. */
  loadSettings: () => Promise<void>;
  /** Set the background auto-sync interval in minutes (0 = off); applied live in
   * main. */
  setAutoSyncInterval: (minutes: number) => Promise<void>;
}

/** Global renderer store. Kept intentionally small — grow it as needed. */
export const useAppStore = create<AppState>((set, get) => ({
  appInfo: null,
  mcpInfo: null,
  domains: [],
  domainsLoading: false,
  domainsError: null,
  loadAppInfo: async () => {
    const appInfo = await window.api.getAppInfo();
    set({ appInfo });
  },
  loadMcpInfo: async () => {
    const mcpInfo = await window.api.getMcpInfo();
    set({ mcpInfo });
  },
  loadDynadotDomains: async () => {
    set({ domainsLoading: true, domainsError: null });
    try {
      const domains = await window.api.listDynadotDomains();
      set({ domains, domainsLoading: false });
    } catch (err) {
      set({
        domainsLoading: false,
        domainsError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  portfolio: [],
  portfolioErrors: [],
  portfolioRegistrars: [],
  portfolioRegistrarLabels: {},
  portfolioLoading: false,
  portfolioError: null,
  portfolioLoadedAt: null,
  portfolioSource: null,
  refreshTick: 0,
  registrars: null,

  loadRegistrars: async () => {
    set({ registrars: await window.api.getRegistrarMetadata() });
  },

  syncRegistrar: async (name) => {
    const result = await withSyncTimeout(window.api.syncRegistrar(name));
    // Merge the updated aggregate into the portfolio without disturbing other
    // registrars' lazily-loaded detail/pricing (those maps stay keyed by
    // registrar:domain and remain valid). A full "Sync domains" is what clears
    // them.
    set((state) => ({
      portfolio: result.domains,
      portfolioErrors: result.errors,
      portfolioRegistrars: result.registrars,
      portfolioRegistrarLabels: result.registrarLabels,
      portfolioLoadedAt: result.fetchedAt ?? Date.now(),
      portfolioSource: state.portfolioSource ?? 'live',
    }));
    // Refresh sync statuses (this registrar's lastSyncedAt/lastError) for the
    // Settings cards and the status-bar pill.
    await get().loadRegistrars();
    const meta = get().registrars?.find((r) => r.name === name);
    return (
      meta?.sync ?? { lastSyncedAt: null, lastError: null, domainCount: 0 }
    );
  },

  hydrateFromCache: async () => {
    // Only hydrate before any live load — never clobber fresher data.
    if (get().portfolioSource !== null || get().portfolioLoading) return;
    const snapshot = await window.api.hydrateFromCache();
    if (!snapshot.portfolio) return;
    // Don't overwrite a live load that landed while this was awaiting.
    if (get().portfolioSource !== null) return;

    const { portfolio, detail, aftermarket, pricing } = snapshot;
    // Merge cached detail over its summary domain, matching enrichVisible's shape.
    const enriched: Record<string, Domain> = {};
    for (const d of portfolio.domains) {
      const key = domainKey(d);
      if (detail[key]) enriched[key] = { ...d, ...detail[key] };
    }
    // Mark cached aftermarket domains as done so we don't re-fetch them on view.
    for (const name of Object.keys(aftermarket)) marketDone.add(name);

    set({
      portfolio: portfolio.domains,
      portfolioErrors: portfolio.errors,
      portfolioRegistrars: portfolio.registrars,
      portfolioRegistrarLabels: portfolio.registrarLabels,
      portfolioLoadedAt: portfolio.fetchedAt,
      portfolioSource: 'cache',
      enriched,
      aftermarket,
      pricing,
      pricingLoadedAt: portfolio.fetchedAt,
    });
  },

  applyPortfolioCacheUpdate: async () => {
    // Before the first load there's nothing in view to overlay; the launch
    // hydrate path covers a fresh start.
    if (get().portfolioSource === null) return;
    const snapshot = await window.api.hydrateFromCache();
    const portfolio = snapshot.portfolio;
    if (!portfolio) return;
    set((state) => {
      // Overlay the freshly-cached summary + detail onto any existing enriched
      // entry so a patched field (auto-renew, lock, privacy, nameservers, …)
      // wins while previously-fetched detail is preserved.
      const enriched = { ...state.enriched };
      for (const d of portfolio.domains) {
        const key = domainKey(d);
        const detail = snapshot.detail[key];
        const existing = enriched[key];
        if (existing || detail) {
          enriched[key] = { ...(existing ?? {}), ...d, ...(detail ?? {}) };
        }
      }
      return {
        portfolio: portfolio.domains,
        portfolioErrors: portfolio.errors,
        portfolioRegistrars: portfolio.registrars,
        portfolioRegistrarLabels: portfolio.registrarLabels,
        portfolioLoadedAt: portfolio.fetchedAt,
        enriched,
      };
    });
  },

  clearAllCaches: async () => {
    await window.api.clearAllCaches();
    enrichInFlight.clear();
    enrichFailed.clear();
    marketInFlight.clear();
    marketDone.clear();
    pricingInFlight.clear();
    detailAllInFlight = false;
    marketAllInFlight = false;
    set({
      portfolio: [],
      portfolioErrors: [],
      portfolioRegistrars: [],
      portfolioRegistrarLabels: {},
      portfolioLoadedAt: null,
      portfolioSource: null,
      portfolioError: null,
      enriched: {},
      enriching: {},
      aftermarket: {},
      marketLoading: {},
      pricing: {},
      pricingLoading: false,
      pricingLoadedAt: null,
      detailAllLoading: false,
      marketAllLoading: false,
    });
  },

  loadPortfolio: async () => {
    set({ portfolioLoading: true, portfolioError: null });
    try {
      const result = await withSyncTimeout(window.api.listPortfolio(true));
      // Fresh summary data invalidates any prior per-domain detail.
      enrichInFlight.clear();
      enrichFailed.clear();
      marketInFlight.clear();
      marketDone.clear();
      pricingInFlight.clear();
      detailAllInFlight = false;
      marketAllInFlight = false;
      set((state) => ({
        portfolio: result.domains,
        portfolioErrors: result.errors,
        portfolioRegistrars: result.registrars,
        portfolioRegistrarLabels: result.registrarLabels,
        portfolioLoading: false,
        portfolioLoadedAt: result.fetchedAt ?? Date.now(),
        portfolioSource: 'live',
        refreshTick: state.refreshTick + 1,
        enriched: {},
        enriching: {},
        aftermarket: {},
        marketLoading: {},
        pricing: {},
        pricingLoading: false,
        pricingLoadedAt: null,
        detailAllLoading: false,
        marketAllLoading: false,
      }));
      // Per-registrar sync statuses changed — refresh the shared metadata.
      void get().loadRegistrars();
    } catch (err) {
      set({
        portfolioLoading: false,
        portfolioError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  enriched: {},
  enriching: {},
  mutating: {},
  setAutoRenew: async (registrar, domainName, enabled) => {
    const key = `${registrar}:${domainName}`;
    const state = get();
    // Base to merge onto: the already-enriched full domain if present, else the
    // portfolio summary. Bail if we can't find it (nothing to update).
    const base =
      state.enriched[key] ?? state.portfolio.find((d) => domainKey(d) === key);
    if (!base) return;

    // Optimistically reflect the new value and mark the cell in flight.
    set((s) => ({
      enriched: { ...s.enriched, [key]: { ...base, autoRenew: enabled } },
      mutating: { ...s.mutating, [key]: true },
    }));

    try {
      await window.api.setAutoRenew(registrar, domainName, enabled);
    } catch (err) {
      // Roll back to the pre-toggle value on any registrar-side failure.
      set((s) => ({
        enriched: { ...s.enriched, [key]: base },
      }));
      throw err;
    } finally {
      set((s) => {
        const mutating = { ...s.mutating };
        delete mutating[key];
        return { mutating };
      });
    }
  },
  enrichVisible: async (domains, force = false) => {
    const todo = domains.filter((d) => {
      const key = domainKey(d);
      // A forced refresh re-fetches on-screen rows regardless of prior state,
      // skipping only ones already in flight.
      if (force) return !enrichInFlight.has(key);
      return (
        // Only enrich rows the list didn't fully populate. Registrars that
        // return nameservers in the list also report privacy/lock correctly, so
        // a row that already has nameservers needs no detail lookup.
        d.nameservers.length === 0 &&
        !get().enriched[key] &&
        !enrichInFlight.has(key) &&
        !enrichFailed.has(key)
      );
    });
    if (todo.length === 0) return;

    // Mark all pending rows as loading up front so their detail cells show a
    // placeholder immediately, before the concurrency-limited fetches start.
    todo.forEach((d) => enrichInFlight.add(domainKey(d)));
    set((state) => {
      const enriching = { ...state.enriching };
      for (const d of todo) enriching[domainKey(d)] = true;
      return { enriching };
    });

    const clearEnriching = (key: string) =>
      set((state) => {
        const enriching = { ...state.enriching };
        delete enriching[key];
        return { enriching };
      });

    const CONCURRENCY = 6;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < todo.length) {
        const d = todo[next++];
        const key = domainKey(d);
        try {
          const detail = await window.api.getDomainDetail(
            d.registrar as RegistrarName,
            d.domainName,
            force,
          );
          if (detail) {
            // detail is a partial — merge it over the list summary.
            set((state) => ({
              enriched: { ...state.enriched, [key]: { ...d, ...detail } },
            }));
          } else {
            // No detail available (unsupported TLD etc.) — keep the summary and
            // don't retry this domain.
            enrichFailed.add(key);
          }
        } catch {
          // Hard failure — keep summary values and don't retry.
          enrichFailed.add(key);
        } finally {
          enrichInFlight.delete(key);
          clearEnriching(key);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker),
    );
  },

  detailAllLoading: false,
  loadAllDetail: async (domains) => {
    if (detailAllInFlight) return;
    detailAllInFlight = true;
    set({ detailAllLoading: true });
    try {
      // enrichVisible fetches only rows still missing detail and dedupes the
      // rest, so passing the whole portfolio loads everything not yet cached.
      await get().enrichVisible(domains);
    } finally {
      detailAllInFlight = false;
      set({ detailAllLoading: false });
    }
  },

  aftermarket: {},
  marketLoading: {},
  loadAftermarketVisible: async (domains, force = false) => {
    const todo = domains.filter((d) =>
      force
        ? !marketInFlight.has(d.domainName)
        : !marketDone.has(d.domainName) && !marketInFlight.has(d.domainName),
    );
    if (todo.length === 0) return;

    todo.forEach((d) => marketInFlight.add(d.domainName));
    set((state) => {
      const marketLoading = { ...state.marketLoading };
      for (const d of todo) marketLoading[d.domainName] = true;
      return { marketLoading };
    });

    const clearLoading = (key: string) =>
      set((state) => {
        const marketLoading = { ...state.marketLoading };
        delete marketLoading[key];
        return { marketLoading };
      });

    // Fire all visible; the main-process service serializes them to respect
    // DomDB's rate limit, so each resolves ~1s apart and its cell fills in.
    await Promise.all(
      todo.map(async (d) => {
        const key = d.domainName;
        try {
          const info = await window.api.getAftermarket(key, force);
          set((state) => ({
            aftermarket: { ...state.aftermarket, [key]: info },
          }));
        } catch {
          // leave it unset; treated as "no data"
        } finally {
          marketDone.add(key);
          marketInFlight.delete(key);
          clearLoading(key);
        }
      }),
    );
  },

  marketAllLoading: false,
  loadAllMarket: async (domains) => {
    if (marketAllInFlight) return;
    marketAllInFlight = true;
    set({ marketAllLoading: true });
    try {
      // Loads aftermarket for every domain not already fetched (deduped).
      await get().loadAftermarketVisible(domains);
    } finally {
      marketAllInFlight = false;
      set({ marketAllLoading: false });
    }
  },

  pricing: {},
  pricingLoading: false,
  pricingLoadedAt: null,
  loadPricingAll: async (domains) => {
    const todo = domains.filter((d) => {
      const key = domainKey(d);
      return !get().pricing[key] && !pricingInFlight.has(key);
    });
    if (todo.length === 0) return;

    todo.forEach((d) => pricingInFlight.add(domainKey(d)));
    set({ pricingLoading: true });

    // Bounded concurrency: the main-process service caches and dedupes per-TLD
    // lookups, so a modest pool keeps us well under any registrar's rate limit.
    const CONCURRENCY = 5;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < todo.length) {
        const d = todo[next++];
        const key = domainKey(d);
        try {
          const info = await window.api.getRenewalPrice(
            d.registrar as RegistrarName,
            d.domainName,
          );
          set((state) => ({ pricing: { ...state.pricing, [key]: info } }));
        } catch {
          // Leave unset — treated as "not yet priced".
        } finally {
          pricingInFlight.delete(key);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker),
    );
    set({ pricingLoading: false, pricingLoadedAt: Date.now() });
  },
  setManualPrice: async (registrar, domain, price) => {
    await window.api.setManualPrice(registrar as RegistrarName, domain, price);
    const info = await window.api.getRenewalPrice(
      registrar as RegistrarName,
      domain,
    );
    set((state) => ({
      pricing: { ...state.pricing, [`${registrar}:${domain}`]: info },
    }));
  },
  refreshPricing: async () => {
    await window.api.clearPricingCache();
    pricingInFlight.clear();
    set({ pricing: {} });
    await get().loadPricingAll(get().portfolio);
  },

  folders: [],
  folderAssignments: {},
  loadFolders: async () => {
    const { folders, assignments } = await window.api.getFolders();
    set({ folders, folderAssignments: assignments });
  },
  createFolder: async (input) => {
    const folder = await window.api.createFolder(input);
    set((state) => ({ folders: [...state.folders, folder] }));
    return folder;
  },
  updateFolder: async (id, patch) => {
    await window.api.updateFolder(id, patch);
    set((state) => ({
      folders: state.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  },
  deleteFolder: async (id) => {
    await window.api.deleteFolder(id);
    set((state) => {
      // Mirror the service: drop the folder and any assignments pointing at it.
      const folderAssignments: Record<string, string> = {};
      for (const [key, folderId] of Object.entries(state.folderAssignments)) {
        if (folderId !== id) folderAssignments[key] = folderId;
      }
      return {
        folders: state.folders.filter((f) => f.id !== id),
        folderAssignments,
      };
    });
  },
  assignFolder: async (domainKey, folderId) => {
    await window.api.assignFolder(domainKey, folderId);
    set((state) => {
      const folderAssignments = { ...state.folderAssignments };
      if (folderId === null) delete folderAssignments[domainKey];
      else folderAssignments[domainKey] = folderId;
      return { folderAssignments };
    });
  },

  settings: null,
  loadSettings: async () => {
    set({ settings: await window.api.getSettings() });
  },
  setAutoSyncInterval: async (minutes) => {
    const settings = await window.api.updateSettings({
      autoSyncIntervalMinutes: minutes,
    });
    set({ settings });
  },
}));
