import { useEffect, type ReactNode } from 'react';
import {
  BookOpen,
  Bug,
  ExternalLink,
  Globe,
  Heart,
  Lightbulb,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { isDemo, isWeb } from '@/lib/platform';
import { openUpdate, releaseNotesUrl, useUpdates } from '@/lib/updates';
import { timeAgo } from '@/lib/time';
import { releasesNewerThan } from '../../../shared/releases';
import { useAppStore } from '../../store/app';
import { SettingsCard } from './SettingsCard';

const REPO = 'https://github.com/aoxborrow/dombot';
const SPONSOR = 'https://github.com/sponsors/aoxborrow';

const PLATFORM_LABEL: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
  web: 'Self-hosted',
};

const open = (url: string) => void window.api.openExternal(url);

/**
 * Which DomBot this is and whether a newer one is out (with a link to its
 * release notes on GitHub), then the project itself: sponsoring, links and
 * the license.
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

  // Opening the page loads the list if this device has none stored yet,
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
          Your version of DomBot, whether there’s a newer one, and the project
          behind it.
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
            {feed?.checkedAt && !demo && (
              <p className="text-xs text-muted-foreground">
                Last checked {timeAgo(Date.parse(feed.checkedAt))}
                {feed.error && ` · the latest check failed (${feed.error})`}
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => open(releaseNotesUrl(newer))}
                >
                  <ExternalLink className="size-3.5" />
                  Release notes
                </Button>
              )}
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
                Once a week DomBot reads the release list at
                dombot.ai/releases.json and lets you know when there’s a newer
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

      <SettingsCard title="About DomBot" contentClassName="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-md text-sm text-muted-foreground">
            DomBot is free and open source. If it saves you time or money,
            sponsoring helps fund its development.
          </p>
          <Button size="sm" variant="outline" onClick={() => open(SPONSOR)}>
            <Heart className="size-3.5 fill-pink-500 text-pink-500" />
            Sponsor
          </Button>
        </div>
        <div className="flex flex-col gap-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">
            Contributions are welcome: report a bug, request a feature, or open
            a pull request on GitHub.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <ProjectLink url={REPO} icon={<GitHubMark />}>
              GitHub
            </ProjectLink>
            <ProjectLink url={`${REPO}#readme`} icon={<BookOpen />}>
              Documentation
            </ProjectLink>
            <ProjectLink url={`${REPO}/issues/new?labels=bug`} icon={<Bug />}>
              Report a bug
            </ProjectLink>
            <ProjectLink
              url={`${REPO}/issues/new?labels=enhancement`}
              icon={<Lightbulb />}
            >
              Request a feature
            </ProjectLink>
            <ProjectLink url="https://dombot.ai" icon={<Globe />}>
              dombot.ai
            </ProjectLink>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Licensed under the{' '}
          <button
            type="button"
            onClick={() => open(`${REPO}/blob/main/LICENSE`)}
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            GNU AGPL v3.0
          </button>{' '}
          · © Aaron Oxborrow
        </p>
      </SettingsCard>
    </div>
  );
}

function ProjectLink({
  url,
  icon,
  children,
}: {
  url: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => open(url)}
      className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
    >
      {icon}
      {children}
    </button>
  );
}

/** GitHub's mark (lucide dropped brand icons). */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
