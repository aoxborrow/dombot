import type { SVGProps } from 'react';

/**
 * A banknote, from aftermarket's icon set (resources/svg/cash.svg). Used for
 * pricing. Fills with `currentColor`, so `text-*` classes tint it, and sizes
 * from `size-*` / width-height classes like a lucide icon.
 */
export function CashIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M10.3,8c0,1.3-1,2.3-2.3,2.3S5.7,9.3,5.7,8s1-2.3,2.3-2.3S10.3,6.7,10.3,8z M9.2,8c0-0.6-0.5-1.2-1.2-1.2S6.8,7.4,6.8,8S7.4,9.2,8,9.2S9.2,8.6,9.2,8z" />
      <path d="M1,4.8C1,4,1.7,3.3,2.5,3.3h11.1C14.3,3.3,15,4,15,4.8v6.4c0,0.8-0.7,1.5-1.5,1.5H2.5C1.7,12.7,1,12,1,11.2V4.8z M2.5,4.5c-0.2,0-0.3,0.1-0.3,0.3v0.9h0.6c0.3,0,0.6-0.3,0.6-0.6V4.5H2.5z M2.2,11.2c0,0.2,0.1,0.3,0.3,0.3h0.9v-0.6c0-0.3-0.3-0.6-0.6-0.6H2.2V11.2z M4.5,10.9v0.6h7v-0.6c0-1,0.8-1.8,1.8-1.8h0.6V6.8h-0.6c-1,0-1.8-0.8-1.8-1.8V4.5h-7v0.6c0,1-0.8,1.8-1.8,1.8H2.2v2.3h0.6C3.7,9.2,4.5,10,4.5,10.9z M12.7,11.5h0.9c0.2,0,0.3-0.1,0.3-0.3v-0.9h-0.6c-0.3,0-0.6,0.3-0.6,0.6V11.5z M13.8,5.7V4.8c0-0.2-0.1-0.3-0.3-0.3h-0.9v0.6c0,0.3,0.3,0.6,0.6,0.6H13.8z" />
    </svg>
  );
}
