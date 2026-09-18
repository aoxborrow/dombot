import { ArrowRight, FlaskConical, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The strip across the top of the demo build. Reset reboots the page, which
 * regenerates the portfolio from the seed (nothing is persisted).
 */
export default function DemoBanner() {
  return (
    <div
      role="note"
      className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-[7px] text-[13px] sm:px-6"
    >
      <FlaskConical
        className="-mr-1 size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
        aria-hidden
      />
      <p className="leading-snug text-foreground/60">
        <span className="font-medium text-amber-600 dark:text-amber-500">
          Demo Mode
        </span>
        {/* The tagline is desktop-only (md+) and the DomBot.ai link sm+, so
            the banner stays a single row on narrow screens. */}
        <span className="mx-1.5 hidden md:inline" aria-hidden>
          –
        </span>
        <span className="hidden md:inline">
          Fake domains and credentials, nothing leaves browser.
        </span>
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-6 shrink-0 border-foreground/25 bg-transparent px-2 text-xs text-foreground/60 hover:bg-amber-500/10 hover:text-foreground max-sm:ml-auto dark:border-input dark:hover:bg-amber-500/10"
        onClick={() => window.location.reload()}
        title="Start over with a fresh portfolio"
      >
        <RotateCcw className="size-3" />
        Reset demo
      </Button>
      <a
        href="https://dombot.ai/"
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto hidden shrink-0 items-center gap-1 text-xs font-semibold text-foreground/50 hover:text-foreground/80 sm:inline-flex"
      >
        DomBot.ai
        <ArrowRight className="size-3" />
      </a>
    </div>
  );
}
