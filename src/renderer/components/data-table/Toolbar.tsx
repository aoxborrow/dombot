import type { ComponentType, ReactNode } from 'react';
import { CircleX, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { calendarDay, yearBounds, yearPreset } from '../../lib/date-range';
import { MoneyInput } from '../domains/MoneyInput';
import { stopMenuKeys } from './FilterBar';

// The pieces of a table page's toolbar, shared by Domains and Activity (see
// FilterToolbar, which puts them together with the filter bar).

/** The search box, with a clear button that looks the same on every platform. */
export function SearchField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Overrides the default sizing (grows to fill the row). */
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative min-w-[140px] flex-1 max-sm:basis-full',
        className,
      )}
    >
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        // Room on the right for the clear button below. The placeholder a
        // step quieter than the muted grey: lighter on white, darker on
        // black.
        className="pr-8 pl-8 placeholder:text-[#8f8f8f] dark:placeholder:text-[#858585]"
      />
      {/* Custom clear control in place of the native search-cancel button (a
          blue ⓧ on macOS): a muted solid disc with the ✕ cut out in the
          field's background, the same on every platform. */}
      {value !== '' && (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full text-muted-foreground opacity-70 hover:opacity-100"
        >
          <CircleX
            className="size-4 [&>path]:stroke-background"
            fill="currentColor"
            strokeWidth={2.5}
          />
        </button>
      )}
    </div>
  );
}

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  /** Optional leading icon shown before this option's label. */
  icon?: ReactNode;
  /** A line above this option, starting a new section of the list. */
  divider?: boolean;
}

/** A range's chip text: "$10–$500", "≥ $10", "≤ $500"; null when unbounded. */
export function rangeSummary(
  min: string,
  max: string,
  format: (n: number) => string,
): string | null {
  const lo = min === '' ? null : Number(min);
  const hi = max === '' ? null : Number(max);
  if (lo !== null && hi !== null) return `${format(lo)}–${format(hi)}`;
  if (lo !== null) return `≥ ${format(lo)}`;
  if (hi !== null) return `≤ ${format(hi)}`;
  return null;
}

/**
 * The money fields in a filter chip's menu, compact like its search fields:
 * 32px tall, 13px text, 6px corners, a narrow symbol box, the search fields'
 * fill, and a dark green border (no ring) when focused.
 */
const COMPACT_MONEY = cn(
  'h-8 w-24 rounded-[6px] bg-muted text-[13px] shadow-none dark:bg-background',
  '[&_[data-slot=input-group-addon]]:min-w-7 [&_[data-slot=input-group-addon]]:px-2 [&_[data-slot=input-group-control]]:px-2 [&_[data-slot=input-group-control]]:text-[13px]',
  'has-[[data-slot=input-group-control]:focus-visible]:border-[#337544] has-[[data-slot=input-group-control]:focus-visible]:ring-0',
);

/**
 * A whole-amount range editor for a filter chip's dropdown: min and max
 * inputs, either of which can be blank. From the old Afternic price filter.
 */
export function RangeInputs({
  label,
  min,
  max,
  onChange,
  currency,
}: {
  label: string;
  /** The bounds as typed digits; "" is unbounded. */
  min: string;
  max: string;
  onChange: (min: string, max: string) => void;
  /** For the inputs' symbol. */
  currency: string;
}) {
  // Min takes focus as the chip's menu opens (FilterChip hands it on).
  return (
    // Typing goes to the inputs, not the menu's typeahead.
    <div className="flex flex-col gap-1.5 p-1.5" onKeyDown={stopMenuKeys}>
      <div className="flex items-center gap-1.5">
        <MoneyInput
          whole
          currency={currency}
          className={COMPACT_MONEY}
          placeholder="Min"
          aria-label={`Minimum ${label}`}
          value={min}
          onChange={(e) => onChange(e.target.value, max)}
        />
        <span className="text-muted-foreground">–</span>
        <MoneyInput
          whole
          currency={currency}
          className={COMPACT_MONEY}
          placeholder="Max"
          aria-label={`Maximum ${label}`}
          value={max}
          onChange={(e) => onChange(min, e.target.value)}
        />
      </div>
      {min !== '' && max !== '' && Number(min) > Number(max) && (
        <p className="text-xs text-destructive">Min is above max.</p>
      )}
    </div>
  );
}

// Same size and focus as the money range, wide enough for a native date
// control and its picker icon.
const COMPACT_DATE = cn(
  'h-8 w-[10.5rem] rounded-[6px] bg-muted px-2 text-[13px] shadow-none dark:bg-background dark:[color-scheme:dark]',
  'focus-visible:border-[#337544] focus-visible:ring-0',
);

/**
 * From / To dates for a filter chip's dropdown. Either can be blank.
 * Both days count. From after To is called out, same as a price range
 * whose min is above its max.
 */
export function DateRangeInputs({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  /** `YYYY-MM-DD`, or "" when that side is unbounded. */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
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
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          value={from}
          max={hi ?? undefined}
          aria-label={`From ${label}`}
          onChange={(e) => onChange(e.target.value, to)}
          className={COMPACT_DATE}
        />
        <span className="text-muted-foreground" aria-hidden>
          {'→'}
        </span>
        <Input
          type="date"
          value={to}
          min={lo ?? undefined}
          aria-label={`To ${label}`}
          onChange={(e) => onChange(from, e.target.value)}
          className={COMPACT_DATE}
        />
      </div>
      {lo && hi && lo > hi && (
        <p className="text-xs text-destructive">From is after To.</p>
      )}
      <YearButtons from={from} to={to} onChange={onChange} />
    </div>
  );
}

// The set-filter green, same tint as a filter chip that has a value.
const YEAR_ON = cn(
  'border-[#4f9d6b] bg-[#f1f8f3] text-[#3a5644]',
  'dark:border-[#4f9d6b]/70 dark:bg-[#4f9d6b]/15 dark:text-[#c5e4d0]',
);

/**
 * This year and Last year, under the date fields. A click fills both
 * ends of that calendar year. The one that matches the boxes is filled in.
 */
function YearButtons({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const today = new Date();
  const selected = yearPreset(from, to, today);
  const years = [
    { id: 'this' as const, label: 'This year', year: today.getFullYear() },
    { id: 'last' as const, label: 'Last year', year: today.getFullYear() - 1 },
  ];
  return (
    <div className="flex gap-1.5">
      {years.map((y) => {
        const on = selected === y.id;
        return (
          <button
            key={y.id}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const bounds = yearBounds(y.year);
              onChange(bounds.from, bounds.to);
            }}
            className={cn(
              'h-7 flex-1 rounded-[6px] border text-[13px] transition-colors',
              on
                ? YEAR_ON
                : 'border-input bg-muted text-muted-foreground hover:border-[#a3a3a3] hover:text-foreground dark:bg-background dark:hover:border-muted-foreground/70',
            )}
          >
            {y.label}
          </button>
        );
      })}
    </div>
  );
}

/** A table page's segmented view switch (Needs review | All). */
export function ViewSwitch({
  label,
  options,
  className = 'mt-1 self-start sm:mt-[7px]',
}: {
  /** Accessible name for the group. */
  label: string;
  /** Placement. The default lines it up with a page title beside it; a
   * toolbar passes its own. */
  className?: string;
  options: {
    id: string;
    label: ReactNode;
    icon?: ComponentType<{ className?: string }>;
    count: number;
    active: boolean;
    onClick: () => void;
  }[];
}) {
  return (
    <SegmentedControl
      aria-label={label}
      className={className}
      value={options.find((o) => o.active)?.id ?? ''}
      onChange={(id) => options.find((o) => o.id === id)?.onClick()}
      options={options.map((o) => ({
        value: o.id,
        label: o.label,
        icon: o.icon,
        count: o.count,
      }))}
    />
  );
}
