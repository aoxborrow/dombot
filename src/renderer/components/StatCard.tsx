import { Children, Fragment, type CSSProperties, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * A label over a headline number, with a faded icon. The small size is the
 * card rows' over the pages' tables (see StatCardRow), smaller again on
 * phones. The icon is always whole, and sized by the card's width, not the
 * window's (container queries, on the width inside the padding): from 210px
 * it's 40px, centred on the right beside the text; from 155px (144px on
 * phones, where the text is smaller) it's 30px in the top-right corner with
 * the text cut short before it, where $10,486,750 still fits; narrower, it's
 * 21px there and the number runs under it. The value can be several slots
 * side by side, each a number with a small unit after it: "6/30d  18/60d",
 * or words a space apart, "251 7 registrars"; a currency symbol before a
 * number is smaller and raised (see Amount). What doesn't fit after the
 * first number is left out a whole piece at a time, from the end, and a
 * first number too long for the card gets smaller (see fitted). With `to`
 * or `onClick` the whole card is a link or button.
 */
/** One of a card's values: a number, a small unit after it, its colour. */
export interface StatSlot {
  value: string;
  /** Small and quiet after the number: "/30d" right against it, or words
   * ("7 registrars") a space apart; words can be markup, e.g. different
   * words at different widths. */
  unit?: ReactNode;
  /** Words after the number or its "/" unit ("141/251 · 56% listed"); a
   * list, "·" between, is left out one at a time from the end when there
   * isn't room ("3 rejected · 9 inactive", then "3 rejected"). */
  words?: string | string[];
  /** A text colour for the number, e.g. "text-destructive". */
  className?: string;
}

export function StatCard({
  icon: Icon,
  accentClass,
  label,
  value,
  size = 'default',
  to,
  onClick,
}: {
  icon: LucideIcon;
  /** Tailwind text-color for the icon, e.g. "text-brand-400". */
  accentClass: string;
  label: string;
  value: string | StatSlot[];
  size?: 'default' | 'sm';
  to?: string;
  onClick?: () => void;
}) {
  const sm = size === 'sm';
  const className = cn(
    '@container relative block overflow-hidden rounded-lg border bg-card text-left',
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
          // Fade the whole shape as a group (45%, 30% in dark mode), the same
          // at every size, rather than using a translucent stroke color — a
          // semi-transparent stroke composites to bright spots wherever the
          // icon's paths overlap. Narrow: 21px in the top-right corner, the
          // number running under it.
          'pointer-events-none absolute top-1 right-[5px] size-[21px] opacity-45 [stroke-width:1.75] dark:opacity-30 sm:right-1.5',
          // Middle: 30px, still in the corner (1px lower, to sit balanced
          // there), the text cut short before it.
          'max-sm:@min-[144px]:top-[5px] max-sm:@min-[144px]:size-[30px] sm:@min-[155px]:top-[5px] sm:@min-[155px]:size-[30px]',
          // Wide: 40px, centred on the right, the text cut short before it.
          '@min-[210px]:top-1/2 @min-[210px]:right-2.5 @min-[210px]:size-10 @min-[210px]:-translate-y-1/2 @min-[210px]:[stroke-width:1.5]',
          accentClass,
        )}
        aria-hidden
      />
      {/* A container too, so the first number can size itself to the
          text's width. */}
      <div className="relative @container/text max-sm:@min-[144px]:mr-8 sm:@min-[155px]:mr-8 @min-[210px]:mr-11">
        <div
          className={cn(
            'truncate',
            sm
              ? 'text-[10px] text-foreground/50 sm:text-xs'
              : 'text-[15px] text-foreground/75',
          )}
        >
          {label}
        </div>
        <div
          className={cn(
            'font-bold tabular-nums',
            sm
              ? '-mt-px text-lg leading-tight tracking-tight sm:mt-0 sm:text-xl'
              : 'mt-2 text-2xl',
          )}
        >
          {typeof value === 'string' ? (
            <Amount text={value} fit />
          ) : (
            // Every piece after the first number shows whole or not at all:
            // one that doesn't fit wraps onto a second line, which is cut
            // off, and takes the pieces after it along. So "89% listed" goes
            // first, then "/10,251", rather than both cut short partway. A
            // zero-width space first holds the first line at full height,
            // on the usual baseline, when the number is made smaller.
            <span className="flex h-[1lh] flex-wrap items-baseline overflow-hidden whitespace-nowrap before:content-['\200b']">
              {value.map((slot, i) => {
                // "/30d" sits against its number; words are smaller,
                // quieter and further off.
                const against =
                  typeof slot.unit === 'string' && slot.unit.startsWith('/');
                const number = (
                  <>
                    <Amount
                      text={slot.value}
                      fit={i === 0}
                      className={slot.className}
                    />
                    {against && (
                      <span className="text-[0.7em] font-medium text-muted-foreground/80">
                        {slot.unit}
                      </span>
                    )}
                  </>
                );
                return (
                  <Fragment key={i}>
                    {/* The first number's "/10,251" can go on its own; a
                        later number goes with its "/60d". */}
                    {i === 0 ? (
                      number
                    ) : (
                      <span className="ml-2.5">{number}</span>
                    )}
                    {[
                      against ? undefined : slot.unit,
                      ...[slot.words ?? []].flat(),
                    ]
                      .filter(Boolean)
                      .map((words, j) => (
                        <span
                          key={j}
                          className={cn(
                            'text-[0.6em] font-normal tracking-normal text-muted-foreground/70',
                            // After the first, a "·" that goes with them.
                            j === 0 ? 'ml-2.5' : 'ml-[0.3em]',
                          )}
                        >
                          {j > 0 && '· '}
                          {words}
                        </span>
                      ))}
                  </Fragment>
                );
              })}
            </span>
          )}
        </div>
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
 * A number that starts with a currency symbol: its sign, the symbol (with any
 * space after it, "CHF "), and the rest. Money here always has its symbol
 * first ("€1.234", "−$394"); a code after the number ("¥1,234 JPY") stays in
 * the rest.
 */
const MONEY = /^([-−]?)([^\d\-−][^\d]*)(\d.*)$/;

/** How much smaller a currency symbol is than its number. */
const SYMBOL_SIZE = 0.8;

/**
 * One of a card's numbers. A currency symbol before it is smaller, lighter,
 * quieter and raised a little, as on a price tag. The first number fits itself to
 * the card (see fitted).
 */
function Amount({
  text,
  fit = false,
  className,
}: {
  text: string;
  fit?: boolean;
  className?: string;
}) {
  const money = MONEY.exec(text);
  const size = fit ? fitted(text) : undefined;
  return (
    <span className={cn(size?.className, className)} style={size?.style}>
      {money ? (
        <>
          {money[1]}
          <span
            // Raised so the S of a "$" (its stroke stands taller) lines up
            // with the digits' tops.
            className="relative -top-[0.2em] font-medium text-muted-foreground"
            style={{ fontSize: `${SYMBOL_SIZE}em` }}
          >
            {money[2]}
          </span>
          {money[3]}
        </>
      ) : (
        text
      )}
    </span>
  );
}

/**
 * A first number's own size: the value line's, or smaller when it's too long
 * for the card's text (100cqw, the text's width; the text is a container), but
 * not below 60%. How wide it is comes from its characters, in ems of the bold
 * tabular figures, measured in the system fonts (SF the widest) and rounded
 * up: every digit is one width, separators (and the apostrophe of 1'234)
 * are narrower, and anything else is counted wide, so it shrinks a little
 * early rather than too late.
 */
function fitted(text: string) {
  const money = MONEY.exec(text);
  const ems = money
    ? widthEms(money[1]) + SYMBOL_SIZE * widthEms(money[2]) + widthEms(money[3])
    : widthEms(text);
  return {
    className: 'text-[length:clamp(0.6em,calc(100cqw/var(--ems)),1em)]',
    style: { '--ems': ems.toFixed(2) } as CSSProperties,
  };
}

function widthEms(text: string) {
  let ems = 0;
  for (const ch of text)
    ems += /\d/.test(ch)
      ? 0.63
      : /[,.' /]/.test(ch)
        ? 0.3
        : ch === '%'
          ? 1
          : 0.75;
  return ems;
}

/**
 * A row of small StatCards over a table, filling its width, in priority
 * order: four, two to a row under md and one row from md (never three of
 * four), and a fifth from `wide` (1200px). A row of three drops its third
 * on phones. Under it, a quiet line on the
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
          cards.length >= 4
            ? 'grid-cols-2'
            : cards.length === 3
              ? 'grid-cols-2 sm:grid-cols-3'
              : 'grid-cols-3',
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
              cards.length === 3 && i === 2 && 'max-sm:hidden',
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
