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

const DENSITY_OPTIONS: { value: Preferences['density']; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'compact', label: 'Compact' },
];

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
  const density = usePreferences((s) => s.density);
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
      </SettingsCard>

      <SettingsCard
        title="Domains table"
        contentClassName="flex flex-col gap-5"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Row spacing and text size. Phones always use the compact layout.
          </p>
          <Select
            value={density}
            onValueChange={(v) =>
              setPreferences({ density: v as Preferences['density'] })
            }
          >
            <SelectTrigger className="w-52" aria-label="Table density">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DENSITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-3 border-t pt-5">
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
