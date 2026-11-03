import type { SVGProps } from 'react';

/**
 * Certificate glyph — MingCute "certificate-line" (Apache-2.0,
 * https://github.com/Richard9394/MingCute), like {@link StickyNoteIcon}. Used
 * for ownership verification. Fills with `currentColor`, so `text-*` classes
 * tint it, and sizes from `size-*` / width-height classes like a lucide icon.
 */
export function CertificateIcon({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      // MingCute's own 24×24 canvas, the same grid as lucide.
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M10.586 2.1a2 2 0 0 1 2.7-.116l.128.117L15.314 4H18a2 2 0 0 1 1.994 1.85L20 6v2.686l1.9 1.9a2 2 0 0 1 .116 2.701l-.117.127l-1.9 1.9V18a2 2 0 0 1-1.85 1.995L18 20h-2.685l-1.9 1.9a2 2 0 0 1-2.701.116l-.127-.116l-1.9-1.9H6a2 2 0 0 1-1.995-1.85L4 18v-2.686l-1.9-1.9a2 2 0 0 1-.116-2.701l.116-.127l1.9-1.9V6a2 2 0 0 1 1.85-1.994L6 4h2.686zM12 3.516l-1.9 1.9a2 2 0 0 1-1.238.577L8.686 6H6v2.686a2 2 0 0 1-.467 1.285l-.119.13l-1.9 1.9l1.9 1.899a2 2 0 0 1 .578 1.238l.008.176V18h2.686a2 2 0 0 1 1.285.467l.13.119l1.899 1.9l1.9-1.9a2 2 0 0 1 1.238-.578l.176-.008H18v-2.686a2 2 0 0 1 .467-1.285l.119-.13l1.9-1.899l-1.9-1.9a2 2 0 0 1-.578-1.238L18 8.686V6h-2.686a2 2 0 0 1-1.285-.467l-.13-.119l-1.9-1.9Zm3.08 5.468a1 1 0 0 1 1.497 1.32l-.084.094l-4.88 4.88a1.1 1.1 0 0 1-1.46.086l-.096-.085l-2.404-2.404a1 1 0 0 1 1.32-1.498l.094.083l1.768 1.768z" />
    </svg>
  );
}
