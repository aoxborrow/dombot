import {
  Fragment,
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FilterOption } from './Toolbar';
import { DomainTableScroll } from '../../lib/domain-table-scroll';
import { FilterPlusIcon } from '../icons/FilterPlusIcon';

// A table's filter bar: "+ Add filter" opens a menu of fields, and each field
// in use becomes a chip (name | value | ×) whose dropdown edits it. Only the
// filters you set take up room; there's no Reset, each chip clears itself.

type Icon = ComponentType<{ className?: string }>;

interface FieldBase {
  key: string;
  label: string;
  icon: Icon;
}

/** A multi-select field: a checkbox list with counts. Empty means unset. */
export interface ListField extends FieldBase {
  kind: 'list';
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** For the chip past two values, e.g. "registrars" in "3 registrars". */
  plural: string;
}

/** A field with its own editor (e.g. a price range) and summary. */
export interface CustomField extends FieldBase {
  kind: 'custom';
  /** The chip's value text; null while the field is unset. */
  summary: string | null;
  onClear: () => void;
  /** The editor, shown in the chip's dropdown. */
  content: ReactNode;
}

export type FilterField = ListField | CustomField;

/** The chip's value text: up to two labels, then a count. */
function summaryOf(field: FilterField): string | null {
  if (field.kind === 'custom') return field.summary;
  if (field.selected.length === 0) return null;
  if (field.selected.length > 2)
    return `${field.selected.length} ${field.plural}`;
  return field.selected
    .map((v) => field.options.find((o) => o.value === v)?.label ?? v)
    .join(', ');
}

function clearField(field: FilterField) {
  if (field.kind === 'custom') field.onClear();
  else field.onChange([]);
}

/** Lists (and the Add filter menu) longer than this get a search box. */
const SEARCHABLE = 8;

// The filter green, from the design: the set chip's tint (with its dark
// variant).
const GREEN_TINT = 'bg-[#f1f8f3] dark:bg-[#4f9d6b]/13';

/**
 * Keeps typing in a menu's text field out of the menu's typeahead. Arrow keys
 * still move into the menu's items and Escape still closes it.
 */
export function stopMenuKeys(e: KeyboardEvent) {
  if (e.key.length === 1 || e.key === 'Home' || e.key === 'End')
    e.stopPropagation();
}

/** A small search field at the top of a menu. */
function MenuSearch({
  value,
  onChange,
  placeholder,
  onEnter,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Enter in the field, e.g. to pick the first match. */
  onEnter?: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Focused quietly as the menu opens, so typing lands here without the
  // field looking selected; its focus border shows once you type or click.
  const [engaged, setEngaged] = useState(false);
  // The menu focuses itself as it opens; take focus once it has.
  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="relative p-1 pb-1.5">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => {
          setEngaged(true);
          onChange(e.target.value);
        }}
        onPointerDown={() => setEngaged(true)}
        onKeyDown={(e) => {
          stopMenuKeys(e);
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder.replace(/…$/, '')}
        className={cn(
          'h-8 w-full rounded-[6px] border border-input bg-muted pr-2 pl-7 text-[13px] outline-none placeholder:text-muted-foreground dark:bg-background',
          engaged && 'focus:border-[#337544] dark:focus:border-[#337544]',
        )}
      />
    </div>
  );
}

/** A list field's dropdown: search, then checkboxes with counts. */
function ListMenu({ field }: { field: ListField }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const options = q
    ? field.options.filter((o) => o.label.toLowerCase().includes(q))
    : field.options;
  // The boxes answer from local state at once; the page (filtering and the
  // table) follows in a transition, so a click never waits on its render.
  const [selected, setSelected] = useState(field.selected);
  useEffect(() => setSelected(field.selected), [field.selected]);
  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    setSelected(next);
    startTransition(() => field.onChange(next));
  };
  return (
    <>
      {field.options.length > SEARCHABLE && (
        <MenuSearch
          value={query}
          onChange={setQuery}
          placeholder={`Search ${field.plural}…`}
        />
      )}
      {/* The app's overlay scrollbar: hidden until hovered or scrolled, so
          there's no wide native bar. */}
      <DomainTableScroll className="domain-table-scroll max-h-[300px] overflow-x-hidden overflow-y-auto">
        {/* A gutter on the right for the scroll thumb, clear of the counts. */}
        <div className="pr-2">
          {options.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              {field.options.length === 0 ? 'No options' : 'No matches'}
            </div>
          )}
          {options.map((o, i) => (
            <Fragment key={o.value}>
              {o.divider && i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuCheckboxItem
                checked={selected.includes(o.value)}
                // Keep the menu open so several can be picked in one go.
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => toggle(o.value)}
              >
                {o.icon && (
                  <span className="mx-0.5 flex shrink-0">{o.icon}</span>
                )}
                <span className="flex-1 truncate">{o.label}</span>
                {o.count != null && (
                  <span className="ml-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {o.count}
                  </span>
                )}
              </DropdownMenuCheckboxItem>
            </Fragment>
          ))}
        </div>
      </DomainTableScroll>
    </>
  );
}

/**
 * How a chip looks. `segmented`: the name on a green tint, split by a line
 * from the value on the field background. `flat`: the whole chip on the
 * tint, name and value side by side.
 */
export type FilterChipVariant = 'segmented' | 'flat';

/**
 * One filter: [icon name value ×], its dropdown editing the value. With
 * nothing set it's a dashed grey outline with just its icon and name.
 */
function FilterChip({
  field,
  open,
  onOpenChange,
  onRemove,
  variant,
}: {
  field: FilterField;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: () => void;
  variant: FilterChipVariant;
}) {
  const Icon = field.icon;
  const summary = summaryOf(field);
  const flat = variant === 'flat';
  const empty = summary === null;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <span
        className={cn(
          'relative inline-flex h-9 items-stretch overflow-hidden rounded-md border text-sm',
          // An empty chip's dashes darken (brighten in dark mode) while its
          // name is hovered; hovering the × leaves them be.
          empty
            ? 'border-dashed border-[#d4d4d4] transition-colors has-[[data-chip-trigger]:hover]:border-[#a3a3a3] dark:border-muted-foreground/40 dark:has-[[data-chip-trigger]:hover]:border-muted-foreground/70'
            : cn(
                'border-[#b9d6c2] transition-colors dark:border-[#4f9d6b]/40',
                // A set chip's border deepens a step while its name/value is
                // hovered (not while open: the open green wins).
                !open &&
                  'has-[[data-chip-trigger]:hover]:border-[#9cc5a8] dark:has-[[data-chip-trigger]:hover]:border-[#4f9d6b]/60',
                flat ? GREEN_TINT : 'bg-background dark:bg-input/30',
              ),
          // Open (or keyboard-focused): a set chip's border turns filter
          // green; an empty one's dashes just turn a lighter grey.
          empty
            ? 'has-[:focus-visible]:border-muted-foreground/50 dark:has-[:focus-visible]:border-muted-foreground/80'
            : 'has-[:focus-visible]:border-[#4f9d6b] dark:has-[:focus-visible]:border-[#4f9d6b]',
          open &&
            (empty
              ? 'border-muted-foreground/50 dark:border-muted-foreground/80'
              : 'border-[#4f9d6b] dark:border-[#4f9d6b]'),
        )}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${field.label}: ${summary ?? 'any'}`}
            // The whole chip but the × opens the menu; the right padding
            // keeps the text clear of the × above it.
            data-chip-trigger
            className="group/trigger flex items-stretch pr-7 whitespace-nowrap outline-none"
          >
            <span
              className={cn(
                'flex items-center gap-[7px] pl-2.5',
                empty
                  ? 'pr-1 text-muted-foreground transition-colors group-hover/trigger:text-[#404040] dark:group-hover/trigger:text-foreground'
                  : 'text-[#4a6b55] transition-colors group-hover/trigger:text-[#3a5644] dark:text-[#8fc7a2] dark:group-hover/trigger:text-[#a8d5b7]',
                !empty &&
                  (flat
                    ? 'pr-1'
                    : `border-r border-[#e3eee6] pr-2.5 dark:border-[#4f9d6b]/25 ${GREEN_TINT}`),
              )}
            >
              <Icon className="size-4" />
              {field.label}
            </span>
            {/* An empty chip has no value text at all. */}
            {!empty && (
              <span
                className={cn(
                  // The underline is the value's grey with about 40% of the label
                  // green mixed in, at 55% (38% dark).
                  'flex items-center pr-1 text-[#3a3a3a] underline decoration-[color-mix(in_srgb,#42604d_55%,transparent)] decoration-dotted underline-offset-2 dark:text-[#d4d4d4] dark:decoration-[color-mix(in_srgb,#bacfc1_38%,transparent)]',
                  flat ? 'pl-1' : 'pl-2.5',
                )}
              >
                {summary}
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <button
          type="button"
          aria-label={`Remove ${field.label} filter`}
          title="Remove filter"
          onClick={onRemove}
          className={cn(
            // Vertically centred where it always was, but the hitbox starts at
            // the icon (no padding on its left), over the trigger, so a click
            // just past the value doesn't land on it.
            'group/remove absolute inset-y-0 right-0 flex items-center rounded-r-md pr-[9px] opacity-55 outline-none hover:opacity-100',
            // On a set chip, muted grey with a hint of the label green. Hover
            // darkens it (brightens it in dark mode) and tints a small square
            // behind it, so it's plain when the pointer is on it.
            empty
              ? 'text-muted-foreground hover:text-[#515151] dark:hover:text-foreground'
              : 'text-[#658370] hover:text-[#475c4e] dark:text-[#9aafa1] dark:hover:text-[#d4e6da]',
          )}
        >
          {/* The hover square; the negative margin keeps the icon in place. */}
          <span
            className={cn(
              '-m-[3px] flex rounded-[4px] p-[3px] transition-colors',
              empty
                ? 'group-hover/remove:bg-black/6 dark:group-hover/remove:bg-white/15'
                : 'group-hover/remove:bg-[#4f9d6b]/14 dark:group-hover/remove:bg-[#4f9d6b]/40',
            )}
          >
            <X className="size-3.5" />
          </span>
        </button>
      </span>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className={field.kind === 'list' ? 'w-60' : 'w-auto'}
        // Stay on the chip, not its trigger half, when the menu closes.
        onCloseAutoFocus={(e) => e.preventDefault()}
        // The menu focuses its own panel as it opens; hand that on to the
        // panel's first field (a search box, Min), so typing lands there.
        onFocus={(e) => {
          if (e.target === e.currentTarget)
            e.currentTarget.querySelector('input')?.focus();
        }}
      >
        {field.kind === 'list' ? <ListMenu field={field} /> : field.content}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The Add filter button's box, and its labelled form's spacing.
const ADD_FILTER_BOX =
  'inline-flex h-9 items-center rounded-md border border-dashed text-sm whitespace-nowrap';
const ADD_FILTER_LABELLED = 'gap-1.5 pr-3 pl-[9px]';

/**
 * The menu of fields, opened from "+ Add filter", or from the square "+"
 * when only that fits after the last chip. Both stay grey in every state. A checkbox
 * marks each field already showing as a chip: ticking one adds its chip and
 * opens it, unticking one removes its chip (as its × would) and leaves the
 * menu open.
 */
function AddFilter({
  fields,
  showing,
  onPick,
  onRemove,
}: {
  fields: FilterField[];
  /** Keys of the fields showing as chips. */
  showing: Set<string>;
  /** A field was picked: add its chip and open it. */
  onPick: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const picked = useRef(false);
  const choose = (key: string) => {
    picked.current = true;
    onPick(key);
  };
  const q = query.trim().toLowerCase();
  const shown = q
    ? fields.filter((f) => f.label.toLowerCase().includes(q))
    : fields;
  // Labelled when "Add filter" fits on the line after the last chip, or when
  // the button wraps to a line of its own anyway; the square only where it
  // keeps the button on the chips' line and the label wouldn't.
  const ref = useRef<HTMLButtonElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const button = ref.current;
    const row = button?.parentElement;
    if (!button || !row) return;
    const update = () => {
      const prev = button.previousElementSibling;
      const full = measure.current?.offsetWidth;
      if (!prev || !full) return setCompact(false);
      const style = getComputedStyle(row);
      const start =
        prev.getBoundingClientRect().right + (parseFloat(style.columnGap) || 0);
      const end =
        row.getBoundingClientRect().right - parseFloat(style.paddingRight);
      const fits = (width: number) => start + width <= end + 0.5;
      setCompact(!fits(full) && fits(button.offsetHeight));
    };
    update();
    // The row's width, and the last chip's as its value changes.
    const observer = new ResizeObserver(update);
    observer.observe(row);
    if (button.previousElementSibling)
      observer.observe(button.previousElementSibling);
    return () => observer.disconnect();
  });
  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            ref={ref}
            type="button"
            aria-label="Add filter"
            title={compact ? 'Add filter' : undefined}
            className={cn(
              // Grey: hover darkens the dashes and text like an empty chip's
              // (brightens them in dark mode); keyboard focus gets the app's
              // ring. Open, the label fills a light grey like the outline
              // buttons; the square just darkens its icon.
              ADD_FILTER_BOX,
              'border-[#d4d4d4] text-muted-foreground transition-colors outline-none hover:border-[#a3a3a3] hover:text-[#404040] focus-visible:ring-2 focus-visible:ring-ring/50 dark:border-muted-foreground/40 dark:hover:border-muted-foreground/70 dark:hover:text-foreground',
              compact ? 'w-9 justify-center' : ADD_FILTER_LABELLED,
              open &&
                (compact
                  ? 'text-foreground'
                  : 'bg-accent text-foreground dark:bg-input/50'),
            )}
          >
            <FilterPlusIcon className="h-4 w-[17px]" />
            {!compact && 'Add filter'}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={10}
          // As wide as the longest field name needs, no wider.
          // While it fades out, ignore the pointer: hovering a closing menu
          // focuses it, which pulls focus from the picked chip's menu and
          // closes that.
          className="w-auto min-w-36 data-[state=closed]:pointer-events-none"
          // A pick hands focus to the new chip's menu; don't pull it back here.
          onCloseAutoFocus={(e) => {
            if (picked.current) e.preventDefault();
            picked.current = false;
          }}
        >
          <DropdownMenuLabel className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Add filter
          </DropdownMenuLabel>
          {/* Only once there are enough fields to need it. */}
          {fields.length > SEARCHABLE && (
            <MenuSearch
              value={query}
              onChange={setQuery}
              placeholder="Find a filter…"
              onEnter={() => {
                if (shown.length === 0) return;
                const key = shown[0].key;
                if (showing.has(key)) return onRemove(key);
                choose(key);
                setOpen(false);
                setQuery('');
              }}
            />
          )}
          {shown.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              No matches
            </div>
          )}
          {shown.map((f) => {
            const Icon = f.icon;
            return (
              <DropdownMenuCheckboxItem
                key={f.key}
                checked={showing.has(f.key)}
                onSelect={(e) => {
                  if (!showing.has(f.key)) return choose(f.key);
                  // Stay open, so several can go in one visit.
                  e.preventDefault();
                  onRemove(f.key);
                }}
              >
                <Icon />
                {f.label}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* The labelled button's twin, out of the flow, to measure. */}
      <span
        ref={measure}
        aria-hidden
        className={cn(
          ADD_FILTER_BOX,
          ADD_FILTER_LABELLED,
          'pointer-events-none invisible absolute top-0 left-0',
        )}
      >
        <FilterPlusIcon className="h-4 w-[17px]" />
        Add filter
      </span>
    </>
  );
}

// Presets removed with their ×, per bar `id`. In memory only: they stay
// removed for this session (navigating away and back included) and come back
// on the next one.
const removedPresets = new Map<string, Set<string>>();

/**
 * The filter chips, then the add button. The presets start the row; every
 * filter added from the menu (a removed preset too) goes on the end.
 * Rendered inline (a fragment), so everything wraps with the toolbar around
 * it. The add button reads "Add filter" unless only a square "+" would fit
 * after the last chip.
 *
 * Picking a field adds its chip with the value list open; unticking one in
 * the menu removes it. A chip stays until its × removes it, dashed and
 * empty while nothing is set, and never moves as its value is set or
 * cleared.
 */
export function FilterBar({
  id,
  fields,
  presets = [],
  variant = 'segmented',
}: {
  /** Names this bar for the session's memory of removed presets. */
  id: string;
  fields: FilterField[];
  /** Keys of the fields always shown, in order, even when unset. */
  presets?: string[];
  /** The chips' look; see FilterChipVariant. */
  variant?: FilterChipVariant;
}) {
  // Presets whose × was clicked this session.
  const [removed, setRemoved] = useState<Set<string>>(
    () => new Set(removedPresets.get(id)),
  );
  // Every chip, left to right: the presets not removed this session, then
  // each field as it's added (a re-added preset included), set or not. A
  // field set elsewhere (not through the menu) shows after them.
  const [order, setOrder] = useState<string[]>(() =>
    presets.filter((k) => !removed.has(k)),
  );
  // The chip whose dropdown is open.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const chips = [
    ...order.map((k) => byKey.get(k)),
    ...fields.filter((f) => !order.includes(f.key) && summaryOf(f) !== null),
  ].filter((f): f is FilterField => !!f);

  function setRemovedPresets(next: Set<string>) {
    removedPresets.set(id, next);
    setRemoved(next);
  }

  function pick(key: string) {
    // A new chip goes at the end; one already showing stays put.
    if (!order.includes(key)) setOrder((o) => [...o, key]);
    if (removed.has(key)) {
      const next = new Set(removed);
      next.delete(key);
      setRemovedPresets(next);
    }
    // After the Add filter menu has closed, so the two don't fight over focus.
    requestAnimationFrame(() => setOpenKey(key));
  }

  function remove(field: FilterField) {
    clearField(field);
    setOpenKey(null);
    setOrder((o) => o.filter((k) => k !== field.key));
    if (presets.includes(field.key))
      setRemovedPresets(new Set(removed).add(field.key));
  }

  return (
    <>
      {chips.map((f) => (
        <FilterChip
          key={f.key}
          field={f}
          open={openKey === f.key}
          onOpenChange={(open) => setOpenKey(open ? f.key : null)}
          onRemove={() => remove(f)}
          variant={variant}
        />
      ))}
      {/* Always last, so it stays mounted as chips come and go (with none,
          last is right after the search). */}
      <AddFilter
        fields={fields}
        showing={new Set(chips.map((f) => f.key))}
        onPick={pick}
        onRemove={(key) => {
          const field = byKey.get(key);
          if (field) remove(field);
        }}
      />
    </>
  );
}
