import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * A headline number with a large faint icon behind it (Renewals, Sales). The
 * small size is the Domains summary row's. With `to` or `onClick` the whole
 * card is a link or button.
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
    sm ? 'px-3 pt-[7px] pb-[8px]' : 'px-4 pt-[9px] pb-[11px]',
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
            ? '-right-3 -bottom-5 size-[84px]'
            : '-right-4 -bottom-6 size-[123px]',
          accentClass,
        )}
        strokeWidth={1.5}
        aria-hidden
      />
      <div className="relative">
        <div
          className={cn(
            'text-foreground/75',
            sm ? 'text-[13px]' : 'text-[15px]',
          )}
        >
          {label}
        </div>
        <div
          className={cn(
            'font-bold tabular-nums',
            sm ? 'mt-0.5 text-lg' : 'mt-2 text-2xl',
          )}
        >
          {value}
        </div>
        <div
          className={cn(
            'truncate text-muted-foreground',
            sm ? 'text-[11px]' : 'mt-1 text-xs',
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
