import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ModeToggle } from '@/components/mode-toggle';
import { useEffect } from 'react';
import {
  PAGE_SIZES,
  SORT_COLUMNS,
  usePreferences,
  type Preferences,
} from '../../lib/preferences';
import { NUMBER_FORMATS, type NumberFormatId } from '../../../shared/money';
import { useAppStore } from '../../store/app';
import { CurrencyPicker } from '../../components/domains/CurrencyPicker';
import { SettingsCard, SettingsField } from './SettingsCard';

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
  const settings = useAppStore((s) => s.settings);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const saveMoneySettings = useAppStore((s) => s.saveMoneySettings);
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold">General</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Preferences for this device. Changes apply right away.
        </p>
      </div>

      <SettingsCard title="Appearance">
        <SettingsField
          label="Theme"
          labelId="theme-label"
          description="Choose light, dark, or auto. Auto follows your system's setting."
        >
          <div>
            <ModeToggle labelledBy="theme-label" />
          </div>
        </SettingsField>
      </SettingsCard>

      <SettingsCard
        title="Domains table"
        contentClassName="flex flex-col gap-5"
      >
        <SettingsField
          label="Density"
          htmlFor="pref-density"
          description="Row spacing and text size. Phones always use the compact layout."
        >
          <div>
            <Select
              value={density}
              onValueChange={(v) =>
                setPreferences({ density: v as Preferences['density'] })
              }
            >
              <SelectTrigger id="pref-density" className="w-52">
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
        </SettingsField>

        <SettingsField
          label="Rows per page"
          htmlFor="pref-page-size"
          description="The number of domains shown per page by default."
          className="border-t pt-5"
        >
          <div>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => setPreferences({ pageSize: Number(v) })}
            >
              <SelectTrigger id="pref-page-size" className="w-52">
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
        </SettingsField>

        <SettingsField
          label="Sort by"
          htmlFor="pref-sort-key"
          description="The column and order domains are sorted by default."
          className="border-t pt-5"
        >
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={sortKey}
              onValueChange={(v) => setPreferences({ sortKey: v })}
            >
              <SelectTrigger id="pref-sort-key" className="w-52">
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
        </SettingsField>
      </SettingsCard>

      <SettingsCard title="Money" contentClassName="flex flex-col gap-5">
        {settings && (
          <>
            <SettingsField
              label="Preferred currency"
              description="The default for new amounts. Saved amounts keep their own currency."
            >
              <div>
                <div className="w-72">
                  <CurrencyPicker
                    label="Preferred currency"
                    value={settings.preferredCurrency}
                    onChange={(preferredCurrency) =>
                      void saveMoneySettings({
                        preferredCurrency,
                        numberFormat: settings.numberFormat,
                      })
                    }
                  />
                </div>
              </div>
            </SettingsField>
            <SettingsField
              label="Number format"
              htmlFor="pref-number-format"
              description="How amounts are written. This does not change the currency."
              className="border-t pt-5"
            >
              <div>
                <Select
                  value={settings.numberFormat}
                  onValueChange={(v) =>
                    void saveMoneySettings({
                      preferredCurrency: settings.preferredCurrency,
                      numberFormat: v as NumberFormatId,
                    })
                  }
                >
                  <SelectTrigger id="pref-number-format" className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NUMBER_FORMATS.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SettingsField>
          </>
        )}
      </SettingsCard>
    </div>
  );
}
