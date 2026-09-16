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
      className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-sm"
    >
      <FlaskConical className="size-4 shrink-0 text-amber-500" aria-hidden />
      <p className="flex-1 leading-snug">
        <span className="font-medium">Demo Mode.</span> Fake domains and
        credentials, nothing leaves browser.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => window.location.reload()}
        title="Start over with a fresh portfolio"
      >
        <RotateCcw className="size-3.5" />
        Reset demo
      </Button>
    </div>
  );
}
