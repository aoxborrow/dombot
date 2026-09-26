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
import { PAGE_SIZES, usePreferences } from '../../lib/preferences';
import { paginate, rangeKeys, type SortDir } from './table-state';
import { cn } from '@/lib/utils';
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
  columns,
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
}: {
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string;
  sort: { key: string; dir: SortDir };
  onSort: (key: string) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  selection?: TableSelection<T>;
  rowClassName?: (row: T) => string | false | undefined;
  /** Shown in a single row when there are no rows. */
  empty: ReactNode;
  /** Extra classes on the outer container (e.g. spacing above). */
  className?: string;
}) {
  const density = usePreferences((s) => s.density);
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
  const firstCell = (i: number) => selection && i === 0 && 'border-l-0! pl-3';

  return (
    <div
      className={cn(
        'flex min-h-36 min-w-0 flex-1 flex-col gap-[13px]',
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
          // from adding baseline descent under the line box.
          'domain-table-scroll absolute inset-0 overflow-auto rounded-lg border [&_td]:border-x [&_td]:border-x-border/50 [&_th]:border-x [&_th]:border-x-border/50 [&_td]:py-3 [&_td>*]:align-top compact:[&_td]:py-[9px]',
          density === 'compact' && 'compact',
        )}
      >
        {/* Slightly smaller body text when compact (headers keep their own
            sizes); cells with an explicit size opt down separately. */}
        <Table scrollable={false} className="compact:text-xs">
          <TableHeader className="sticky top-0 z-10 bg-muted [&_th]:bg-muted">
            <TableRow className="[&_th]:h-8 [&_th]:font-medium [&_th]:tracking-wider [&_th]:text-muted-foreground [&_button]:text-[10px] [&_button]:uppercase">
              {selection && (
                <TableHead className="w-9 border-r-0! pl-3">
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
                    // On the grey header the default fill reads as disabled;
                    // the page background makes it look clickable.
                    className="border-muted-foreground/40 bg-background dark:bg-background"
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
          <TableBody>
            {visible.map((row) => {
              const key = rowKey(row);
              const isSelected = !!selection?.selected.has(key);
              return (
                <TableRow
                  key={key}
                  className={cn(
                    isSelected && 'bg-muted/50',
                    rowClassName?.(row),
                  )}
                >
                  {selection && (
                    <TableCell className="w-9 border-r-0! pl-3">
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
                  {empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </DomainTableScroll>

      {/* Pagination stays under the table, outside the scroll, so the row
          count and page buttons stay on screen. On phones the controls stack
          above the rows-per-page select (flex-col-reverse). */}
      <div className="flex shrink-0 flex-col-reverse gap-3 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => {
              onPageSizeChange(Number(v));
              onPageChange(0);
            }}
          >
            <SelectTrigger size="sm" className="w-[80px]">
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

        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <span>
            {rows.length === 0
              ? '0 of 0'
              : `${start + 1}–${end} of ${rows.length}`}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={current === 0}
              onClick={() => onPageChange(0)}
              aria-label="First page"
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
            <span className="px-2">
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
            >
              <ChevronsRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
