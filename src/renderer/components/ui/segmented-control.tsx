import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  /** Visible text. Omit for an icon-only segment (then give `title`). */
  label?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  /** A count after the label (Owned 523). */
  count?: number;
  /** Tooltip and accessible name; required for icon-only segments. */
  title?: string;
}

/**
 * A one-of-N switch styled like the app's inputs (the select's border,
 * background, and shadow), with the chosen segment washed lighter. `sm`
 * matches the small select (h-8), `default` the regular inputs (h-9). Used
 * for the page views (Owned | Archive, Needs review | All), table density,
 * and the Settings appearance picker.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'default',
  className,
  ...aria
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'default' | 'sm';
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  return (
    <div
      role="radiogroup"
      {...aria}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-input bg-transparent p-0.5 text-sm shadow-xs dark:bg-input/30',
        size === 'sm' ? 'h-8' : 'h-9',
        className,
      )}
    >
      {options.map(({ value: v, label, icon: Icon, count, title }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label == null ? title : undefined}
            title={title}
            onClick={() => onChange(v)}
            className={cn(
              'inline-flex h-full items-center justify-center gap-2 rounded-[5px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              label == null ? 'w-7' : 'px-3',
              // Translucent washes rather than a fixed grey, so the chosen
              // segment stands out the same on the page, a card, or the
              // footer.
              active
                ? 'bg-foreground/10 text-foreground dark:bg-foreground/15'
                : 'hover:bg-foreground/5 dark:hover:bg-foreground/[0.07]',
            )}
          >
            {Icon && <Icon className="size-4" />}
            {label}
            {count != null && (
              <span
                className={cn(
                  'tabular-nums',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
