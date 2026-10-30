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
function SmallCaps({ children, xl }: { children: ReactNode; xl?: boolean }) {
  return (
    <span
      className={cn(
        'tracking-wider uppercase',
        // XL only from sm: a phone keeps the small type to fit.
        xl ? 'text-[11px] font-semibold sm:text-sm' : 'text-[11px]',
      )}
    >
      {children}
    </span>
  );
}

/** The icon at a fixed size: a size under the switch's default to suit the
 * small caps, or bigger for the XL switch. */
const iconCache = new Map<LucideIcon, Map<string, LucideIcon>>();
function sized(Icon: LucideIcon, size: string) {
  const bySize =
    iconCache.get(Icon) ?? iconCache.set(Icon, new Map()).get(Icon)!;
  let out = bySize.get(size);
  if (!out) {
    out = function SizedIcon({ className }: { className?: string }) {
      return <Icon className={cn(className, size)} />;
    } as LucideIcon;
    bySize.set(size, out);
  }
  return out;
}

/**
 * The page's main switch (Owned/Listings/Archive, Needs review/All), leading the
 * toolbar: small-caps labels with an icon and a count. `xl` spans the page,
 * the options sharing its width, with bigger type and icons.
 */
export function ToolbarSwitch({
  label,
  options,
  size = 'default',
  className,
}: {
  /** Accessible name for the group. */
  label: string;
  size?: 'default' | 'xl';
  className?: string;
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
      // corners where the segments meet; the outer ones stay round.
      className={cn(
        '[&_[role=radio]]:gap-[7px] [&_[role=radio]]:pl-[11px] [&_[role=radio]:not(:first-child)]:rounded-l-[2px] [&_[role=radio]:not(:last-child)]:rounded-r-[2px]',
        size === 'xl' &&
          'flex h-10 w-full sm:h-12 [&_[role=radio]]:flex-1 sm:[&_[role=radio]]:gap-2.5 sm:[&_[role=radio]]:px-3 sm:[&_[role=radio]_.tabular-nums]:text-sm',
        className,
      )}
      options={options.map((o) => ({
        ...o,
        label: <SmallCaps xl={size === 'xl'}>{o.label}</SmallCaps>,
        icon: sized(o.icon, size === 'xl' ? 'size-3.5 sm:size-5' : 'size-3.5'),
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
  searchPlaceholder = 'Search…',
  fields,
  presets,
  presetsIfRoom,
  children,
  className,
}: {
  /** Names the filter bar, for its memory of removed presets. */
  id: string;
  switch?: ReactNode;
  search: string;
  onSearch: (value: string) => void;
  /** "Search…" unless a page needs more. */
  searchPlaceholder?: string;
  fields: FilterField[];
  presets?: string[];
  /** Of `presets`, the ones shown only while there's room; see FilterBar. */
  presetsIfRoom?: string[];
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // No margin of its own: the page's 13px gap spaces it.
        'flex flex-wrap items-center gap-3.5',
        className,
      )}
    >
      {viewSwitch}
      <SearchField
        value={search}
        onChange={onSearch}
        placeholder={searchPlaceholder}
        // Short, so the chips get the room.
        // Full width on phones.
        className="min-w-24 flex-[0_1_160px]"
      />
      <FilterBar
        id={id}
        fields={fields}
        presets={presets}
        presetsIfRoom={presetsIfRoom}
        variant="flat"
      />
      {children}
    </div>
  );
}
