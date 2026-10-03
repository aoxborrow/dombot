import type { SVGProps } from 'react';

/**
 * A funnel with a plus, for adding a filter. Tabler Icons' `filter-plus`, by
 * Paweł Kuna (MIT, https://github.com/tabler/tabler-icons). Strokes with
 * `currentColor`, so `text-*` classes tint it, and sizes from `size-*` /
 * width-height classes like a lucide icon.
 */
export function FilterPlusIcon({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="m12 20l-3 1v-8.5L4.52 7.572A2 2 0 0 1 4 6.227V4h16v2.172a2 2 0 0 1-.586 1.414L15 12v3m1 4h6m-3-3v6" />
    </svg>
  );
}
