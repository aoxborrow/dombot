import type { SVGProps } from 'react';

/**
 * A funnel with a plus, for adding a filter. Tabler Icons' `filter-plus`, by
 * Paweł Kuna (MIT, https://github.com/tabler/tabler-icons). Strokes with
 * `currentColor`, so `text-*` classes tint it, and sizes from `size-*` /
 * width-height classes like a lucide icon. Drawn wider than Tabler's: the
 * right half (funnel edge, stem and plus) sits 3 units over, so it's 27 wide
 * and wants `h-4 w-[18px]` where a lucide icon takes `size-4`.
 */
export function FilterPlusIcon({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 27 24"
      width="1.125em"
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
      <path d="m12 20l-3 1v-8.5L4.52 7.572A2 2 0 0 1 4 6.227V4h19v2.172a2 2 0 0 1-.586 1.414L18 12v3m1 4h6m-3-3v6" />
    </svg>
  );
}
