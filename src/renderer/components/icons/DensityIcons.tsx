import type { SVGProps } from 'react';

// Row-density glyphs — Tabler "baseline-density-medium" / "-small": three
// widely spaced lines against four tight ones. Stroked with `currentColor` on
// a 24×24 grid like lucide, so they size and tint the same way.

function Lines({ d, className, ...props }: SVGProps<SVGSVGElement>) {
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
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d={d} />
    </svg>
  );
}

/** Normal rows: three lines, widely spaced. */
export function DensityMediumIcon(props: SVGProps<SVGSVGElement>) {
  return <Lines d="M4 20h16M4 12h16M4 4h16" {...props} />;
}

/** Compact rows: four lines, close together. */
export function DensitySmallIcon(props: SVGProps<SVGSVGElement>) {
  return <Lines d="M4 3h16M4 9h16M4 15h16M4 21h16" {...props} />;
}
