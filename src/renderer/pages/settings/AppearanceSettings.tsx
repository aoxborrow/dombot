import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useAppStore } from '../../store/app';

/** Appearance preferences (UI-only, persisted in localStorage). */
export default function AppearanceSettings() {
  const statusBarVisible = useAppStore((s) => s.statusBarVisible);
  const setStatusBarVisible = useAppStore((s) => s.setStatusBarVisible);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tailor how dombot looks. These preferences are stored on this device
          only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Status bar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Show status bar</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                The bottom bar showing the MCP server status and
                background-loading progress.
              </p>
            </div>
            <Toggle
              checked={statusBarVisible}
              onChange={setStatusBarVisible}
              label="Show status bar"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Minimal switch-style toggle (no shadcn Switch in this project). */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block size-4 rounded-full bg-background shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
