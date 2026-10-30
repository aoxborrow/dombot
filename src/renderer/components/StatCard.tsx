import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * A headline number with a large faint icon behind it (Renewals, Sales). The
 * small size is the card rows' over the Domains and Sales tables (see
 * StatCardRow): on phones it shrinks to the label and value. With `to` or
 * `onClick` the whole card is a link or button.
 */
export function StatCard({
  icon: Icon,
  accentClass,
  label,
  value,
  hint,
  size = 'default',
  to,
  onClick,
}: {
  icon: LucideIcon;
  /** Tailwind text-color for the background watermark (rendered at a low group
   * opacity), e.g. "text-brand-500". */
  accentClass: string;
  label: string;
  value: string;
  hint: string;
  size?: 'default' | 'sm';
  to?: string;
  onClick?: () => void;
}) {
  const sm = size === 'sm';
  const className = cn(
    'relative block overflow-hidden rounded-lg border bg-card text-left',
    sm
      ? 'px-2 pt-1 pb-1.5 sm:px-3 sm:pt-[5px] sm:pb-[6px]'
      : 'px-4 pt-[9px] pb-[11px]',
    (to || onClick) &&
      'transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
  );
  const body = (
    <>
      <Icon
        className={cn(
          // Fade the whole shape as a group (opacity-[0.15]) rather than using a
          // translucent stroke color — a semi-transparent stroke composites to
          // bright spots wherever the icon's paths overlap.
          'pointer-events-none absolute opacity-[0.15]',
          sm
            ? '-right-2 -bottom-3 size-[44px] sm:-right-3 sm:-bottom-4 sm:size-[64px]'
            : '-right-4 -bottom-6 size-[123px]',
          accentClass,
        )}
        strokeWidth={1.5}
        aria-hidden
      />
      <div className="relative">
        <div
          className={cn(
            'truncate text-foreground/75',
            sm ? 'text-[11px] sm:text-xs' : 'text-[15px]',
          )}
        >
          {label}
        </div>
        <div
          className={cn(
            'font-bold tabular-nums',
            sm ? 'text-sm leading-tight sm:text-base' : 'mt-2 text-2xl',
          )}
        >
          {value}
        </div>
        <div
          className={cn(
            'truncate text-muted-foreground',
            sm ? 'hidden text-[11px] sm:block' : 'mt-1 text-xs',
          )}
        >
          {hint}
        </div>
      </div>
    </>
  );
  if (to)
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  return <div className={className}>{body}</div>;
}

/**
 * A row of small StatCards over a table, adding up what the table shows, and
 * the one line under them that says so. Three to a row at every width; on
 * wide screens they keep to the left rather than stretch.
 */
export function StatCardRow({
  note,
  children,
}: {
  note: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5 xl:grid-cols-4 2xl:grid-cols-5">
        {children}
      </div>
      <p className="text-[11px] text-muted-foreground sm:text-xs">{note}</p>
    </div>
  );
}
