import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Plus, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FilterOption } from './Toolbar';

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

// The filter green, from the design: the chip tint and the green value text
// in the Add filter menu (with dark variants).
const GREEN_TINT = 'bg-[#f1f8f3] dark:bg-[#4f9d6b]/13';
const GREEN_TEXT = 'text-[#337544] dark:text-[#7cc495]';

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
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          stopMenuKeys(e);
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder.replace(/…$/, '')}
        className="h-8 w-full rounded-md border border-input bg-muted pr-2 pl-7 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-background"
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
  const toggle = (value: string) =>
    field.onChange(
      field.selected.includes(value)
        ? field.selected.filter((v) => v !== value)
        : [...field.selected, value],
    );
  return (
    <>
      {field.options.length > SEARCHABLE && (
        <MenuSearch
          value={query}
          onChange={setQuery}
          placeholder={`Search ${field.plural}…`}
        />
      )}
      <div className="max-h-[300px] overflow-y-auto">
        {options.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">
            {field.options.length === 0 ? 'No options' : 'No matches'}
          </div>
        )}
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={field.selected.includes(o.value)}
            // Keep the menu open so several can be picked in one go.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(o.value)}
          >
            {o.icon && <span className="mx-0.5 flex shrink-0">{o.icon}</span>}
            <span className="flex-1 truncate">{o.label}</span>
            {o.count != null && (
              <span className="ml-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                {o.count}
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
      </div>
    </>
  );
}

/**
 * How a chip looks. `segmented`: the name on a green tint, split by a line
 * from the value on the field background. `flat`: the whole chip on the
 * tint, name and value side by side.
 */
export type FilterChipVariant = 'segmented' | 'flat';

/** One active filter: [icon name | value ×], its dropdown editing the value. */
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
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <span
        className={cn(
          'inline-flex h-9 items-stretch overflow-hidden rounded-md border border-[#cfe3d5] text-sm transition-shadow dark:border-[#4f9d6b]/40',
          flat ? GREEN_TINT : 'bg-background dark:bg-input/30',
          // The app's focus ring (2px, ring/50) while open or keyboard-
          // focused: the chip's own border takes the ring colour and a 1px
          // ring goes outside it, so the band stays 2px rather than border
          // plus ring. Nothing else changes.
          'has-[:focus-visible]:border-ring/50 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring/50 dark:has-[:focus-visible]:border-ring/50',
          open && 'border-ring/50 ring-1 ring-ring/50 dark:border-ring/50',
        )}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${field.label}: ${summary ?? 'choose'}`}
            className="flex items-stretch whitespace-nowrap outline-none"
          >
            <span
              className={cn(
                'flex items-center gap-[7px] pl-2.5 text-[#4a6b55] dark:text-[#8fc7a2]',
                flat
                  ? 'pr-1'
                  : `border-r border-[#e3eee6] pr-2.5 dark:border-[#4f9d6b]/25 ${GREEN_TINT}`,
              )}
            >
              <Icon className="size-4" />
              {field.label}
            </span>
            <span
              className={cn(
                'flex items-center pr-1',
                flat ? 'pl-1' : 'pl-2.5',
                summary
                  ? 'text-[#3a3a3a] underline decoration-[color-mix(in_srgb,#3a3a3a_55%,transparent)] decoration-dotted underline-offset-2 dark:text-[#d4d4d4] dark:decoration-[color-mix(in_srgb,#d4d4d4_38%,transparent)]'
                  : 'text-muted-foreground',
              )}
            >
              {summary ?? 'Choose…'}
            </span>
          </button>
        </DropdownMenuTrigger>
        <button
          type="button"
          aria-label={`Remove ${field.label} filter`}
          title="Remove filter"
          onClick={onRemove}
          className="flex items-center pr-[9px] pl-[5px] text-muted-foreground opacity-55 outline-none hover:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      </span>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className={field.kind === 'list' ? 'w-60' : 'w-auto'}
        // Stay on the chip, not its trigger half, when the menu closes.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {field.kind === 'list' ? <ListMenu field={field} /> : field.content}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "+ Add filter" and its menu of fields, with a find box once it's long. */
function AddFilter({
  fields,
  onPick,
}: {
  fields: FilterField[];
  onPick: (key: string) => void;
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
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            // Neutral: hover and open lift the text and fill a light grey,
            // like the outline buttons; keyboard focus gets the app's ring.
            'inline-flex h-9 items-center gap-1.5 rounded-md border border-dashed border-input pr-3 pl-[9px] text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 dark:border-muted-foreground/40 dark:hover:bg-input/50',
            open && 'bg-accent text-foreground dark:bg-input/50',
          )}
        >
          <Plus className="size-3.5" />
          Add filter
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={10}
        className="w-[260px]"
        // A pick hands focus to the new chip's menu; don't pull it back here.
        onCloseAutoFocus={(e) => {
          if (picked.current) e.preventDefault();
          picked.current = false;
        }}
      >
        {/* Only once there are enough fields to need it. */}
        {fields.length > SEARCHABLE && (
          <MenuSearch
            value={query}
            onChange={setQuery}
            placeholder="Find a filter…"
            onEnter={() => {
              if (shown.length === 0) return;
              choose(shown[0].key);
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
          const summary = summaryOf(f);
          return (
            <DropdownMenuItem key={f.key} onSelect={() => choose(f.key)}>
              <Icon />
              {f.label}
              {summary && (
                <span
                  className={cn(
                    'ml-auto max-w-32 truncate pl-3 text-xs font-medium',
                    GREEN_TEXT,
                  )}
                >
                  {summary}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The Add filter button and a chip per active filter, in the order they were
 * added. Rendered inline (a fragment), so they wrap with the toolbar around
 * them. Picking a field adds its chip with the value list open; picking one
 * already in use opens its chip instead. A chip closed with nothing set goes
 * away.
 */
export function FilterBar({
  fields,
  variant = 'segmented',
}: {
  fields: FilterField[];
  /** The chips' look; see FilterChipVariant. */
  variant?: FilterChipVariant;
}) {
  // Chip order; a field set elsewhere (not through the menu) joins at the end.
  const [order, setOrder] = useState<string[]>([]);
  // The chip whose dropdown is open; it stays while open even if unset.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const active = (f: FilterField) => summaryOf(f) !== null;
  const keys = [
    ...order.filter((k) => byKey.has(k)),
    ...fields.filter((f) => !order.includes(f.key)).map((f) => f.key),
  ];
  const chips = keys
    .map((k) => byKey.get(k)!)
    .filter((f) => active(f) || f.key === openKey);

  function pick(key: string) {
    // A new chip goes at the end; one already showing stays put.
    if (!chips.some((f) => f.key === key))
      setOrder((o) => [...o.filter((k) => k !== key), key]);
    // After the Add filter menu has closed, so the two don't fight over focus.
    requestAnimationFrame(() => setOpenKey(key));
  }

  function remove(field: FilterField) {
    clearField(field);
    setOpenKey(null);
    setOrder((o) => o.filter((k) => k !== field.key));
  }

  return (
    <>
      <AddFilter fields={fields} onPick={pick} />
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
    </>
  );
}
