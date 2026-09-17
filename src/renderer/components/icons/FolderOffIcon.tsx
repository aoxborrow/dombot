import type { SVGProps } from 'react';

/**
 * Folder-with-a-slash glyph — Google Material "folder_off" (outlined), the
 * companion to {@link FolderIcon}. Used for the "None" option in folder
 * dropdowns (clear/remove folder). Fills with `currentColor` so `text-*`
 * classes tint it, and sizes from `size-*` / width-height classes.
 */
export function FolderOffIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      // Keep the full 24×24 canvas (unlike FolderIcon's crop): the slash runs
      // corner to corner, so a tighter viewBox would clip its tips and skew it
      // off 45°. Renders a touch smaller than the folder, which reads fine for
      // the secondary "None" affordance.
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M20 6h-8l-2-2H7.17l4 4H20v9.17l1.76 1.76c.15-.28.24-.59.24-.93V8c0-1.1-.9-2-2-2zM2.1 2.1.69 3.51l1.56 1.56c-.15.28-.24.59-.24.93L2 18c0 1.1.9 2 2 2h13.17l3.31 3.31 1.41-1.41L2.1 2.1zM4 18V6.83L15.17 18H4z" />
    </svg>
  );
}
