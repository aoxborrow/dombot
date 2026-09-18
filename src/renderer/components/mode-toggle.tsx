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

/** Three-way theme switch (dark / auto / light) as a segmented control.
 * `bare` is the icon-only, borderless form for the status bar. */
export function ModeToggle({
  className,
  bare = false,
}: {
  className?: string;
  bare?: boolean;
}) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        'inline-flex items-center text-muted-foreground',
        bare ? 'gap-0.5' : 'gap-1 rounded-lg border p-1 text-sm',
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
            aria-label={label}
            onClick={() => setTheme(t)}
            className={cn(
              'inline-flex items-center outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              bare
                ? 'size-5 justify-center rounded-sm'
                : 'h-8 gap-2 rounded-md px-3 font-medium hover:bg-foreground/5 dark:hover:bg-accent/50',
              active && 'bg-foreground/10 text-foreground dark:bg-accent',
            )}
          >
            <Icon className={bare ? 'size-3' : 'size-4'} />
            {!bare && label}
          </button>
        );
      })}
    </div>
  );
}
