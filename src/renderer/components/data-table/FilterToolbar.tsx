import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FilterBar, type FilterField, type ListField } from './FilterBar';
import { SearchField, ViewSwitch } from './Toolbar';

// A table page's toolbar, as on Domains and Activity: the page's main switch,
// the search, then the filter chips and "+ Add filter", all wrapping together.

/** A checkbox-list filter field; `onChange` gets the new selection. */
export function listField(
  field: Omit<ListField, 'kind' | 'onChange'>,
  onChange: (next: string[]) => void,
): FilterField {
  return { ...field, kind: 'list', onChange };
}

/** Small caps, like the table's column names, so the options read as labels. */
function SmallCaps({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] tracking-wider uppercase">{children}</span>
  );
}

/** The icon a size under the switch's default, to suit the small caps. */
const iconCache = new Map<LucideIcon, LucideIcon>();
function small(Icon: LucideIcon) {
  let out = iconCache.get(Icon);
  if (!out) {
    out = function SmallIcon({ className }: { className?: string }) {
      return <Icon className={cn(className, 'size-3.5')} />;
    } as LucideIcon;
    iconCache.set(Icon, out);
  }
  return out;
}

/**
 * The page's main switch (Active/Archive, Needs review/All), leading the
 * toolbar: small-caps labels with an icon and a count.
 */
export function ToolbarSwitch({
  label,
  options,
}: {
  /** Accessible name for the group. */
  label: string;
  options: {
    id: string;
    label: string;
    icon: LucideIcon;
    count: number;
    active: boolean;
    onClick: () => void;
  }[];
}) {
  return (
    <ViewSwitch
      label={label}
      // Tighter round the smaller icon (a pixel off each side), and squarer
      // corners where the segments meet; the outer ones stay round. The
      // chosen segment is solid brand green, like Sync now, with white text
      // that stays white on hover and a dimmer white count.
      className={cn(
        '[&_[role=radio]]:gap-[7px] [&_[role=radio]]:pl-[11px] [&_[role=radio]:not(:first-child)]:rounded-l-[2px] [&_[role=radio]:not(:last-child)]:rounded-r-[2px]',
        '[&_[aria-checked=true]]:bg-primary! [&_[aria-checked=true]]:text-primary-foreground! [&_[aria-checked=true]_.tabular-nums]:text-primary-foreground/75!',
      )}
      options={options.map((o) => ({
        ...o,
        label: <SmallCaps>{o.label}</SmallCaps>,
        icon: small(o.icon),
      }))}
    />
  );
}

/**
 * The toolbar row: `switch` first, then the search, then the filter bar
 * (see FilterBar: `presets` are the chips shown from the start). `children`
 * go on the end, e.g. a status note.
 */
export function FilterToolbar({
  id,
  switch: viewSwitch,
  search,
  onSearch,
  searchPlaceholder,
  fields,
  presets,
  children,
}: {
  /** Names the filter bar, for its memory of removed presets. */
  id: string;
  switch?: ReactNode;
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  fields: FilterField[];
  presets?: string[];
  children?: ReactNode;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-3.5 sm:mt-3">
      {viewSwitch}
      <SearchField
        value={search}
        onChange={onSearch}
        placeholder={searchPlaceholder}
        className="flex-[0_1_216px]"
      />
      <FilterBar id={id} fields={fields} presets={presets} variant="flat" />
      {children}
    </div>
  );
}
