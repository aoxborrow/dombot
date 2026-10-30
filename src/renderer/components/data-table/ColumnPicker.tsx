import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Columns3, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverArrow,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { usePreferences } from '../../lib/preferences';
import {
  columnLayoutsEqual,
  defaultColumnLayout,
  moveColumnTo,
  normalizeColumnLayout,
  type ColumnLayout,
  type LayoutColumn,
} from './column-layout';
import type { DataColumn } from './DataTable';

/** What the picker needs from a column: DataColumn, or anything shaped like it. */
type PickerColumn = Pick<
  DataColumn<unknown>,
  'key' | 'label' | 'title' | 'locked' | 'defaultHidden' | 'hideOnMobile'
>;

/**
 * A table's saved layout, fitted to `columns`, and a setter that remembers it
 * on this device under `id`. Pass `layout` to DataTable and both to
 * ColumnPicker.
 */
export function useColumnLayout(
  id: string,
  columns: LayoutColumn[],
): { layout: ColumnLayout; setLayout: (next: ColumnLayout) => void } {
  const saved = usePreferences((s) => s.columnLayouts[id]);
  const setPreferences = usePreferences((s) => s.setPreferences);
  return {
    layout: normalizeColumnLayout(saved, columns),
    setLayout: (next) =>
      setPreferences({
        columnLayouts: {
          ...usePreferences.getState().columnLayouts,
          [id]: next,
        },
      }),
  };
}

function useNarrowScreen(): boolean {
  const query = '(max-width: 639px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

const nameOf = (c: PickerColumn) =>
  c.title ?? (typeof c.label === 'string' ? c.label : c.key);

/**
 * The Columns button for a DataTable: check a column to show it, drag its
 * handle (or Alt+↑/↓) to move it. Toggles apply at once; a drag applies on
 * drop. Locked columns stay first and shown, and aren't listed; `forceVisible` ones (e.g. being
 * filtered) stay shown until that ends.
 */
export function ColumnPicker({
  columns,
  layout,
  onChange,
  forceVisible = [],
  forceVisibleReason = 'Shown while it’s filtered',
  footer = false,
}: {
  /** Every column the table could show (the ones given to DataTable). */
  columns: PickerColumn[];
  layout: ColumnLayout;
  onChange: (next: ColumnLayout) => void;
  forceVisible?: readonly string[];
  /** Why a forced column can't be turned off. */
  forceVisibleReason?: string;
  /** In the table's footer (DataTable puts it there): small, labelled,
   * opening upward from its left edge. */
  footer?: boolean;
}) {
  const narrow = useNarrowScreen();
  const hintId = useId();
  const current = normalizeColumnLayout(layout, columns);
  const defaults = defaultColumnLayout(columns);
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const hidden = new Set(current.hidden);
  const lockedCount = columns.filter((c) => c.locked).length;

  const listRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const order = draft ?? current.order;
  // Ends a drag; also run on unmount, so closing mid-drag drops the listeners.
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);

  // Alt+↑/↓ re-renders the list in a new order; keep focus on the moved row.
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = refocus.current;
    if (!key) return;
    refocus.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-column-key="${CSS.escape(key)}"]`)
      ?.focus();
  });

  function commit(next: ColumnLayout) {
    onChange(normalizeColumnLayout(next, columns));
  }

  function toggle(key: string) {
    if (byKey.get(key)?.locked || forceVisible.includes(key)) return;
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    commit({ order: current.order, hidden: [...next] });
  }

  function onPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    key: string,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    const origin = current.order;
    let next = origin;
    setDragKey(key);
    setDraft(origin);

    // Where the pointer sits among the other rows, read from the rows on
    // screen so a scrolled list still lands right. Near either edge the list
    // scrolls to reach rows out of view.
    const move = (ev: PointerEvent) => {
      const list = listRef.current;
      if (!list) return;
      const box = list.getBoundingClientRect();
      const edge = 24;
      if (ev.clientY < box.top + edge) list.scrollTop -= 8;
      else if (ev.clientY > box.bottom - edge) list.scrollTop += 8;
      const rows = [
        ...list.querySelectorAll<HTMLElement>('[data-column-key]'),
      ].filter((row) => row.dataset.columnKey !== key);
      const above = rows.filter((row) => {
        const r = row.getBoundingClientRect();
        return r.top + r.height / 2 < ev.clientY;
      }).length;
      // Locked columns aren't listed but still lead the order.
      next = moveColumnTo(origin, key, above + lockedCount, columns);
      setDraft(next);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      stopDrag.current = null;
      setDragKey(null);
      setDraft(null);
    };
    const up = () => {
      stop();
      if (next.some((k, i) => k !== origin[i]))
        commit({ order: next, hidden: current.hidden });
    };
    stopDrag.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLDivElement>, key: string) {
    if (event.target !== event.currentTarget) return;
    if (
      event.altKey &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      const to =
        current.order.indexOf(key) + (event.key === 'ArrowUp' ? -1 : 1);
      refocus.current = key;
      commit({
        order: moveColumnTo(current.order, key, to, columns),
        hidden: current.hidden,
      });
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      toggle(key);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* In a toolbar, icon only on phones, where it shares a row with
            the page's switch. */}
        <Button
          variant="outline"
          size={footer ? 'sm' : 'default'}
          className={cn(
            'text-muted-foreground',
            !footer && 'h-9 max-sm:w-9 max-sm:px-0',
          )}
        >
          <Columns3 />
          <span className={cn(!footer && 'max-sm:sr-only')}>Columns</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={footer ? 'start' : 'end'}
        side={footer ? 'top' : 'bottom'}
        sideOffset={6}
        collisionPadding={16}
        className="flex max-h-[min(32rem,70vh)] w-64 flex-col p-0"
      >
        <PopoverArrow />
        <div
          ref={listRef}
          role="list"
          aria-label="Columns"
          aria-describedby={hintId}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto px-1 py-1',
            dragKey && 'select-none',
          )}
        >
          {order.map((key) => {
            const col = byKey.get(key);
            // Locked columns can't move or hide, so they aren't listed.
            if (!col || col.locked) return null;
            const name = nameOf(col);
            const forced = forceVisible.includes(key) && hidden.has(key);
            const shown = forced || !hidden.has(key);
            const tooNarrow = narrow && col.hideOnMobile;
            return (
              <div
                key={key}
                role="listitem"
                tabIndex={0}
                data-column-key={key}
                aria-label={`${name}, ${shown ? 'shown' : 'hidden'}`}
                onKeyDown={(event) => onRowKeyDown(event, key)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  dragKey === key && 'bg-muted',
                )}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  onPointerDown={(event) => onPointerDown(event, key)}
                  className="-mx-px cursor-grab touch-none text-muted-foreground active:cursor-grabbing dark:text-muted-foreground/60"
                >
                  <GripVertical className="size-4" />
                </button>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    (!shown || tooNarrow) && 'text-muted-foreground',
                  )}
                  title={
                    tooNarrow ? 'Shows when the window is wider' : undefined
                  }
                >
                  {name}
                  {tooNarrow && shown && (
                    <span className="ml-1 text-xs">(wider window)</span>
                  )}
                </span>
                <Checkbox
                  checked={shown}
                  disabled={forced}
                  tabIndex={-1}
                  aria-hidden
                  title={forced ? forceVisibleReason : undefined}
                  className={forced ? 'disabled:opacity-100' : undefined}
                  onCheckedChange={() => toggle(key)}
                />
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <span id={hintId} className="text-xs text-muted-foreground">
            Drag to reorder columns
          </span>
          <button
            type="button"
            disabled={columnLayoutsEqual(current, defaults)}
            onClick={() => commit(defaults)}
            className="text-xs text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            Reset
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
