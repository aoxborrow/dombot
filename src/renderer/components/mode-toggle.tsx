import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type Theme } from '@/components/theme-provider';
import { SegmentedControl } from '@/components/ui/segmented-control';

// Segment order and per-theme presentation, in macOS's Appearance order
// (Light, Dark, Auto). Auto gets a monitor glyph, since it follows the system
// setting.
const ORDER: Theme[] = ['light', 'dark', 'auto'];
const META: Record<Theme, { label: string; icon: typeof Sun }> = {
  dark: { label: 'Dark', icon: Moon },
  auto: { label: 'Auto', icon: Monitor },
  light: { label: 'Light', icon: Sun },
};

/** Three-way theme switch (light / dark / auto): the shared segmented
 * control in Settings; `bare` is the icon-only, borderless form for the
 * status bar. */
export function ModeToggle({
  className,
  bare = false,
  labelledBy,
}: {
  className?: string;
  bare?: boolean;
  /** Id of a visible label naming the group (Settings); else "Theme". */
  labelledBy?: string;
}) {
  const { theme, setTheme } = useTheme();

  // Settings: the shared segmented control, with labels.
  if (!bare)
    return (
      <SegmentedControl
        aria-label={labelledBy ? undefined : 'Theme'}
        aria-labelledby={labelledBy}
        className={className}
        value={theme}
        onChange={setTheme}
        options={ORDER.map((t) => ({ value: t, ...META[t] }))}
      />
    );

  // Status bar: borderless icons.
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        'inline-flex items-center gap-0.5 text-muted-foreground',
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
              'inline-flex size-5 items-center justify-center rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              active && 'bg-foreground/10 text-foreground dark:bg-accent',
            )}
          >
            <Icon className="size-3" />
          </button>
        );
      })}
    </div>
  );
}
