import { useMemo, useState } from 'react';
import { unconvertibleAmounts } from '../../shared/unconvertible';
import { useAppStore } from '../store/app';

// The bell's note about amounts in currencies DomBot can't convert
// (shared/unconvertible.ts). Dismissing it remembers how many there were, on
// this device, so it comes back only when there are more.

const DISMISSED_KEY = 'dombot-unconvertible-dismissed';

function readDismissed(): number {
  try {
    return Number(localStorage.getItem(DISMISSED_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function useUnconvertible() {
  const events = useAppStore((s) => s.domainEvents);
  const listPrices = useAppStore((s) => s.listPrices);
  const pricing = useAppStore((s) => s.pricing);
  const items = useMemo(
    () => unconvertibleAmounts(events, listPrices, pricing),
    [events, listPrices, pricing],
  );
  const [dismissed, setDismissed] = useState(readDismissed);
  return {
    items,
    shown: items.length > dismissed,
    dismiss: () => {
      try {
        localStorage.setItem(DISMISSED_KEY, String(items.length));
      } catch {
        // Storage unavailable: dismissed until the window reloads.
      }
      setDismissed(items.length);
    },
  };
}
