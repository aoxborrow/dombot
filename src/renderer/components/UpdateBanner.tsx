import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpCircle, PartyPopper, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isWeb } from '@/lib/platform';
import { bannerState, openUpdate, useUpdates } from '@/lib/updates';
import { useAppStore } from '../store/app';

/** How often an open window asks whether its weekly check is due. */
const POLL_MS = 6 * 60 * 60 * 1000;

/**
 * The strip across the top that says a newer DomBot is out (with its notes
 * and how to get it), or, once, that this device is now on a newer version.
 * Dismissing hides it until the next release.
 */
export default function UpdateBanner() {
  const navigate = useNavigate();
  const appInfo = useAppStore((s) => s.appInfo);
  const loadAppInfo = useAppStore((s) => s.loadAppInfo);
  const updateChecks = useAppStore((s) => s.settings?.updateChecks);
  const { feed, dismissed, lastSeen, autoCheck, dismiss, markSeen } =
    useUpdates();
  const current = appInfo?.version;

  useEffect(() => {
    if (!appInfo) void loadAppInfo();
  }, [appInfo, loadAppInfo]);

  // First run on this device: remember the version without announcing it.
  useEffect(() => {
    if (current && !lastSeen) markSeen(current);
  }, [current, lastSeen, markSeen]);

  useEffect(() => {
    if (!updateChecks) return;
    void autoCheck();
    const timer = setInterval(() => void autoCheck(), POLL_MS);
    return () => clearInterval(timer);
  }, [updateChecks, autoCheck]);

  const state = bannerState(
    current,
    updateChecks ? (feed?.releases ?? []) : [],
    dismissed,
    lastSeen,
  );
  if (!state || !current) return null;

  const showNotes = () => {
    if (state.kind === 'updated') markSeen(current);
    navigate('/settings?tab=about');
  };
  const close = () =>
    state.kind === 'available'
      ? dismiss(state.latest.version)
      : markSeen(current);

  const Icon = state.kind === 'available' ? ArrowUpCircle : PartyPopper;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-brand/30 bg-brand/10 px-4 py-[7px] text-[13px] sm:px-6"
    >
      <Icon className="-mr-1 size-3.5 shrink-0 text-brand" aria-hidden />
      <p className="min-w-0 truncate leading-snug text-foreground/60">
        {/* Phones get the short form so the buttons still fit on one row. */}
        <span className="font-medium text-brand">
          {state.kind === 'available' ? (
            <>
              <span className="sm:hidden">
                {state.latest.version} available
              </span>
              <span className="max-sm:hidden">
                DomBot {state.latest.version} is available
              </span>
            </>
          ) : (
            <>
              <span className="sm:hidden">Updated to {state.version}</span>
              <span className="max-sm:hidden">
                Updated to DomBot {state.version}
              </span>
            </>
          )}
        </span>
        {state.kind === 'available' && (
          <span className="hidden md:inline">
            <span className="mx-1.5" aria-hidden>
              –
            </span>
            you have {current}
            {state.newer.length > 1 &&
              ` (${state.newer.length} releases behind)`}
          </span>
        )}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-6 shrink-0 border-foreground/25 bg-transparent px-2 text-xs text-foreground/60 hover:bg-brand/10 hover:text-foreground max-sm:ml-auto dark:border-input dark:hover:bg-brand/10"
        onClick={showNotes}
      >
        What’s new
      </Button>
      {state.kind === 'available' && (
        <Button
          size="sm"
          className="h-6 shrink-0 px-2 text-xs"
          onClick={() => openUpdate(state.latest)}
        >
          {isWeb() ? 'How to update' : 'Download'}
        </Button>
      )}
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="-mr-1 shrink-0 rounded p-1 text-foreground/40 hover:text-foreground/80 sm:ml-auto"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
