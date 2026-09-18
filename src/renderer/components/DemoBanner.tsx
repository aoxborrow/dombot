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
      className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-[7px] text-[13px]"
    >
      <FlaskConical
        className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
        aria-hidden
      />
      <p className="leading-snug text-foreground/60">
        <span className="font-medium text-amber-600 dark:text-amber-500">
          Demo Mode
        </span>
        {/* The tagline and the DomBot.ai link are desktop-only so the banner
            stays a single row on phones. */}
        <span className="mx-1.5 hidden sm:inline" aria-hidden>
          –
        </span>
        <span className="hidden sm:inline">
          Fake domains and credentials, nothing leaves browser.
        </span>
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-6 shrink-0 border-amber-500/40 bg-transparent px-2 text-xs text-foreground/60 hover:bg-amber-500/10 hover:text-foreground max-sm:ml-auto dark:border-amber-500/40 dark:hover:bg-amber-500/10"
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
        className="ml-auto hidden shrink-0 items-center gap-1 text-xs font-medium text-foreground/70 hover:text-foreground sm:inline-flex"
      >
        DomBot.ai
        <ArrowRight className="size-3" />
      </a>
    </div>
  );
}
