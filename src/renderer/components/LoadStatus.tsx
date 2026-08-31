import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** One dataset's background-load progress. */
export interface LoadStatusItem {
  label: string;
  loaded: number;
  total: number;
  loading: boolean;
}

/** A status light: spinner while loading, green when done, grey when idle. */
export function StatusDot({ state }: { state: 'idle' | 'loading' | 'done' }) {
  if (state === 'loading') {
    return <Loader2 className="size-3 animate-spin text-muted-foreground" />;
  }
  return (
    <span
      className={cn(
        'size-2 rounded-full',
        state === 'done' ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    />
  );
}

/**
 * Combined background-load status: one light per dataset (Domains, Markets,
 * Pricing). The "loaded / total" count lives in each segment's tooltip.
 */
export function LoadStatus({
  items,
  className,
}: {
  items: LoadStatusItem[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 text-xs text-muted-foreground',
        className,
      )}
    >
      {items.map((it) => {
        const state = it.total === 0 ? 'idle' : it.loading ? 'loading' : 'done';
        return (
          <span
            key={it.label}
            className="inline-flex items-center gap-1.5"
            title={`${it.label}: ${it.loaded} / ${it.total} loaded`}
          >
            <StatusDot state={state} />
            <span>{it.label}</span>
            {it.total > 0 && (
              <span className="tabular-nums">
                {it.loaded}/{it.total}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
