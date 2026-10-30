import { cn } from '@/lib/utils';
import { setCardStyle, useCardStyle, type CardStyle } from '../lib/card-style';

const OPTIONS: { value: CardStyle; label: string; title: string }[] = [
  { value: 'ghost', label: 'F', title: 'Card icons: faded, whole (F)' },
  { value: 'tile', label: 'G', title: 'Card icons: tile on the left (G)' },
  { value: 'watermark', label: 'Old', title: 'Card icons: cut-off corner' },
];

/** The status bar's switch between the stat card looks, while we choose
 * one (dev builds only; temporary). */
export function CardStyleToggle({ className }: { className?: string }) {
  const style = useCardStyle();
  return (
    <div
      role="radiogroup"
      aria-label="Card icons"
      className={cn(
        'inline-flex items-center gap-0.5 text-muted-foreground',
        className,
      )}
    >
      {OPTIONS.map((o) => {
        const active = style === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => setCardStyle(o.value)}
            className={cn(
              'inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1 text-[10px] font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              active && 'bg-foreground/10 text-foreground dark:bg-accent',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
