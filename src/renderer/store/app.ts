import { create } from 'zustand';
import type {
  AppInfo,
  Domain,
  McpInfo,
  PortfolioErrorInfo,
  RegistrarName,
} from '../../shared/ipc';

/** Stable per-domain key across registrars. */
const domainKey = (d: Domain): string => `${d.registrar}:${d.domainName}`;

// Tracks detail fetches in flight so concurrent enrich calls don't duplicate
// work, and ones that failed / have no detail so we don't retry them on every
// page revisit. Kept outside the store so they don't trigger re-renders.
const enrichInFlight = new Set<string>();
const enrichFailed = new Set<string>();

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
  /** When the portfolio was last successfully loaded (ms epoch), or null. */
  portfolioLoadedAt: number | null;
  loadPortfolio: () => Promise<void>;

  // Lazy per-domain detail (nameservers/privacy/lock), keyed by `${registrar}:${domainName}`.
  // Some registrars' list endpoints omit these; we fetch full detail only for
  // on-screen rows that the list left without nameservers. See `enrichVisible`.
  enriched: Record<string, Domain>;
  /** Domains whose detail fetch is currently in flight (for per-cell loading). */
  enriching: Record<string, boolean>;
  enrichVisible: (domains: Domain[]) => Promise<void>;
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
  loadPortfolio: async () => {
    set({ portfolioLoading: true, portfolioError: null });
    try {
      const result = await window.api.listPortfolio();
      // Fresh summary data invalidates any prior per-domain detail.
      enrichInFlight.clear();
      enrichFailed.clear();
      set({
        portfolio: result.domains,
        portfolioErrors: result.errors,
        portfolioRegistrars: result.registrars,
        portfolioRegistrarLabels: result.registrarLabels,
        portfolioLoading: false,
        portfolioLoadedAt: Date.now(),
        enriched: {},
        enriching: {},
      });
    } catch (err) {
      set({
        portfolioLoading: false,
        portfolioError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  enriched: {},
  enriching: {},
  enrichVisible: async (domains) => {
    const todo = domains.filter((d) => {
      const key = domainKey(d);
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
}));
