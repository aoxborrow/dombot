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
const PILL_FROM: Record<Breakpoint, string> = {
  md: 'hidden md:inline-flex',
  lg: 'hidden lg:inline-flex',
};

/**
 * Browser-style tabs along the bottom of the header. Unselected tabs form a
 * muted strip on the header's `bg-tab-bar`; the selected tab stands 2px proud
 * in the page background with no bottom border, so it reads as attached to the
 * content below. Children are `TabLink`s; the header should be `items-end`.
 */
export function TabStrip({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    // -mb-px overlaps the header's bottom border, which the selected tab
    // covers with its background-coloured bottom border.
    <nav className={cn('-mb-px flex items-end', className)} style={style}>
      {children}
    </nav>
  );
}

const tabClass = (isActive: boolean) =>
  cn(
    // A 2px gap between neighbouring tabs shows the header shell between them.
    'relative ml-0.5 inline-flex items-center gap-2 border px-3 text-base leading-none font-medium transition-colors first:ml-0 xl:px-[18px]',
    isActive
      ? 'z-10 h-[38px] rounded-t-[6px] border-border border-b-background bg-background text-foreground'
      : 'h-[36px] rounded-t-[7px] border-tab-border border-b-transparent bg-tab text-tab-foreground shadow-[inset_0_-1px_2px_-1px_var(--tab-shadow)] hover:text-foreground',
  );

/** One tab: a route link with an icon, a label, and an optional metric pill. */
export function TabLink({
  to,
  end,
  icon: Icon,
  label,
  metric,
  iconOnlyBelow,
  pillFrom,
  className,
  iconClassName,
}: {
  to: string;
  /** Match the route exactly (for `/`). */
  end?: boolean;
  icon: LucideIcon;
  label: string;
  metric?: TabMetric | null;
  /** Hide the label below this breakpoint; the icon alone stays. */
  iconOnlyBelow?: Breakpoint;
  /** Hide the pill below this breakpoint. */
  pillFrom?: Breakpoint;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={iconOnlyBelow ? label : undefined}
      className={({ isActive }) =>
        cn(
          tabClass(isActive),
          iconOnlyBelow && ICON_ONLY_PAD[iconOnlyBelow],
          className,
        )
      }
    >
      <Icon
        aria-hidden
        className={cn(
          'size-[15px] shrink-0 opacity-80',
          iconOnlyBelow ? ICON_TIGHTEN[iconOnlyBelow] : '-mr-0.5',
          iconClassName,
        )}
      />
      {iconOnlyBelow ? (
        <span className={LABEL_FROM[iconOnlyBelow]}>{label}</span>
      ) : (
        label
      )}
      <TabPill
        metric={metric ?? null}
        className={pillFrom && PILL_FROM[pillFrom]}
      />
    </NavLink>
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
