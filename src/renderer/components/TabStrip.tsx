import type { CSSProperties, ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TabMetric } from '../lib/tab-metrics';

/**
 * Below this breakpoint a tab drops its label (icon only) or its pill, so the
 * strip still fits narrower windows. Listed as whole class strings so Tailwind
 * picks them up.
 */
type Breakpoint = 'md' | 'lg';

const LABEL_FROM: Record<Breakpoint, string> = {
  md: 'hidden md:inline',
  lg: 'hidden lg:inline',
};
// Icon-only tabs get even padding, a touch wider than the labeled default.
const ICON_ONLY_PAD: Record<Breakpoint, string> = {
  md: 'max-md:px-3.5',
  lg: 'max-lg:px-3.5',
};
// Where the label shows, the icon is pulled 2px toward it; the gap alone
// leaves it loose.
const ICON_TIGHTEN: Record<Breakpoint, string> = {
  md: 'md:-mr-0.5',
  lg: 'lg:-mr-0.5',
};
// The no-pill padding (see tabClass) for the widths where pillFrom hides it.
const NO_PILL_PAD: Record<Breakpoint, string> = {
  md: 'max-md:pr-4',
  lg: 'max-lg:pr-4',
};
const PILL_FROM: Record<Breakpoint, string> = {
  md: 'hidden md:inline-flex',
  lg: 'hidden lg:inline-flex',
};

/**
 * Browser-style tabs. Unselected tabs form a muted strip; the selected tab
 * stands 2px proud in the page background with no bottom border, so it reads
 * as attached to the content below.
 *
 * The parent supplies the band the tabs sit in: a bar with a bottom border and
 * `bg-tab-bar` (the app header, or any bordered bar in a page), with the strip
 * aligned to its bottom edge. The strip overlaps that border by 1px so the
 * selected tab covers it.
 * Children are `TabLink`s (route tabs) or `TabButton`s (in-page state).
 */
export function TabStrip({
  children,
  className,
  style,
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn('-mb-px flex items-end', className)}
      style={style}
    >
      {children}
    </nav>
  );
}

/** What a tab shows, shared by `TabLink` and `TabButton`. */
export interface TabProps {
  /** Optional; a tab can be a label alone. */
  icon?: LucideIcon;
  label: string;
  /** The pill after the label; null or omitted shows none. */
  metric?: TabMetric | null;
  /** Hide the label below this breakpoint; the icon alone stays. Needs an icon. */
  iconOnlyBelow?: Breakpoint;
  /** Hide the pill below this breakpoint. */
  pillFrom?: Breakpoint;
  className?: string;
  iconClassName?: string;
}

const tabClass = (
  isActive: boolean,
  {
    metric,
    pillFrom,
    iconOnlyBelow,
    className,
  }: Pick<TabProps, 'metric' | 'pillFrom' | 'iconOnlyBelow' | 'className'>,
) =>
  cn(
    // A 4px gap between neighbouring tabs shows the bar between them.
    'relative ml-1 inline-flex items-center gap-2 border px-3 text-base leading-none font-medium whitespace-nowrap transition-colors first:ml-0 xl:px-[18px]',
    isActive
      ? 'z-10 h-[38px] rounded-t-[6px] border-border border-b-background bg-background text-foreground'
      : 'h-[36px] rounded-t-[7px] border-tab-border border-b-transparent bg-tab text-tab-foreground shadow-[inset_0_-1px_2px_-1px_var(--tab-shadow)] hover:text-foreground',
    // Wherever a tab shows no pill, 4px more on the right so it doesn't read
    // short beside tabs that end in one.
    !metric ? 'pr-4 xl:pr-[22px]' : pillFrom && NO_PILL_PAD[pillFrom],
    // Icon-only tabs keep even padding (applied last, so it wins).
    iconOnlyBelow && ICON_ONLY_PAD[iconOnlyBelow],
    className,
  );

function TabContent({
  icon: Icon,
  label,
  metric,
  iconOnlyBelow,
  pillFrom,
  iconClassName,
}: TabProps) {
  return (
    <>
      {Icon && (
        <Icon
          aria-hidden
          className={cn(
            'size-[15px] shrink-0 opacity-80',
            iconOnlyBelow ? ICON_TIGHTEN[iconOnlyBelow] : '-mr-0.5',
            iconClassName,
          )}
        />
      )}
      {iconOnlyBelow ? (
        <span className={LABEL_FROM[iconOnlyBelow]}>{label}</span>
      ) : (
        label
      )}
      <TabPill
        metric={metric ?? null}
        className={pillFrom && PILL_FROM[pillFrom]}
      />
    </>
  );
}

/** A tab that navigates to a route and is selected while that route is. */
export function TabLink({
  to,
  end,
  ...tab
}: TabProps & {
  to: string;
  /** Match the route exactly (for `/`). */
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={tab.iconOnlyBelow ? tab.label : undefined}
      className={({ isActive }) => tabClass(isActive, tab)}
    >
      <TabContent {...tab} />
    </NavLink>
  );
}

/** A tab for in-page state: selected by the `active` prop, not the route. */
export function TabButton({
  active,
  onClick,
  ...tab
}: TabProps & {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={tab.iconOnlyBelow ? tab.label : undefined}
      className={tabClass(active, tab)}
    >
      <TabContent {...tab} />
    </button>
  );
}

/** A tab's metric: a count, a spend, or an alert-tinted issue count. */
export function TabPill({
  metric,
  className,
}: {
  metric: TabMetric | null;
  className?: string;
}) {
  if (!metric) return null;
  return (
    <span
      title={metric.title}
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 text-xs font-medium tabular-nums',
        metric.alert
          ? 'bg-destructive/12 text-destructive'
          : 'bg-foreground/8 text-muted-foreground',
        className,
      )}
    >
      {metric.value}
    </span>
  );
}
