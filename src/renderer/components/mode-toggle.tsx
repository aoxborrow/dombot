import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type Theme } from '@/components/theme-provider';

// Segment order and per-theme presentation. Auto sits between the two fixed
// themes and gets a monitor glyph, since it follows the system setting.
const ORDER: Theme[] = ['dark', 'auto', 'light'];
const META: Record<Theme, { label: string; icon: typeof Sun }> = {
  dark: { label: 'Dark', icon: Moon },
  auto: { label: 'Auto', icon: Monitor },
  light: { label: 'Light', icon: Sun },
};

/** Three-way theme switch (dark / auto / light) as a segmented control. */
export function ModeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5 text-sm text-muted-foreground',
        className,
      )}
    >
      {ORDER.map((t) => {
        const { label, icon: Icon } = META[t];
        const active = theme === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(t)}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-md px-3 font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              active && 'bg-background text-foreground shadow-sm',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
