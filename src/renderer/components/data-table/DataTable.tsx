import { useRef, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
} from 'lucide-react';
import { DomainTableScroll } from '../../lib/domain-table-scroll';
import { DensityMediumIcon, DensitySmallIcon } from '../icons/DensityIcons';
import {
  PAGE_SIZES,
  usePreferences,
  type Preferences,
} from '../../lib/preferences';
import { paginate, rangeKeys, type SortDir } from './table-state';
import { applyColumnLayout, type ColumnLayout } from './column-layout';
import { ColumnPicker } from './ColumnPicker';
import { cn } from '@/lib/utils';
import {
  SegmentedControl,
  type SegmentedOption,
} from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface DataColumn<T> {
  key: string;
  label: ReactNode;
  /** The column's name as text, for the column picker when `label` isn't a string. */
  title?: string;
  /** With a layout: always shown, first, and not movable. */
  locked?: boolean;
  /** With a layout: off until the column picker turns it on. */
  defaultHidden?: boolean;
  cell: (row: T) => ReactNode;
  /** Clicking the header sorts by `key` (default true). */
  sortable?: boolean;
  /** Right-align numeric-ish columns, or center the state/flag columns. */
  align?: 'left' | 'right' | 'center';
  /** Narrow column (trims padding): the yes/no flag columns. */
  compact?: boolean;
  /** Dropped below sm to trim the table on phones. */
  hideOnMobile?: boolean;
  headClassName?: string;
  cellClassName?: string;
}

/** Row selection, owned by the page (the Domains selection lives in the store). */
export interface TableSelection<T> {
  selected: ReadonlySet<string>;
  toggle: (key: string) => void;
  setMany: (keys: string[], on: boolean) => void;
  /** e.g. "Select all domains". */
  allLabel: string;
  /** e.g. "Select example.com". */
  rowLabel: (row: T) => string;
}

/**
 * The app's table: sortable headers that stick to the top of a scroll area
 * with overlay scrollbars, an optional selection column (shift-click selects
 * a range), an empty-state row, and pagination underneath. The page owns the
 * data, its order, and the sort and page state; `rows` is every row in table
 * order, and the table shows the current page.
 */
export function DataTable<T>({
  rows,
  columns: allColumns,
  rowKey,
  sort,
  onSort,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  selection,
  rowClassName,
  empty,
  className,
  density: fixedDensity,
  layout,
  onLayoutChange,
  forceVisible,
}: {
  rows: T[];
  /** Every column, in default order. With a `layout`, it picks and orders them. */
  columns: DataColumn<T>[];
  rowKey: (row: T) => string;
  sort: { key: string; dir: SortDir };
  onSort: (key: string) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  selection?: TableSelection<T>;
  /** Extra row classes. Leave selected rows alone so the selection shows. */
  rowClassName?: (row: T, selected: boolean) => string | false | undefined;
  /** Shown in a single row when there are no rows. */
  empty: ReactNode;
  /** Extra classes on the outer container (e.g. spacing above). */
  className?: string;
  /** A fixed density: ignores the preference and hides its switch. */
  density?: Preferences['density'];
  /** Which columns show and in what order (see ColumnPicker / useColumnLayout). */
  layout?: ColumnLayout;
  /** With a `layout`: the Columns button goes in the footer, first. */
  onLayoutChange?: (next: ColumnLayout) => void;
  /** Columns shown even while the layout hides them, e.g. one being filtered. */
  forceVisible?: readonly string[];
}) {
  const columns = layout
    ? applyColumnLayout(allColumns, layout, forceVisible)
    : allColumns;
  const preferred = usePreferences((s) => s.density);
  const density = fixedDensity ?? preferred;
  const setPreferences = usePreferences((s) => s.setPreferences);
  const {
    pageCount,
    page: current,
    start,
    end,
  } = paginate(rows.length, page, pageSize);
  const visible = rows.slice(start, end);

  // Header checkbox reflects every row (across pages): checked when all are
  // selected, indeterminate when only some are.
  const keys = selection ? rows.map(rowKey) : [];
  const allSelected =
    !!selection &&
    keys.length > 0 &&
    keys.every((k) => selection.selected.has(k));
  const someSelected =
    !!selection && !allSelected && keys.some((k) => selection.selected.has(k));
  // The row last clicked without Shift; Shift-click selects from it through
  // the clicked row, in table order.
  const anchor = useRef<string | null>(null);
  const selectRow = (key: string, shift: boolean) => {
    if (!selection) return;
    const range = shift ? rangeKeys(keys, anchor.current, key) : null;
    if (range) {
      selection.setMany(range, true);
      return;
    }
    selection.toggle(key);
    anchor.current = key;
  };

  // The first data column reads as part of the checkbox column: no divider.
  // Without one (Sales), it gets more room on the left instead.
  const firstCell = (i: number) =>
    i === 0 && (selection ? 'border-l-0! pl-3' : 'pl-4');

  return (
    <div
      className={cn(
        // A container, so the empty-state row can size itself to the
        // visible width (cqw) rather than the table's.
        '@container flex min-h-36 min-w-0 flex-1 flex-col gap-[13px] short:gap-[9px]',
        className,
      )}
    >
      {/* This region scrolls; the column names stick to its top and move
          sideways with the columns. Overlay bars sit on the host. */}
      <DomainTableScroll
        className={cn(
          // Row height is set by the cells' vertical padding around one line of
          // text (icon buttons overlap into it with negative margins, so they
          // don't drive it): 45px normal, ~36px compact. align-top keeps
          // inline-level cell content (checkbox, switch, inline-flex spans)
          // from adding baseline descent under the line box. Column rules
          // sit between cells only: the outer cells' would double the frame's
          // border, a darker strip just inside it. In the body each rule is
          // the cell's own inset shadow on its right edge, not a border:
          // Chrome doesn't paint a hovered row's background under the
          // borders of a positioned cell (the cells with a click overlay),
          // so their rules showed darker than the rest.
          'domain-table-scroll absolute inset-0 overflow-auto rounded-lg border [&_td]:shadow-[inset_-1px_0_0_color-mix(in_oklab,var(--border)_50%,transparent)] [&_th]:border-x [&_th]:border-x-border/50 [&_tr>*:first-child]:border-l-0 [&_tr>*:last-child]:border-r-0 [&_tr>td:last-child]:shadow-none [&_td]:py-3 [&_td>*]:align-top compact:[&_td]:py-[9px]',
          density === 'compact' && 'compact',
        )}
      >
        {/* Slightly smaller body text when compact (headers keep their own
            sizes); cells with an explicit size opt down separately. */}
        <Table scrollable={false} className="compact:text-xs">
          <TableHeader className="sticky top-0 z-10 bg-muted [&_th]:bg-muted">
            <TableRow className="[&_th]:h-8 [&_th]:font-medium [&_th]:tracking-wider [&_th]:text-muted-foreground [&_button]:text-[10px] [&_button]:uppercase">
              {selection && (
                <TableHead className="w-0 border-r-0! pl-3">
                  <Checkbox
                    checked={
                      allSelected
                        ? true
                        : someSelected
                          ? 'indeterminate'
                          : false
                    }
                    onCheckedChange={() =>
                      selection.setMany(keys, !allSelected)
                    }
                    aria-label={selection.allLabel}
                    // On the grey header the default fill reads as disabled:
                    // match the row checkboxes' fill, a touch darker.
                    className="bg-[color-mix(in_oklab,var(--background),black_4%)] dark:bg-[color-mix(in_oklab,var(--background),white_3%)]"
                  />
                </TableHead>
              )}
              {columns.map((col, i) => {
                const active = col.key === sort.key;
                const Icon = !active
                  ? ChevronsUpDown
                  : sort.dir === 'asc'
                    ? ArrowUp
                    : ArrowDown;
                return (
                  <TableHead
                    key={col.key}
                    className={cn(
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                      col.compact && 'w-0 px-1.5',
                      firstCell(i),
                      col.hideOnMobile && 'hidden sm:table-cell',
                      col.headClassName,
                    )}
                  >
                    {col.sortable === false ? (
                      <span className="text-[10px] uppercase select-none">
                        {col.label}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSort(col.key)}
                        className={cn(
                          'inline-flex items-center gap-1 select-none hover:text-foreground',
                          // The narrow flag columns: nudge label + chevron
                          // right so the label sits visually over the icons.
                          col.compact && 'gap-0.5 translate-x-0.5',
                          active && 'text-foreground',
                        )}
                      >
                        {col.label}
                        <Icon className="size-3.5 opacity-70" />
                      </button>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          {/* The last row keeps its border: short tables don't fill the area.
              The empty-state row doesn't: it isn't a row of data. */}
          <TableBody
            className={cn(
              visible.length > 0
                ? '[&_tr:last-child]:border-b!'
                : '[&_tr:last-child]:border-b-0',
            )}
          >
            {visible.map((row) => {
              const key = rowKey(row);
              const isSelected = !!selection?.selected.has(key);
              return (
                <TableRow
                  key={key}
                  // `group/row` lets a cell reveal controls on row hover.
                  className={cn(
                    'group/row',
                    isSelected && 'bg-muted/50',
                    rowClassName?.(row, isSelected),
                  )}
                >
                  {selection && (
                    // Compact rows: no 2px nudge down, or the box sits low.
                    <TableCell className="w-0 border-r-0! pl-3 shadow-none! compact:[&>[role=checkbox]]:translate-y-0">
                      <Checkbox
                        checked={isSelected}
                        onMouseDown={(e) => {
                          if (e.shiftKey) e.preventDefault();
                        }}
                        onClick={(e) => {
                          if (!e.shiftKey) return;
                          // Skip the checkbox's own toggle; the range is
                          // applied instead.
                          e.preventDefault();
                          selectRow(key, true);
                        }}
                        onCheckedChange={() => selectRow(key, false)}
                        aria-label={selection.rowLabel(row)}
                      />
                    </TableCell>
                  )}
                  {columns.map((col, i) => (
                    <TableCell
                      key={col.key}
                      className={cn(
                        col.align === 'right' && 'text-right',
                        col.align === 'center' && 'text-center',
                        col.compact && 'w-0 px-1.5',
                        firstCell(i),
                        col.hideOnMobile && 'hidden sm:table-cell',
                        col.cellClassName,
                      )}
                    >
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
            {visible.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length + (selection ? 1 : 0)}
                  className="h-40 text-center text-muted-foreground"
                >
                  {/* Pinned to the visible width, less the frame's border and
                      the cell's padding, so it stays centred in view when the
                      columns are wider than the screen. A plain sentence (no
                      matches) is the size of an EmptyState title; an EmptyState
                      sets its own sizes. */}
                  <div className="sticky left-0 w-[calc(100cqw-18px)] text-lg">
                    {empty}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </DomainTableScroll>

      {/* Pagination stays under the table, outside the scroll, so the row
          count and page buttons stay on screen. Always one row: as the table
          narrows, pieces drop out at the widths they stop fitting (container
          queries on the footer, with room for counts in the thousands):
          Density, then Columns, then the range ("51–100 of 251"), then First
          and Last, then the "Rows per page" label, then the select. */}
      <div className="@container/footer flex shrink-0 items-center justify-between gap-4 text-sm text-muted-foreground">
        <div className="flex shrink-0 items-center gap-2">
          {/* Columns, then density, then rows per page. */}
          {layout && onLayoutChange && (
            <div className="mr-3 @max-[680px]/footer:hidden">
              <ColumnPicker
                columns={allColumns}
                layout={layout}
                onChange={onLayoutChange}
                forceVisible={forceVisible}
                footer
              />
            </div>
          )}
          {!fixedDensity && (
            <DensitySwitch
              value={density}
              onChange={(next) => setPreferences({ density: next })}
            />
          )}
          <span className="whitespace-nowrap @max-[330px]/footer:hidden">
            Rows per page
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => {
              onPageSizeChange(Number(v));
              onPageChange(0);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label="Rows per page"
              className="w-[80px] @max-[230px]/footer:hidden"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PAGE_SIZES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {/* The range gives way first if a count runs long. */}
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate @max-[560px]/footer:hidden">
            {rows.length === 0
              ? '0 of 0'
              : `${start + 1}–${end} of ${rows.length}`}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={current === 0}
              onClick={() => onPageChange(0)}
              aria-label="First page"
              className="@max-[410px]/footer:hidden"
            >
              <ChevronsLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={current === 0}
              onClick={() => onPageChange(current - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft />
            </Button>
            <span className="px-2 whitespace-nowrap">
              {current + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={current >= pageCount - 1}
              onClick={() => onPageChange(current + 1)}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={current >= pageCount - 1}
              onClick={() => onPageChange(pageCount - 1)}
              aria-label="Last page"
              className="@max-[410px]/footer:hidden"
            >
              <ChevronsRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const DENSITIES: SegmentedOption<Preferences['density']>[] = [
  { value: 'normal', title: 'Normal rows', icon: DensityMediumIcon },
  { value: 'compact', title: 'Compact rows', icon: DensitySmallIcon },
];

/**
 * Row density, before Rows per page: a labelled icon pair for the same setting
 * as Settings → General (it's remembered). Hidden under lg, where rows are
 * always compact, and in a footer too narrow for it.
 */
function DensitySwitch({
  value,
  onChange,
}: {
  value: Preferences['density'];
  onChange: (value: Preferences['density']) => void;
}) {
  return (
    <div className="mr-3 flex items-center gap-2 max-lg:hidden @max-[820px]/footer:hidden">
      <span id="density-label">Density</span>
      <SegmentedControl
        size="sm"
        tone="grey"
        aria-labelledby="density-label"
        value={value}
        onChange={onChange}
        options={DENSITIES}
      />
    </div>
  );
}
