import { useEffect, useState } from 'react';
import { ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { isDemo, isWeb } from '@/lib/platform';
import { openUpdate, useUpdates } from '@/lib/updates';
import ReleaseNotes from '@/components/ReleaseNotes';
import {
  compareVersions,
  releasesNewerThan,
  type Release,
} from '../../../shared/releases';
import { useAppStore } from '../../store/app';
import { SettingsCard } from './SettingsCard';

const PLATFORM_LABEL: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
  web: 'Self-hosted',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

/**
 * Which DomBot this is, whether a newer one is out, and the notes for every
 * release: the ones not installed yet open at the top, the installed one
 * marked, older ones folded away.
 */
export default function AboutSettings() {
  const appInfo = useAppStore((s) => s.appInfo);
  const loadAppInfo = useAppStore((s) => s.loadAppInfo);
  const settings = useAppStore((s) => s.settings);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const setUpdateChecks = useAppStore((s) => s.setUpdateChecks);
  const { feed, checking, check } = useUpdates();
  const demo = isDemo();
  const current = appInfo?.version;
  const updateChecks = settings?.updateChecks ?? true;

  useEffect(() => {
    if (!appInfo) void loadAppInfo();
    void loadSettings();
  }, [appInfo, loadAppInfo, loadSettings]);

  // Opening the page loads the notes (from the host's cache when fresh),
  // unless the user has turned checking off — then only "Check now" asks.
  useEffect(() => {
    if (!demo && settings?.updateChecks && !feed) void check();
  }, [demo, settings?.updateChecks, feed, check]);

  const releases = feed?.releases ?? [];
  const newer = current ? releasesNewerThan(releases, current) : [];

  let status: string;
  if (demo) status = 'The demo doesn’t check for updates.';
  else if (checking && !feed) status = 'Checking for updates…';
  else if (feed?.error && !releases.length)
    status = `Couldn’t check for updates: ${feed.error}`;
  else if (!feed) status = 'Not checked yet.';
  else if (newer.length === 1)
    status = `DomBot ${newer[0].version} is available.`;
  else if (newer.length > 1)
    status = `${newer.length} newer releases are available; the latest is ${newer[0].version}.`;
  else status = 'You’re on the latest version.';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold">About</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your version of DomBot, newer releases, and what changed in each.
        </p>
      </div>

      <SettingsCard title="Version" contentClassName="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-lg font-semibold">
              DomBot {current ?? '…'}
              {appInfo && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {PLATFORM_LABEL[appInfo.platform] ?? appInfo.platform}
                </span>
              )}
            </p>
            <p
              className={cn(
                'text-sm text-muted-foreground',
                newer.length > 0 && 'font-medium text-brand',
              )}
            >
              {status}
            </p>
            {feed?.error && releases.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Last check failed ({feed.error}); showing the releases from the
                check before.
              </p>
            )}
          </div>
          {!demo && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={checking}
                onClick={() => void check(true)}
              >
                <RefreshCw
                  className={cn('size-3.5', checking && 'animate-spin')}
                />
                Check now
              </Button>
              {newer.length > 0 && (
                <Button size="sm" onClick={() => openUpdate(newer[0])}>
                  {isWeb() ? 'How to update' : `Download ${newer[0].version}`}
                </Button>
              )}
            </div>
          )}
        </div>
        {!demo && (
          <div className="flex items-center justify-between gap-6 border-t pt-4">
            <div>
              <Label htmlFor="update-checks" className="text-sm font-medium">
                Check for updates automatically
              </Label>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                About once a day DomBot reads the release list at
                dombot.ai/releases.json and shows a banner when there’s a newer
                version. Nothing about you or your portfolio is sent.
              </p>
            </div>
            <Switch
              id="update-checks"
              checked={updateChecks}
              disabled={!settings}
              onCheckedChange={(v) => void setUpdateChecks(v)}
            />
          </div>
        )}
      </SettingsCard>

      {releases.length > 0 && current && (
        <SettingsCard
          title="Release notes"
          contentClassName="flex flex-col p-0!"
        >
          {releases.map((r) => (
            <ReleaseRow key={r.version} release={r} current={current} />
          ))}
        </SettingsCard>
      )}
    </div>
  );
}

function ReleaseRow({
  release,
  current,
}: {
  release: Release;
  current: string;
}) {
  const order = compareVersions(release.version, current);
  // Not-yet-installed releases and the installed one start open.
  const [open, setOpen] = useState(order >= 0);
  const date = formatDate(release.publishedAt);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-b px-6 py-3 last:border-b-0"
    >
      <div className="flex items-center gap-2">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          <span className="font-semibold">{release.version}</span>
          {order === 0 && <Badge variant="secondary">Installed</Badge>}
          {order > 0 && <Badge>New</Badge>}
          {date && (
            <span className="truncate text-sm text-muted-foreground">
              {date}
            </span>
          )}
        </CollapsibleTrigger>
        <a
          href={release.url}
          onClick={(e) => {
            e.preventDefault();
            void window.api.openExternal(release.url);
          }}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          GitHub
          <ExternalLink className="size-3" />
        </a>
      </div>
      <CollapsibleContent className="pt-3 pl-6">
        <ReleaseNotes markdown={release.notes} />
      </CollapsibleContent>
    </Collapsible>
  );
}
