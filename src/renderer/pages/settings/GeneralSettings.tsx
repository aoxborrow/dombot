import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ModeToggle } from '@/components/mode-toggle';
import {
  PAGE_SIZES,
  SORT_COLUMNS,
  usePreferences,
  type Preferences,
} from '../../lib/preferences';
import { SettingsCard } from './SettingsCard';

/** Steps of the brand green ramp, defined as `--color-brand-*` in index.css. */
const BRAND_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const DIRECTION_OPTIONS: { value: Preferences['sortDir']; label: string }[] = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
];

/**
 * General preferences: how this window looks and how the Domains table opens.
 * Stored per device (see lib/preferences), applied immediately — no save step.
 */
export default function GeneralSettings() {
  const pageSize = usePreferences((s) => s.pageSize);
  const sortKey = usePreferences((s) => s.sortKey);
  const sortDir = usePreferences((s) => s.sortDir);
  const setPreferences = usePreferences((s) => s.setPreferences);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold">General</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Preferences for this device. Changes apply right away.
        </p>
      </div>

      <SettingsCard title="Appearance" contentClassName="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Choose light, dark, or auto. Auto follows your system&apos;s setting.
        </p>
        <ModeToggle className="self-start" />

        <div className="flex flex-col gap-3 border-t pt-5">
          <p className="text-sm text-muted-foreground">
            Brand green palette, available as <code>brand-50</code> through{' '}
            <code>brand-950</code> (e.g. <code>bg-brand-600</code>).
          </p>
          <BrandPalette />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Domains table"
        contentClassName="flex flex-col gap-5"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            The number of domains shown per page by default.
          </p>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => setPreferences({ pageSize: Number(v) })}
          >
            <SelectTrigger className="w-52" aria-label="Default rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} rows
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-3 border-t pt-5">
          <p className="text-sm text-muted-foreground">
            The column and order domains are sorted by default.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={sortKey}
              onValueChange={(v) => setPreferences({ sortKey: v })}
            >
              <SelectTrigger className="w-52" aria-label="Default sort column">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_COLUMNS.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={sortDir}
              onValueChange={(v) =>
                setPreferences({ sortDir: v as Preferences['sortDir'] })
              }
            >
              <SelectTrigger
                className="w-40"
                aria-label="Default sort direction"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIRECTION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

/** Tailwind's emerald ramp, for comparing relative darkness against ours.
 * Literal class names so Tailwind emits them. */
const EMERALD_CLASSES: Record<number, string> = {
  50: 'bg-emerald-50',
  100: 'bg-emerald-100',
  200: 'bg-emerald-200',
  300: 'bg-emerald-300',
  400: 'bg-emerald-400',
  500: 'bg-emerald-500',
  600: 'bg-emerald-600',
  700: 'bg-emerald-700',
  800: 'bg-emerald-800',
  900: 'bg-emerald-900',
  950: 'bg-emerald-950',
};

/** Hex of a swatch's rendered background, via a canvas pixel — the computed
 * style of Tailwind's own colors comes back as oklch(), not hex. */
function renderedHex(el: HTMLElement): string {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = getComputedStyle(el).backgroundColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Swatch grids for the brand ramp and, beneath it, Tailwind's emerald for
 * comparison. Hex values are read back from the rendered swatches, so
 * index.css stays the single source of truth. */
function BrandPalette() {
  const gridRef = useRef<HTMLDivElement>(null);
  const [hexes, setHexes] = useState<Record<string, string>>({});
  useEffect(() => {
    const out: Record<string, string> = {};
    gridRef.current
      ?.querySelectorAll<HTMLElement>('[data-swatch]')
      .forEach((el) => {
        out[el.dataset.swatch!] = renderedHex(el);
      });
    setHexes(out);
  }, []);

  const row = (
    name: string,
    swatchClass: (n: number) => string | undefined,
  ) => (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-medium text-muted-foreground">{name}</div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-11">
        {BRAND_SHADES.map((n) => (
          <div key={n} className="flex flex-col gap-1">
            <div
              data-swatch={`${name}-${n}`}
              className={cn('h-10 rounded-md border', swatchClass(n))}
              style={
                swatchClass(n)
                  ? undefined
                  : { backgroundColor: `var(--color-brand-${n})` }
              }
            />
            <div className="text-xs leading-tight">
              <div className="font-medium">{n}</div>
              <div className="font-mono text-[11px] text-muted-foreground">
                {hexes[`${name}-${n}`] ?? ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div ref={gridRef} className="flex flex-col gap-4">
      {row('brand', () => undefined)}
      {row('emerald', (n) => EMERALD_CLASSES[n])}
    </div>
  );
}
