import { useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/app';
import {
  nameserverPresets,
  type NameserverPreset,
} from '../../lib/nameserver-input';

/**
 * The nameserver presets for an editor: the user's recent saves (from
 * settings, loaded on demand) plus the portfolio's most common sets. A pass
 * over the whole portfolio, so mount it only while an editor is open.
 */
export function useNameserverPresets(): NameserverPreset[] {
  const portfolio = useAppStore((s) => s.portfolio);
  const enriched = useAppStore((s) => s.enriched);
  const settings = useAppStore((s) => s.settings);
  const loadSettings = useAppStore((s) => s.loadSettings);
  useEffect(() => {
    if (settings === null) void loadSettings();
  }, [settings, loadSettings]);

  return useMemo(
    () =>
      nameserverPresets(
        portfolio.map((d) => enriched[`${d.registrar}:${d.domainName}`] ?? d),
        settings?.recentNameservers ?? [],
      ),
    [portfolio, enriched, settings],
  );
}
