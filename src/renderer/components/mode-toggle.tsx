import { Moon, Sun, SunMoon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type Theme } from '@/components/theme-provider';

// Segment order and per-theme presentation. Auto sits between the two fixed
// themes and gets a blended sun/moon glyph so it reads distinctly from both.
const ORDER: Theme[] = ['dark', 'auto', 'light'];
const META: Record<Theme, { label: string; icon: typeof Sun }> = {
  dark: { label: 'Dark', icon: Moon },
  auto: { label: 'Auto', icon: SunMoon },
  light: { label: 'Light', icon: Sun },
};

/** Compact three-way theme switch (dark / auto / light), sized to sit in the
 * status bar. */
export function ModeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        'inline-flex items-center gap-px rounded-full border p-px',
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
            title={t === 'auto' ? 'Auto — follow the system theme' : label}
            onClick={() => setTheme(t)}
            className={cn(
              'inline-flex h-[19px] w-6 items-center justify-center rounded-full outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              active && 'bg-accent text-foreground',
            )}
          >
            <Icon className="size-3" />
          </button>
        );
      })}
    </div>
  );
}
