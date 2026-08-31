import { Moon, Sun, SunMoon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme, type Theme } from '@/components/theme-provider';

// Cycle order and per-theme presentation. Auto gets a blended sun/moon glyph so
// it reads distinctly from the plain light (sun) and dark (moon) states.
const ORDER: Theme[] = ['light', 'dark', 'auto'];
const META: Record<Theme, { label: string; icon: typeof Sun }> = {
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
  auto: { label: 'Auto', icon: SunMoon },
};

/** Single-button theme switch: each click steps light → dark → auto → light,
 * showing the active theme's icon. */
export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const { label, icon: Icon } = META[theme] ?? META.auto;
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${label}. Switch to ${META[next].label}.`}
      title={`Theme: ${label} — click for ${META[next].label}`}
    >
      <Icon />
    </Button>
  );
}
