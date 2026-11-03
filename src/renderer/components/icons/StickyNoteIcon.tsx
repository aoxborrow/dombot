import type { SVGProps } from 'react';

/**
 * Sticky-note glyph, after Google Material "sticky_note_2" (outlined), like
 * {@link FolderIcon}: a lighter border (1.75), three thin lines of "text"
 * (two full, one half, 1.25 thick, spaced evenly with the margins), and the
 * folded corner a little lower so it clears the second line. Used for
 * notes. Fills with `currentColor`, so `text-*` classes tint it, and sizes
 * from `size-*` / width-height classes like a lucide icon.
 */
export function StickyNoteIcon({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      // Material's own 24×24 canvas (artwork at 3–21), the same grid as
      // lucide, so the note matches the boxed lucide icons beside it.
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h10.75L21 15.75V5c0-1.1-.9-2-2-2zM4.75 4.75h14.5v10h-4.5v4.5h-10zM7.25 7.375h9.5v1.25h-9.5zm0 4h9.5v1.25h-9.5zm0 4h4.75v1.25h-4.75z" />
    </svg>
  );
}
