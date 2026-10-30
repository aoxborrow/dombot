import { useSyncExternalStore } from 'react';

/**
 * How the small stat cards show their icon, while we choose between two
 * looks (temporary; one goes once picked). 'ghost': a faded icon, whole,
 * on the right of a wide card and small in the top-right corner of a narrow
 * one. 'glyph': a dimmer faded icon on the right of a wide card, a glyph
 * before the label in a narrow one. 'watermark': the old big icon cut off by
 * the corner.
 */
export type CardStyle = 'ghost' | 'glyph' | 'watermark';

const STORAGE_KEY = 'dombot-card-style';
const listeners = new Set<() => void>();

function readStored(): CardStyle {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'ghost' || v === 'glyph' || v === 'watermark') return v;
  } catch {
    // localStorage may be unavailable; fall back to the default.
  }
  return 'ghost';
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
