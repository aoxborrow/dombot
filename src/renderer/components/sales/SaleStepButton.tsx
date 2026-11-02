import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * A step on a pending sale's row (Unlock, Send auth code, Approve transfer),
 * short enough to sit in a table row without making it taller. A disabled
 * step still shows its title on hover, saying what it waits on or what was
 * done: a disabled button gets no pointer events, so the title goes on a
 * wrapper instead.
 */
export function SaleStepButton({
  className,
  disabled,
  title,
  ...props
}: Omit<ComponentProps<typeof Button>, 'size' | 'variant'>) {
  const button = (
    <Button
      size="sm"
      variant="outline"
      className={cn('-my-1 h-6 shrink-0 px-2 text-xs', className)}
      disabled={disabled}
      title={disabled ? undefined : title}
      {...props}
    />
  );
  return disabled && title ? (
    <span className="inline-flex shrink-0" title={title}>
      {button}
    </span>
  ) : (
    button
  );
}
