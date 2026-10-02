import type { SVGProps } from 'react';

/**
 * Sticky-note glyph — Google Material "sticky_note_2" (outlined), like
 * {@link FolderIcon}. Used for notes. Fills with `currentColor`, so `text-*`
 * classes tint it, and sizes from `size-*` / width-height classes like a
 * lucide icon.
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
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M19 5v9h-5v5H5V5zm0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h10l6-6V5c0-1.1-.9-2-2-2m-7 11H7v-2h5zm5-4H7V8h10z" />
    </svg>
  );
}
