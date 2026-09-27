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

// The pieces of a table page's toolbar, shared by Domains and Activity:
// search on the left, filters, then Reset.

/** The search box, with a clear button that looks the same on every platform. */
export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative min-w-[140px] flex-1 max-sm:basis-full">
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
        active && 'border-[#4f9d6b] dark:border-[#4f9d6b]',
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
    <div
      role="radiogroup"
      aria-label={label}
      className="mt-1 inline-flex items-center gap-1 self-start rounded-lg border p-1 text-sm sm:mt-[7px]"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.active}
          onClick={option.onClick}
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-md px-3 font-medium text-muted-foreground outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-accent/50',
            option.active && 'bg-foreground/10 text-foreground dark:bg-accent',
          )}
        >
          {option.label}
          <span
            className={cn(
              'tabular-nums',
              option.active ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {option.count}
          </span>
        </button>
      ))}
    </div>
  );
}
