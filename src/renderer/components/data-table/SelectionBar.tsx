import type { ComponentProps, ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { ListEditIcon } from '../icons/ListEditIcon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// White on the brand green, icons a pale green, and the selection's darker
// green on hover and while a menu is open.
const ON_GREEN =
  'h-8 gap-1.5 rounded-sm px-2.5 has-[>svg]:px-2.5 text-[13px] font-medium text-primary-foreground hover:bg-black/15 hover:text-primary-foreground dark:hover:bg-black/25 data-[state=open]:bg-black/15 dark:data-[state=open]:bg-black/25 [&_svg]:size-4 [&_svg]:text-brand-100/85';

// The bar's menus open upward, so their shadow is cast up too: the usual one
// falls down, onto the bar.
const UP_SHADOW =
  'shadow-[0_-18px_50px_6px_rgb(0_0_0/0.12),0_-4px_16px_rgb(0_0_0/0.08)] dark:shadow-[0_-18px_50px_6px_rgb(0_0_0/0.75),0_-4px_16px_rgb(0_0_0/0.6)]';

/**
 * The bulk actions bar a table floats over its rows once some are selected
 * (pass it as DataTable's `floatingBar`): green, so it stands out from the
 * table. Left, on a darker green: the count in the tabs' pill style, "of N
 * selected", and Clear. Then Actions, a menu of everything the page can do to
 * the selection, and any shortcuts (`children`: SelectionBarMenu and
 * SelectionBarButton) after it. As wide as what's in it, up to 80% of the
 * table, or 90% under 724px (tablets and phones), never all of it: edge to
 * edge it would cut the table in two rather than float. Shortcuts drop out
 * with `@max-[…]/float:hidden` at the width they stop fitting; on a phone
 * "of N" goes, leaving "2 selected", and past that the text shortens.
 */
export function SelectionBar({
  count,
  total,
  onClear,
  actions,
  actionsClassName = 'w-56',
  children,
}: {
  count: number;
  /** Rows in the view, for "3 of 251 selected". */
  total: number;
  onClear: () => void;
  /** The Actions menu's items. */
  actions: ReactNode;
  /** Classes on the Actions menu (its width). */
  actionsClassName?: string;
  /** Shortcut buttons after Actions. */
  children?: ReactNode;
}) {
  return (
    <div className="pointer-events-auto flex max-w-[90%] items-center gap-1 rounded-md bg-primary p-1 text-primary-foreground shadow-xl ring-1 shadow-black/30 ring-black/10 animate-in fade-in slide-in-from-bottom-2 @min-[724px]/float:max-w-[80%] dark:ring-white/15">
      {/* The selection, set apart from the actions on a darker green. */}
      <span className="flex h-8 min-w-0 items-center gap-2 rounded-sm bg-black/15 pr-2.5 pl-2 text-[13px] whitespace-nowrap dark:bg-black/25">
        {/* The tabs' count pill, in the bar's green. */}
        <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-primary px-2 text-xs font-medium text-white tabular-nums">
          {count.toLocaleString('en-US')}
        </span>
        {/* A pixel closer to the pill than the gap. */}
        <span className="-ml-px min-w-0 truncate text-brand-100/75">
          <span className="@max-[360px]/float:hidden">
            of{' '}
            <span className="tabular-nums">
              {total.toLocaleString('en-US')}
            </span>{' '}
          </span>
          selected
        </span>
        {/* The filter chips' remove button: a small X, its hover square the
            bar's own green. */}
        <button
          type="button"
          title="Clear selection"
          aria-label="Clear selection"
          onClick={onClear}
          className="group/clear ml-0.5 flex shrink-0 text-brand-100/75 outline-none hover:text-white"
        >
          <span className="-m-[3px] flex rounded-[4px] p-[3px] transition-colors group-hover/clear:bg-primary">
            <X className="size-3.5" />
          </span>
        </button>
      </span>
      <SelectionBarMenu
        icon={<ListEditIcon className="size-[18px]!" />}
        label="Actions"
        contentClassName={actionsClassName}
      >
        {actions}
      </SelectionBarMenu>
      {children}
    </div>
  );
}

/** A shortcut menu on the bar, e.g. Domains' Folder; it opens upward. */
export function SelectionBarMenu({
  icon,
  label,
  className,
  contentClassName,
  children,
}: {
  icon: ReactNode;
  label: string;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={cn(ON_GREEN, className)}>
          {icon}
          {label}
          <ChevronDown className="size-3.5!" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        sideOffset={10}
        align="start"
        className={cn(contentClassName, UP_SHADOW)}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A shortcut button on the bar, e.g. Domains' Export CSV. A little more room
 * on the right, where the menus have a chevron.
 */
export function SelectionBarButton({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      className={cn(ON_GREEN, 'pr-3.5 has-[>svg]:pr-3.5', className)}
      {...props}
    />
  );
}
