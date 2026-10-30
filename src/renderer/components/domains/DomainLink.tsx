import { ExternalLink } from 'lucide-react';

/**
 * A domain name that opens the site in a new tab/window (Electron hands
 * target=_blank to the OS browser). noreferrer keeps the Referer header off
 * the request. In a table cell that lights green on hover (index.css) the
 * name underlines instead, and an external-link glyph shows; the glyph
 * always takes its space, so nothing shifts when it appears.
 */
export function DomainLink({ name }: { name: string }) {
  return (
    <a
      href={`https://${name}/`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open https://${name} in a new window`}
      className="group/domain inline-flex items-center font-mono underline-offset-[3px] hover:underline compact:text-[13px]"
    >
      {/* One step up from the reduced mobile body size — the domain is the
          row's primary field. Desktop inherits the table's text-sm. */}
      {name}
      <ExternalLink
        className="ml-1.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover/domain:opacity-70"
        aria-hidden
      />
    </a>
  );
}
