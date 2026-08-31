import { useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '../store/app';
import { LoadStatus, type LoadStatusItem } from './LoadStatus';

/**
 * App-wide bottom status bar (VS Code style): a thin footer that surfaces the
 * embedded MCP server's status on the left and the background-load lights
 * (Domains / Markets / Pricing) on the right. Shown on every route; the user
 * can hide it from Settings → Appearance.
 */
export default function StatusBar() {
  const visible = useAppStore((s) => s.statusBarVisible);
  const mcpInfo = useAppStore((s) => s.mcpInfo);
  const loadMcpInfo = useAppStore((s) => s.loadMcpInfo);

  const portfolio = useAppStore((s) => s.portfolio);
  const enriched = useAppStore((s) => s.enriched);
  const aftermarket = useAppStore((s) => s.aftermarket);
  const pricing = useAppStore((s) => s.pricing);
  const portfolioLoading = useAppStore((s) => s.portfolioLoading);
  const detailAllLoading = useAppStore((s) => s.detailAllLoading);
  const marketAllLoading = useAppStore((s) => s.marketAllLoading);
  const pricingLoading = useAppStore((s) => s.pricingLoading);

  // Fetch the MCP endpoint once; it's static for the app's lifetime.
  useEffect(() => {
    if (mcpInfo === null) void loadMcpInfo();
  }, [mcpInfo, loadMcpInfo]);

  // Per-dataset "loaded / total" counts, recomputed as data streams in. Loaded
  // counts domains that have that datum present; detail overlays onto summary.
  const items = useMemo<LoadStatusItem[]>(() => {
    const total = portfolio.length;
    let nsLoaded = 0;
    let marketLoaded = 0;
    let pricingLoaded = 0;
    for (const d of portfolio) {
      const key = `${d.registrar}:${d.domainName}`;
      const detail = enriched[key] ?? d;
      if (detail.nameservers.length > 0) nsLoaded += 1;
      if (aftermarket[d.domainName] !== undefined) marketLoaded += 1;
      if (pricing[key] !== undefined) pricingLoaded += 1;
    }
    return [
      {
        label: 'Domains',
        loaded: nsLoaded,
        total,
        loading: portfolioLoading || detailAllLoading,
      },
      {
        label: 'Markets',
        loaded: marketLoaded,
        total,
        loading: marketAllLoading,
      },
      {
        label: 'Pricing',
        loaded: pricingLoaded,
        total,
        loading: pricingLoading,
      },
    ];
  }, [
    portfolio,
    enriched,
    aftermarket,
    pricing,
    portfolioLoading,
    detailAllLoading,
    marketAllLoading,
    pricingLoading,
  ]);

  if (!visible) return null;

  const mcpRunning = mcpInfo?.running ?? false;
  // Show just host:port from the endpoint (drop the scheme and /mcp path).
  const mcpEndpoint = mcpInfo?.url
    ? mcpInfo.url.replace(/^\w+:\/\//, '').replace(/\/.*$/, '')
    : null;
  const hasPortfolio = portfolio.length > 0;

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between gap-4 border-t bg-background px-4 text-xs text-muted-foreground select-none">
      <span
        className="inline-flex items-center gap-1.5"
        title={
          mcpRunning
            ? `MCP server listening at ${mcpInfo?.url}`
            : 'MCP server is not running'
        }
      >
        <span
          className={cn(
            'size-2 rounded-full',
            mcpRunning ? 'bg-emerald-500' : 'bg-muted-foreground/30',
          )}
          aria-hidden
        />
        {mcpRunning && mcpEndpoint ? `MCP ${mcpEndpoint}` : 'MCP off'}
      </span>

      {hasPortfolio && <LoadStatus items={items} />}
    </footer>
  );
}
