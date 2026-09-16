import { FlaskConical, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The strip across the top of the demo build. Reset reboots the page, which
 * regenerates the portfolio from the seed (nothing is persisted).
 */
export default function DemoBanner() {
  return (
    <div
      role="note"
      className="flex h-8 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 text-xs"
    >
      <FlaskConical className="size-3.5 shrink-0 text-amber-500" aria-hidden />
      <p className="flex-1 leading-snug text-muted-foreground">
        <span className="font-medium text-amber-500">Demo Mode.</span> Fake
        domains and credentials, nothing leaves browser.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-6 shrink-0 px-2 text-xs"
        onClick={() => window.location.reload()}
        title="Start over with a fresh portfolio"
      >
        <RotateCcw className="size-3" />
        Reset demo
      </Button>
    </div>
  );
}
