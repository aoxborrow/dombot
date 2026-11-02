import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A titled part of an account card (Settings → Registrars, Markets): a title
 * with a line under it, an optional line of subtext, then its fields. Parts
 * share the card's one Save; they're never boxes of their own.
 */
export function CardSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-4', className)}>
      <header className="flex flex-col gap-0.5 border-b pb-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </header>
      {children}
    </section>
  );
}
