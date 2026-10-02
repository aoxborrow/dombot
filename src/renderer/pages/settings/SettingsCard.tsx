import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';

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

/**
 * One input in a settings card: a label, an optional description under it,
 * then the control. Every settings input uses it, so labels read the same
 * across the tabs (14px, with 13px help text under it). Pass `htmlFor` to tie
 * the label to the control's id; a control the label can't focus (a radio
 * group) names itself with `aria-labelledby` instead.
 */
export function SettingsField({
  label,
  htmlFor,
  labelId,
  description,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  labelId?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    // 8px between the parts, but the help text tucks up to 3px under the
    // label so the two read as one heading for the control.
    <Field className={cn('gap-2', className)}>
      <FieldLabel id={labelId} htmlFor={htmlFor}>
        {label}
      </FieldLabel>
      {/* A fixed pull-up: shadcn's own nudge applies only when the help
          text is second-to-last, which made the gap vary by field. */}
      {description && (
        <FieldDescription className="-mt-[5px] text-[13px] nth-last-2:-mt-[5px]">
          {description}
        </FieldDescription>
      )}
      {children}
    </Field>
  );
}
