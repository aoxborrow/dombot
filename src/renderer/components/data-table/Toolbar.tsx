import type { ComponentType, ReactNode } from 'react';
import { ChevronDown, CircleX, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { MoneyInput } from '../domains/MoneyInput';
import { stopMenuKeys } from './FilterBar';

// The pieces of a table page's toolbar, shared by Domains and Activity:
// search on the left, filters, then Reset.

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
        // Room on the right for the clear button below.
        className="pr-8 pl-8"
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

/** The green border a toolbar control wears while filtering is in play. */
export const FILTERING_BORDER = 'border-[#4f9d6b] dark:border-[#4f9d6b]';

/**
 * Reset, styled like the filters (no chevron); faded and disabled when
 * nothing is active. On phones it stays beside the Filters toggle
 * (sm:order-last pins it after the filters on desktop).
 */
export function ResetButton({
  active,
  onReset,
}: {
  active: boolean;
  onReset: () => void;
}) {
  return (
    <Button
      variant="outline"
      onClick={onReset}
      disabled={!active}
      className={cn(
        'gap-2 pr-[14px]! pl-[8px]! sm:order-last',
        active && FILTERING_BORDER,
      )}
    >
      <X
        className={cn(
          'size-[18px]',
          active ? 'text-[#4f9d6b]' : 'text-muted-foreground',
        )}
      />
      Reset
    </Button>
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

/** Adds or removes `value` from a multi-select selection array. */
export function toggleValue(selected: string[], value: string): string[] {
  return selected.includes(value)
    ? selected.filter((v) => v !== value)
    : [...selected, value];
}

function FilterTrigger({
  label,
  icon: Icon,
  badge,
}: {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  badge?: ReactNode;
}) {
  return (
    <DropdownMenuTrigger asChild>
      <Button variant="outline" aria-label={label} className="gap-2 pr-[7px]!">
        {Icon && <Icon className="size-4 text-muted-foreground" />}
        {label}
        {badge != null && (
          <Badge className="bg-primary px-1.5 py-0 text-xs tabular-nums text-primary-foreground">
            {badge}
          </Badge>
        )}
        <ChevronDown className="size-4 text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
  );
}

/**
 * A checkbox dropdown filter. The trigger shows the plural `label` plus a count
 * badge once anything is selected; an empty selection means "no filter". The
 * menu stays open while toggling so several can be picked at once.
 */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  icon,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Optional leading icon shown before the label in the trigger. */
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <DropdownMenu>
      <FilterTrigger
        label={label}
        icon={icon}
        badge={selected.length > 0 ? selected.length : undefined}
      />
      <DropdownMenuContent
        align="start"
        className="max-h-[320px] overflow-y-auto"
      >
        {options.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            No options
          </div>
        )}
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={selected.includes(o.value)}
            // Keep the menu open so multiple options can be toggled in one go.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onChange(toggleValue(selected, o.value))}
          >
            {o.icon && (
              <span className="ml-0.5 mr-0.5 flex shrink-0">{o.icon}</span>
            )}
            <span className="flex-1 truncate">{o.label}</span>
            {o.count != null && (
              <span className="ml-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                {o.count}
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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

/** The segmented switch at a table page's top right (Owned | Archive). */
export function ViewSwitch({
  label,
  options,
}: {
  /** Accessible name for the group. */
  label: string;
  options: {
    id: string;
    label: string;
    count: number;
    active: boolean;
    onClick: () => void;
  }[];
}) {
  return (
    <SegmentedControl
      aria-label={label}
      className="mt-1 self-start sm:mt-[7px]"
      value={options.find((o) => o.active)?.id ?? ''}
      onChange={(id) => options.find((o) => o.id === id)?.onClick()}
      options={options.map((o) => ({
        value: o.id,
        label: o.label,
        count: o.count,
      }))}
    />
  );
}
