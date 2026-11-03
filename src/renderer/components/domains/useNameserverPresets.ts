import { domainKey } from '../../../shared/account-key';
import { useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/app';
import {
  marketNameserverPresets,
  nameserverPresets,
  withMarketPresets,
  type NameserverPreset,
} from '../../lib/nameserver-input';

/**
 * The nameserver presets for an editor: each connected market's own set
 * first (with Afternic's NS3 once its ID is saved), then the user's recent
 * saves (from settings, loaded on demand) and the portfolio's most common
 * sets. A pass over the whole portfolio, so mount it only while an editor is
 * open.
 */
export function useNameserverPresets(): NameserverPreset[] {
  const portfolio = useAppStore((s) => s.portfolio);
  const enriched = useAppStore((s) => s.enriched);
  const settings = useAppStore((s) => s.settings);
  const marketCatalog = useAppStore((s) => s.marketCatalog);
  const marketAccounts = useAppStore((s) => s.marketAccounts);
  const loadSettings = useAppStore((s) => s.loadSettings);
  useEffect(() => {
    if (settings === null) void loadSettings();
  }, [settings, loadSettings]);

  return useMemo(
    () =>
      withMarketPresets(
        marketNameserverPresets(marketAccounts ?? [], marketCatalog),
        nameserverPresets(
          portfolio.map((d) => enriched[domainKey(d)] ?? d),
          settings?.recentNameservers ?? [],
          8,
          marketCatalog,
        ),
      ),
    [portfolio, enriched, settings, marketCatalog, marketAccounts],
  );
}
