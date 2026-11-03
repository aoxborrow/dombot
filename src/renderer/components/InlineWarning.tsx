import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A caution beside a field or in a dialog, e.g. that changing nameservers
 * moves the DNS, or that auth codes are secrets: the amber triangle and muted
 * 12px text the nameserver editor started. For errors use destructive text;
 * this is for what to know before going ahead.
 */
export function InlineWarning({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 text-xs text-muted-foreground',
        className,
      )}
    >
      <TriangleAlert
        className="mt-0.5 size-3.5 shrink-0 text-amber-500 dark:text-amber-400"
        aria-hidden
      />
      <span>{children}</span>
    </p>
  );
}
