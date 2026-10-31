import type { ReactNode } from 'react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { cn } from '@/lib/utils';

/**
 * Every "nothing here yet" in the app looks like this: a title and a short
 * line under it, no icon. Buttons go in `children` only for an action the
 * page doesn't already show; Settings' Add buttons sit right above their
 * lists, so those lists get none. `boxed` draws the dashed outline for a page
 * or card with nothing else in it; a table's empty row goes without. A
 * filtered table with no matches says so in a plain sentence instead.
 */
export function EmptyState({
  title,
  description,
  boxed = false,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  boxed?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Empty
      className={cn(
        // Table cells don't wrap; this does.
        'whitespace-normal',
        boxed ? 'rounded-md border border-dashed' : 'p-0 md:p-0',
        className,
      )}
    >
      <EmptyHeader>
        <EmptyTitle className="text-foreground">{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children && (
        <EmptyContent className="flex-row flex-wrap justify-center gap-2">
          {children}
        </EmptyContent>
      )}
    </Empty>
  );
}
