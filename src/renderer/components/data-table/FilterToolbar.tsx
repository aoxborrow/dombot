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
function SmallCaps({
  children,
  bold,
}: {
  children: ReactNode;
  bold?: boolean;
}) {
  return (
    <span
      className={cn(
        'text-[11px] tracking-wider uppercase',
        bold && 'max-sm:text-xs max-sm:font-semibold',
      )}
    >
      {children}
    </span>
  );
}

/** The icon a size under the switch's default, to suit the small caps. */
const iconCache = new Map<LucideIcon, LucideIcon>();
function small(Icon: LucideIcon) {
  let out = iconCache.get(Icon);
  if (!out) {
    out = function SmallIcon({ className }: { className?: string }) {
      return <Icon className={cn(className, 'size-3')} />;
    } as LucideIcon;
    iconCache.set(Icon, out);
  }
  return out;
}

/**
 * The page's main switch (Owned/Listings/Archive, Needs review/All), leading the
 * toolbar: small-caps labels with an icon and a count. With `fillOnPhone`
 * it spans a phone's width, the options sharing it; from sm it's its
 * usual size.
 */
export function ToolbarSwitch({
  label,
  options,
  fillOnPhone = false,
  className,
}: {
  /** Accessible name for the group. */
  label: string;
  fillOnPhone?: boolean;
  className?: string;
  options: {
    id: string;
    /** Text, or a shorter form on phones (Manual renew → Manual). */
    label: ReactNode;
    icon: LucideIcon;
    count: number;
    active: boolean;
    onClick: () => void;
  }[];
}) {
  return (
    <ViewSwitch
      label={label}
      // The chosen segment a pixel inside the border all round, tighter round
      // the smaller icon (a pixel off each side), and squarer
      // corners where the segments meet; the outer ones stay round.
      className={cn(
        'gap-px p-px [&_[role=radio]]:gap-[7px] [&_[role=radio]]:pl-[11px] [&_[role=radio]]:rounded-[6px] [&_[role=radio]:not(:first-child)]:rounded-l-[2px] [&_[role=radio]:not(:last-child)]:rounded-r-[2px] [&_[role=radio]_.tabular-nums]:text-[10px] [&_[role=radio]_.items-baseline]:gap-1',
        // A dim rule between two options side by side that aren't chosen,
        // filling the 1px gap between them, border to border (three options: the chosen one sets
        // the rest apart already).
        "[&_[role=radio][aria-checked=false]+[role=radio][aria-checked=false]]:relative [&_[role=radio][aria-checked=false]+[role=radio][aria-checked=false]]:before:absolute [&_[role=radio][aria-checked=false]+[role=radio][aria-checked=false]]:before:-inset-y-px [&_[role=radio][aria-checked=false]+[role=radio][aria-checked=false]]:before:-left-px [&_[role=radio][aria-checked=false]+[role=radio][aria-checked=false]]:before:w-px [&_[role=radio][aria-checked=false]+[role=radio][aria-checked=false]]:before:bg-foreground/20 dark:[&_[role=radio][aria-checked=false]+[role=radio][aria-checked=false]]:before:bg-foreground/10 [&_[role=radio][aria-checked=false]+[role=radio][aria-checked=false]]:before:content-['']",
        fillOnPhone &&
          // A size up all round, with the room.
          'max-sm:flex max-sm:h-10 max-sm:w-full max-sm:[&_[role=radio]]:flex-1 max-sm:[&_[role=radio]_svg]:size-3.5 max-sm:[&_[role=radio]_.tabular-nums]:text-[11px]',
        className,
      )}
      options={options.map((o) => ({
        ...o,
        label: <SmallCaps bold={fillOnPhone}>{o.label}</SmallCaps>,
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
      {/* Before the search from lg; narrower, on a row of its own above
          it, still on the left (a phone's fills that row). */}
      {viewSwitch && <div className="max-lg:basis-full">{viewSwitch}</div>}
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
