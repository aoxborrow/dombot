import { startTransition, type ComponentType } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  calendarDay,
  DATE_PRESETS,
  dateRangeSummary,
  NO_DATE_RANGE,
  presetRange,
  type DatePresetId,
  type DateRange,
} from '../../lib/date-range';
import { stopMenuKeys, type FilterField } from './FilterBar';

// A date filter for any table's filter bar: a chip whose dropdown has an
// optional From and an optional To (both days count) and, under them, the
// field's shortcuts (Next 30 days, Last 12 months, …). The matching and chip
// text live in lib/date-range; rows are checked with matchesDateRange.

/**
 * A filter bar field for one date column. `presets` are the shortcuts that
 * suit it (FUTURE_DATE_PRESETS or PAST_DATE_PRESETS, or a pick of them);
 * `count`, when given, numbers the rows each shortcut would keep.
 * `onChange` gets the new range, NO_DATE_RANGE when the chip is cleared.
 */
export function dateRangeField({
  key,
  label,
  icon = Calendar,
  range,
  presets = [],
  count,
  onChange,
}: {
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  range: DateRange;
  presets?: DatePresetId[];
  count?: (range: DateRange) => number;
  onChange: (next: DateRange) => void;
}): FilterField {
  return {
    kind: 'custom',
    key,
    label,
    icon,
    summary: dateRangeSummary(range),
    onClear: () => onChange(NO_DATE_RANGE),
    content: (
      <DateRangeMenu
        label={label}
        value={range}
        presets={presets}
        count={count}
        onChange={onChange}
      />
    ),
  };
}

/** The chip's dropdown: the From / To days, then the shortcuts. */
function DateRangeMenu({
  label,
  value,
  presets,
  count,
  onChange,
}: {
  label: string;
  value: DateRange;
  presets: DatePresetId[];
  count?: (range: DateRange) => number;
  onChange: (next: DateRange) => void;
}) {
  const today = new Date();
  return (
    <>
      <DateRangeInputs label={label} value={value} onChange={onChange} />
      {presets.length > 0 && <DropdownMenuSeparator />}
      {presets.map((id) => {
        const checked = value.preset === id;
        return (
          <DropdownMenuCheckboxItem
            key={id}
            checked={checked}
            // A shortcut is the whole answer, so picking one closes the menu.
            onCheckedChange={() =>
              startTransition(() =>
                onChange(checked ? NO_DATE_RANGE : presetRange(id, today)),
              )
            }
          >
            {/* Grace and Redemption sit indented under Expired, which
                includes them. */}
            <span
              className={cn(
                'flex-1 truncate',
                DATE_PRESETS[id].within && 'pl-4',
              )}
            >
              {DATE_PRESETS[id].label}
            </span>
            {count && (
              <span className="ml-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                {count(presetRange(id, today))}
              </span>
            )}
          </DropdownMenuCheckboxItem>
        );
      })}
    </>
  );
}

// Same height and focus as the money range, just wide enough for a date and
// the picker icon.
const COMPACT_DATE = cn(
  'h-8 w-[7.75rem] rounded-[6px] bg-muted px-2 text-[13px] shadow-none dark:bg-background dark:[color-scheme:dark]',
  'focus-visible:border-[#337544] focus-visible:ring-0',
);

/**
 * From / To dates. Either can be blank. Both days count. From after To is
 * called out, same as a price range whose min is above its max. Typing a
 * day turns a shortcut into those fixed days.
 */
export function DateRangeInputs({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DateRange;
  onChange: (next: DateRange) => void;
}) {
  const { from, to } = value;
  const lo = calendarDay(from);
  const hi = calendarDay(to);
  return (
    <div
      className="flex flex-col gap-1.5 p-1.5"
      onKeyDown={(e) => {
        stopMenuKeys(e);
        // Arrow keys step the date. They must not move the menu's highlight.
        if (e.key.startsWith('Arrow')) e.stopPropagation();
      }}
    >
      <div className="flex items-center gap-1">
        <Input
          type="date"
          value={from}
          max={hi ?? undefined}
          aria-label={`From ${label}`}
          onChange={(e) => onChange({ from: e.target.value, to })}
          className={COMPACT_DATE}
        />
        <span className="text-muted-foreground" aria-hidden>
          –
        </span>
        <Input
          type="date"
          value={to}
          min={lo ?? undefined}
          aria-label={`To ${label}`}
          onChange={(e) => onChange({ from, to: e.target.value })}
          className={COMPACT_DATE}
        />
      </div>
      {lo && hi && lo > hi && (
        <p className="text-xs text-destructive">From is after To.</p>
      )}
    </div>
  );
}
