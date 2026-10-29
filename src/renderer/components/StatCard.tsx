import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A headline number with a large faint icon behind it (Renewals, Markets). */
export function StatCard({
  icon: Icon,
  accentClass,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  /** Tailwind text-color for the background watermark (rendered at a low group
   * opacity), e.g. "text-brand-500". */
  accentClass: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border bg-card px-4 pt-[9px] pb-[11px]">
      <Icon
        className={cn(
          // Fade the whole shape as a group (opacity-[0.15]) rather than using a
          // translucent stroke color — a semi-transparent stroke composites to
          // bright spots wherever the icon's paths overlap.
          'pointer-events-none absolute -right-4 -bottom-6 size-[123px] opacity-[0.15]',
          accentClass,
        )}
        strokeWidth={1.5}
        aria-hidden
      />
      <div className="relative">
        <div className="text-[15px] text-foreground/75">{label}</div>
        <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}
