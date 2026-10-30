import { Children, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * A headline number with a large faint icon behind it (Renewals, Sales). The
 * small size is the card rows' over the Domains and Sales tables (see
 * StatCardRow): on phones it shrinks to the label and value. A small card
 * with no hint has a bigger label and value in the same height. The value
 * can be several slots side by side, each a number with a small unit after
 * it: "6/30d  18/60d", or words a space apart, "251 7 registrars", which
 * cut short rather than wrap. With `to` or `onClick` the whole card is a
 * link or button.
 */
/** One of a card's values: a number, a small unit after it, its colour. */
export interface StatSlot {
  value: string;
  /** Small and quiet after the number: "/30d" right against it, or words
   * ("7 registrars") a space apart; words can be markup, e.g. different
   * words at different widths. */
  unit?: ReactNode;
  /** Words after a "/" unit ("141/251 · 56% listed"). */
  words?: string;
  /** A text colour for the number, e.g. "text-destructive". */
  className?: string;
}

export function StatCard({
  icon: Icon,
  accentClass,
  label,
  value,
  hint,
  size = 'default',
  to,
  onClick,
}: {
  icon: LucideIcon;
  /** Tailwind text-color for the background watermark (rendered at a low group
   * opacity), e.g. "text-brand-500". */
  accentClass: string;
  label: string;
  value: string | StatSlot[];
  /** The line under the value; small cards may leave it out. */
  hint?: string;
  size?: 'default' | 'sm';
  to?: string;
  onClick?: () => void;
}) {
  const sm = size === 'sm';
  const bare = sm && !hint;
  const className = cn(
    'relative block overflow-hidden rounded-lg border bg-card text-left',
    sm
      ? 'px-2 pt-1 pb-1.5 sm:px-3 sm:pt-[5px] sm:pb-[6px]'
      : 'px-4 pt-[9px] pb-[11px]',
    (to || onClick) &&
      'transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
  );
  const body = (
    <>
      <Icon
        className={cn(
          // Fade the whole shape as a group (opacity-[0.15]) rather than using a
          // translucent stroke color — a semi-transparent stroke composites to
          // bright spots wherever the icon's paths overlap.
          'pointer-events-none absolute opacity-[0.15]',
          sm
            ? '-right-2 -bottom-3 size-[44px] sm:-right-3 sm:-bottom-4 sm:size-[64px]'
            : '-right-4 -bottom-6 size-[123px]',
          accentClass,
        )}
        strokeWidth={1.5}
        aria-hidden
      />
      <div className="relative">
        <div
          className={cn(
            'truncate',
            bare
              ? 'text-[10px] text-foreground/50 sm:text-xs'
              : sm
                ? 'text-[11px] text-foreground/75 sm:text-xs'
                : 'text-[15px] text-foreground/75',
          )}
        >
          {label}
        </div>
        <div
          className={cn(
            'font-bold tabular-nums',
            bare
              ? '-mt-px text-lg leading-tight tracking-tight sm:mt-0 sm:text-xl'
              : sm
                ? 'text-sm leading-tight sm:text-base'
                : 'mt-2 text-2xl',
          )}
        >
          {typeof value === 'string' ? (
            value
          ) : (
            <span className="flex min-w-0 items-baseline gap-x-2.5">
              {value.map((slot, i) => (
                <span
                  key={i}
                  className="flex min-w-0 items-baseline whitespace-nowrap"
                >
                  <span className={slot.className}>{slot.value}</span>
                  {[slot.unit, slot.words].map(
                    (unit, j) =>
                      unit && (
                        <span
                          key={j}
                          className={cn(
                            'truncate',
                            // "/30d" sits against its number; words are
                            // smaller, quieter and further off.
                            typeof unit === 'string' && unit.startsWith('/')
                              ? 'text-[0.7em] font-medium text-muted-foreground/80'
                              : 'ml-2.5 text-[0.6em] font-normal tracking-normal text-muted-foreground/70',
                          )}
                        >
                          {unit}
                        </span>
                      ),
                  )}
                </span>
              ))}
            </span>
          )}
        </div>
        {!bare && (
          <div
            className={cn(
              'truncate text-muted-foreground',
              sm ? 'hidden text-[11px] sm:block' : 'mt-1 text-xs',
            )}
          >
            {hint}
          </div>
        )}
      </div>
    </>
  );
  if (to)
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  return <div className={className}>{body}</div>;
}

/**
 * A row of small StatCards over a table, filling its width, in priority
 * order: four, two to a row under md and one row from md (never three of
 * four), and a fifth from `wide` (1200px). Under it, a quiet line on the
 * right says the cards follow the filters (a page can say more), so every
 * row of cards ends the same way.
 */
export function StatCardRow({
  children,
  note = 'Totals for the filtered data below.',
  fifthAt,
}: {
  children: ReactNode;
  note?: ReactNode;
  /** Where the fifth card goes when it shows, if not last (Sales puts
   * Fees between Gross and Net). */
  fifthAt?: number;
}) {
  const cards = Children.toArray(children);
  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          // The same 13px as between the page's rows.
          'grid gap-[13px]',
          cards.length >= 4 ? 'grid-cols-2' : 'grid-cols-3',
          cards.length >= 4 && 'md:grid-cols-4',
          cards.length >= 5 && 'wide:grid-cols-5',
        )}
      >
        {cards.map((card, i) => (
          <div
            key={i}
            style={
              fifthAt === undefined
                ? undefined
                : { order: i === 4 ? fifthAt : i < fifthAt ? i : i + 1 }
            }
            className={cn(
              'grid',
              i === 4 && 'max-wide:hidden',
              i > 4 && 'hidden',
            )}
          >
            {card}
          </div>
        ))}
      </div>
      <p className="text-right text-[11px] text-muted-foreground/40 sm:text-xs">
        {note}
      </p>
    </div>
  );
}
