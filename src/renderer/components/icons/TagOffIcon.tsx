import { useId, type SVGProps } from 'react';

/**
 * A tag with a slash through it, in lucide's style, as lucide has no
 * tag-off: its tag, cut away around the slash as its other -off icons are.
 * The slash runs "/", across the tag, rather than lucide's usual "\",
 * which would run along it and through its hole. Strokes in `currentColor`
 * and sizes from `size-*` classes, like a lucide icon. The Listings view's
 * Not listed card.
 */
export function TagOffIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  const mask = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <mask id={mask}>
        <rect width="24" height="24" fill="white" />
        <path d="M22 2 2 22" stroke="black" strokeWidth={5} />
      </mask>
      <g mask={`url(#${mask})`}>
        <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
        <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
      </g>
      <path d="M22 2 2 22" />
    </svg>
  );
}
