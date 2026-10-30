import { useSyncExternalStore } from 'react';

/**
 * Where a small stat card's icon sits on a narrow phone card, while we
 * choose (temporary; the switch goes once picked). Wide cards always put it
 * at the side and narrow ones from sm in the corner (see StatCard).
 * 'corner': the same 21px faded icon in the top-right corner. 'label': a
 * small glyph before the label. 'watermark': the old big icon cut off by
 * the corner, at every width.
 */
export type CardStyle = 'corner' | 'label' | 'watermark';

const STORAGE_KEY = 'dombot-card-style';
const listeners = new Set<() => void>();

function readStored(): CardStyle {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'corner' || v === 'label' || v === 'watermark') return v;
  } catch {
    // localStorage may be unavailable; fall back to the default.
  }
  return 'corner';
}

let current = readStored();

export function setCardStyle(next: CardStyle) {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Persisting is best-effort; the in-memory value still updates.
  }
  for (const listener of listeners) listener();
}

export function useCardStyle(): CardStyle {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
}
