import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
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
 * Every link on the settings pages, in help text and beside it: a little
 * brighter than the muted copy around it but never full white, and only
 * underlined, in full white, on hover.
 */
export const SETTINGS_LINK =
  'text-foreground/80 underline-offset-4 hover:text-foreground hover:underline';

/** The same, with room for a trailing icon (an external link's arrow). */
export const SETTINGS_ICON_LINK = `inline-flex items-center gap-1 ${SETTINGS_LINK}`;

/**
 * A link out of the app in settings help, with its arrow. `target="_blank"`
 * hands the URL to the main process's window-open handler, which opens it in
 * the system browser (and a new tab on the web).
 */
export function SettingsExternalLink({
  url,
  children,
  className,
}: {
  url: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(SETTINGS_ICON_LINK, className)}
    >
      {children}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

/**
 * The help at the top of an account card (registrars and markets): a short
 * summary, then its links on a line of their own.
 */
export function SettingsHelp({
  summary,
  links,
}: {
  summary: ReactNode;
  links: readonly { label: string; url: string }[];
}) {
  return (
    <div className="mb-4 flex flex-col gap-2">
      <p className="text-sm leading-relaxed text-muted-foreground">{summary}</p>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {links.map((link) => (
            <SettingsExternalLink
              key={link.url}
              url={link.url}
              className="text-[13px]"
            >
              {link.label}
            </SettingsExternalLink>
          ))}
        </div>
      )}
    </div>
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
        // Links in it look like every other settings link (SETTINGS_LINK),
        // not shadcn's always-underlined ones.
        <FieldDescription className="-mt-[5px] text-[13px] nth-last-2:-mt-[5px] [&>a]:no-underline [&>a:hover]:text-foreground [&>a:hover]:underline">
          {description}
        </FieldDescription>
      )}
      {children}
    </Field>
  );
}
