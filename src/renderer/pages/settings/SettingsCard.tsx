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
    <Card className={cn('gap-0 pt-[13px] pb-[19px]', className)}>
      <CardHeader className="border-b pb-[7px]!">
        <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground/80 uppercase">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn('pt-4', contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}
