import type { SVGProps } from 'react';

/**
 * Folder glyph — Google Material "folder" (outlined). Used in place of the
 * lucide Folder so the icon matches the app's chosen style. Fills with
 * `currentColor`, so `text-*` color classes tint it (the folder-color chips),
 * and sizes from `size-*` / width-height classes like a lucide icon.
 */
export function FolderIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      // The Material artwork sits at x:2–22, y:4–20 of its 24×24 canvas — more
      // padding than lucide. Crop the viewBox to just around the glyph so it
      // fills a size-* box at ~the same visual scale as the lucide icons.
      viewBox="1 2 22 20"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M20 6h-8l-1.41-1.41C10.21 4.21 9.7 4 9.17 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2m-1 12H5c-.55 0-1-.45-1-1V9c0-.55.45-1 1-1h14c.55 0 1 .45 1 1v8c0 .55-.45 1-1 1" />
    </svg>
  );
}
