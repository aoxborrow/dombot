import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * A settings card with a consistent, compact header: a small uppercase title
 * with a divider beneath it and tight vertical padding. Shared so every
 * settings section's card header looks identical.
 */
export function SettingsCard({
  title,
  children,
  className,
  contentClassName,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn('gap-0 overflow-hidden rounded-md py-0', className)}>
      <CardHeader className="flex items-center bg-muted py-2!">
        <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground/80 uppercase">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn('pt-4 pb-[19px]', contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}
