import { ArrowUpRight, FlaskConical, RotateCcw } from 'lucide-react';
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
      <FlaskConical className="size-3.5 shrink-0 text-amber-500" aria-hidden />
      <p className="leading-snug text-amber-50/60">
        <span className="font-medium text-amber-500">Demo Mode</span>
        <span className="mx-1.5" aria-hidden>
          –
        </span>
        Fake domains and credentials, nothing leaves browser.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-6 shrink-0 px-2 text-xs text-foreground/60 hover:text-foreground"
        onClick={() => window.location.reload()}
        title="Start over with a fresh portfolio"
      >
        <RotateCcw className="size-3" />
        Reset demo
      </Button>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="ml-auto h-6 shrink-0 border-foreground/40 px-2 text-xs text-foreground hover:text-foreground"
      >
        <a href="https://dombot.ai/" target="_blank" rel="noopener noreferrer">
          DomBot.ai
          <ArrowUpRight className="size-3" />
        </a>
      </Button>
    </div>
  );
}
