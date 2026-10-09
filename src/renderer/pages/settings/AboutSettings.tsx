import {
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowUpCircle,
  BookOpen,
  Bug,
  ExternalLink,
  Globe,
  Heart,
  Lightbulb,
  Loader2,
  RefreshCw,
  RotateCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { isDemo, isWeb } from '@/lib/platform';
import { releaseNotesUrl, updateUrl, useUpdates } from '@/lib/updates';
import { timeAgo } from '@/lib/time';
import { releasesNewerThan } from '../../../shared/releases';
import type { UpdaterState } from '../../../shared/ipc';
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

/** A link out of the app, in a new tab on the web. On the desktop the main
 *  process's window-open handler sends `_blank` links to the system browser
 *  (the same as every other external link in the app). */
function ExtLink(props: ComponentProps<'a'>) {
  return <a target="_blank" rel="noopener noreferrer" {...props} />;
}

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
  const current = appInfo?.version;
  const updateChecks = settings?.updateChecks ?? true;

  useEffect(() => {
    if (!appInfo) void loadAppInfo();
    void loadSettings();
  }, [appInfo, loadAppInfo, loadSettings]);

  // Opening the page loads the list if this device has none stored yet,
  // unless the user has turned checking off — then only "Check now" asks.
  useEffect(() => {
    if (settings?.updateChecks && !feed) void check();
  }, [settings?.updateChecks, feed, check]);

  // The app menu's Check for Updates… arrives with ?check=1: check now, once,
  // and drop the flag so a reload doesn't check again.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('check') !== '1') return;
    void check(true);
    setParams({ tab: 'about' }, { replace: true });
  }, [params, setParams, check]);

  const releases = feed?.releases ?? [];
  const newer = current ? releasesNewerThan(releases, current) : [];

  // Desktop update-on-click. The main process owns the download, so leaving
  // and reopening this page picks its progress back up.
  const [updater, setUpdater] = useState<UpdaterState | null>(null);
  useEffect(() => {
    if (!isWeb()) void window.api.getUpdaterState().then(setUpdater);
  }, []);
  const startUpdate = async () => {
    setUpdater((u) => u && { ...u, status: 'downloading', error: null });
    setUpdater(await window.api.downloadUpdate());
  };
  const inPlace = !isWeb() && updater?.supported === true;

  let status: string;
  if (checking && !feed) status = 'Checking for updates…';
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
                  {isDemo()
                    ? 'Demo'
                    : (PLATFORM_LABEL[appInfo.platform] ?? appInfo.platform)}
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
            {newer.length > 0 && updater?.status === 'error' && (
              <p className="text-xs text-destructive">
                The update didn’t download: {updater.error}{' '}
                <ExtLink
                  href={newer[0].url}
                  className="underline underline-offset-2"
                >
                  Download it from GitHub
                </ExtLink>{' '}
                instead.
              </p>
            )}
            {newer.length > 0 && !isWeb() && updater?.unsupportedReason && (
              <p className="text-xs text-muted-foreground">
                {updater.unsupportedReason}
              </p>
            )}
            {feed?.checkedAt && (
              <p className="text-xs text-muted-foreground">
                Last checked {timeAgo(Date.parse(feed.checkedAt))}
                {feed.error && ` · the latest check failed (${feed.error})`}
              </p>
            )}
          </div>
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
              <Button variant="outline" size="sm" asChild>
                <ExtLink href={releaseNotesUrl(newer)}>
                  <ExternalLink className="size-3.5" />
                  Release notes
                </ExtLink>
              </Button>
            )}
            {newer.length > 0 && inPlace && (
              <UpdateButton
                version={newer[0].version}
                state={updater}
                onUpdate={() => void startUpdate()}
              />
            )}
            {newer.length > 0 && !inPlace && (
              <Button size="sm" asChild>
                <ExtLink href={updateUrl(newer[0])}>
                  {isWeb() ? 'How to update' : `Download ${newer[0].version}`}
                </ExtLink>
              </Button>
            )}
          </div>
        </div>

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
      </SettingsCard>

      <SettingsCard title="About DomBot" contentClassName="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          DomBot is free and open-source software, released under the{' '}
          <ExtLink
            href={`${REPO}/blob/main/LICENSE`}
            className="text-foreground underline-offset-2 hover:underline"
          >
            GNU AGPL v3.0
          </ExtLink>
          .
        </p>
        {/* Pulled out a little so the rows' hover fill has room, while the
            dividers stop short of the card's edges. */}
        <ul className="-mx-3 divide-y divide-border/60">
          <ProjectLink
            url={SPONSOR}
            icon={<Heart className="fill-pink-500 text-pink-500" />}
            title="Sponsor DomBot"
            hint="Help fund its development"
          />
          <ProjectLink
            url={`${REPO}#readme`}
            icon={<BookOpen />}
            title="Documentation"
            hint="Setup, self-hosting, and MCP"
          />
          <ProjectLink
            url={`${REPO}/issues/new?labels=bug`}
            icon={<Bug />}
            title="Report a bug"
            hint="Let us know what’s broken"
          />
          <ProjectLink
            url={`${REPO}/issues/new?labels=enhancement`}
            icon={<Lightbulb />}
            title="Request a feature"
            hint="Ideas and new registrars welcome"
          />
          <ProjectLink
            url={REPO}
            icon={<GitHubMark />}
            title="View source"
            hint="Code and releases on GitHub"
          />
          <ProjectLink
            url="https://dombot.ai"
            icon={<Globe />}
            title="DomBot.ai"
            hint="Learn more on our website"
          />
        </ul>
        {/* Full-bleed footer strip, out to the card's edges. Dimmer than
            the muted text in dark mode, where that grey still reads loud. */}
        <p className="-mx-6 -mb-[19px] border-t bg-muted/40 px-6 py-3 text-xs text-muted-foreground dark:text-muted-foreground/70">
          © 2026{' '}
          <ExtLink
            href="https://x.com/aoxborrow"
            className="hover:text-foreground"
          >
            Aaron Oxborrow
          </ExtLink>{' '}
          and contributors
        </p>
      </SettingsCard>
    </div>
  );
}

/** The desktop's in-place update: download, then restart into it. */
function UpdateButton({
  version,
  state,
  onUpdate,
}: {
  version: string;
  state: UpdaterState | null;
  onUpdate: () => void;
}) {
  if (state?.status === 'ready')
    return (
      <Button size="sm" onClick={() => void window.api.installUpdate()}>
        <RotateCw className="size-3.5" />
        Restart to update
      </Button>
    );
  if (state?.status === 'downloading')
    return (
      <Button size="sm" disabled>
        <Loader2 className="size-3.5 animate-spin" />
        Downloading…
      </Button>
    );
  return (
    <Button size="sm" onClick={onUpdate}>
      <ArrowUpCircle className="size-3.5" />
      Update to {version}
    </Button>
  );
}

/** One row of the project list: icon, title, a few words on what's there,
 *  and an arrow saying it opens in the browser. The whole row is the link. */
function ProjectLink({
  url,
  icon,
  title,
  hint,
}: {
  url: string;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <li>
      <ExtLink
        href={url}
        className="group flex w-full items-center gap-3 rounded-md max-sm:items-start px-3 py-2.5 text-left hover:bg-foreground/[0.04]"
      >
        <span className="flex size-4 shrink-0 items-center justify-center max-sm:mt-0.5 text-muted-foreground group-hover:text-foreground [&_svg]:size-4">
          {icon}
        </span>
        <span className="min-w-0 flex-1 text-sm">
          {/* One line on wider screens; on phones the hint goes under the
              title. */}
          <span className="font-medium max-sm:block">{title}</span>
          <span className="text-muted-foreground max-sm:block">
            <span className="max-sm:hidden"> – </span>
            {hint}
          </span>
        </span>
        <ExternalLink
          className="size-3.5 shrink-0 text-muted-foreground/60 group-hover:text-foreground max-sm:hidden"
          aria-hidden
        />
      </ExtLink>
    </li>
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
