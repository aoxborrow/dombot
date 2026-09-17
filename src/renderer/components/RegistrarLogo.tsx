import type { RegistrarName } from '../../shared/ipc';
import { cn } from '@/lib/utils';

// Brand SVGs live with the marketing site (site/src/assets/logos); share that
// one folder so adding a registrar is just dropping in `<name>.svg` — the glob
// picks it up here, no import to edit. Keyed by filename, which matches the
// RegistrarName (e.g. godaddy.svg → "godaddy").
const LOGO_RAW = import.meta.glob('../../../site/src/assets/logos/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(LOGO_RAW).map(([path, svg]) => [
    path
      .split('/')
      .pop()!
      .replace(/\.svg$/, ''),
    svg,
  ]),
);

/**
 * Strip the brand fills so the logo renders as a flat monochrome mark that
 * inherits `currentColor` — letting a `text-*` class tint it a uniform grey.
 * Drops width/height too so the size comes from CSS.
 */
function monochrome(svg: string): string {
  return (
    svg
      // Drop the XML prolog and comments some exports carry (e.g. dynadot).
      .replace(/<\?xml[\s\S]*?\?>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      // Drop <style> blocks (e.g. dynadot colors its paths via a `.st0` class).
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/\s(?:width|height|fill)="[^"]*"/g, '')
      // Neutralize any inline `fill:#…` left in style attributes.
      .replace(/fill:\s*#[0-9a-fA-F]{3,8}/g, 'fill:currentColor')
      .replace('<svg', '<svg fill="currentColor"')
      .trim()
  );
}

/**
 * The registrar's logo, shown as a small grey mark before the name. Reuses the
 * marketing site's brand SVGs, flattened to `currentColor` for a uniform tint.
 */
export function RegistrarLogo({
  name,
  label,
  className,
}: {
  name: RegistrarName;
  label: string;
  className?: string;
}) {
  const svg = LOGOS[name];
  if (!svg) return null;
  return (
    <span
      role="img"
      aria-label={`${label} logo`}
      className={cn(
        'inline-flex size-[27px] shrink-0 items-center justify-center text-muted-foreground/70 [&>svg]:size-full',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: monochrome(svg) }}
    />
  );
}
