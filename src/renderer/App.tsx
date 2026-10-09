import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  Globe,
  History,
  Menu,
  RefreshCw,
  Settings as SettingsIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppStore } from './store/app';
import Domains from './pages/Domains';
import Renewals from './pages/Renewals';
import Activity from './pages/Activity';
import Settings from './pages/Settings';
import ApprovalModal from './components/ApprovalModal';
import DemoBanner from './components/DemoBanner';
import { useWeeklyUpdateCheck } from './lib/updates';
import StatusBar from './components/StatusBar';
import { isDemo } from './lib/platform';
import { useTabMetrics, type TabMetrics } from './lib/tab-metrics';
import {
  TabLink,
  TabPill,
  TabStrip,
  type TabProps,
} from './components/TabStrip';
import { useSyncState } from './lib/sync-state';
import { ActivityBell } from './components/activity/ActivityBell';
import { Toaster } from '@/components/ui/sonner';

/**
 * How each page shows as a header tab, by route: which metric its pill shows
 * (a key of useTabMetrics) and how it compacts in narrower windows. Pages
 * themselves are listed in NAV_ITEMS.
 */
const TAB_OPTIONS: Record<
  string,
  { metric?: keyof TabMetrics } & Omit<TabProps, 'icon' | 'label' | 'metric'>
> = {
  '/': { metric: 'domains', pillFrom: 'md' },
  '/renewals': { metric: 'renewals', pillFrom: 'lg' },
  '/activity': { metric: 'activity', pillFrom: 'lg' },
  '/settings': {
    pillFrom: 'lg',
    // The gear is drawn smaller than the other icons, so it's bumped up.
    iconClassName: 'size-[17px]',
  },
};

export default function App() {
  useWeeklyUpdateCheck();
  const appInfo = useAppStore((s) => s.appInfo);
  const hydrateFromCache = useAppStore((s) => s.hydrateFromCache);
  const applyPortfolioCacheUpdate = useAppStore(
    (s) => s.applyPortfolioCacheUpdate,
  );
  const loadFolders = useAppStore((s) => s.loadFolders);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const loadPurchases = useAppStore((s) => s.loadPurchases);
  const loadListPrices = useAppStore((s) => s.loadListPrices);
  const loadDomainEvents = useAppStore((s) => s.loadDomainEvents);
  const loadRegistrars = useAppStore((s) => s.loadRegistrars);
  const attachBulk = useAppStore((s) => s.attachBulk);
  const applyBulkProgress = useAppStore((s) => s.applyBulkProgress);
  const applyBulkFinished = useAppStore((s) => s.applyBulkFinished);
  const navigate = useNavigate();
  const metrics = useTabMetrics();

  // Restore the last-cached portfolio, detail, and pricing on launch so the app
  // opens fully populated with no network calls. The user
  // refreshes manually; we never auto-refresh, even when the data is stale.
  useEffect(() => {
    void hydrateFromCache();
  }, [hydrateFromCache]);

  // Load the user's folders (definitions + assignments) on launch, alongside the
  // cache hydration, so the Domains table paints folder chips immediately.
  useEffect(() => {
    void loadFolders();
    void loadSettings();
    void loadPurchases();
    void loadListPrices();
    void loadDomainEvents();
    // The bell lists sync errors from any page.
    void loadRegistrars();
  }, [
    loadFolders,
    loadSettings,
    loadPurchases,
    loadListPrices,
    loadDomainEvents,
    loadRegistrars,
  ]);

  // The macOS app menu's About DomBot / Check for Updates… / Settings….
  useEffect(
    () => window.api.onNavigateRequested((route) => navigate(route)),
    [navigate],
  );

  // An MCP tool write mutates the on-disk cache out of band; re-read it and
  // overlay the change so an open Domains table updates live, without a Sync.
  useEffect(() => {
    const off = window.api.onPortfolioChanged(
      () => void applyPortfolioCacheUpdate(),
    );
    return off;
  }, [applyPortfolioCacheUpdate]);

  // Mirror the main-process bulk job: pick up one already running (or the last
  // finished one) on launch, then stream item results onto the rows.
  useEffect(() => {
    void attachBulk();
    const offProgress = window.api.onBulkProgress(applyBulkProgress);
    const offFinished = window.api.onBulkFinished(applyBulkFinished);
    return () => {
      offProgress();
      offFinished();
    };
  }, [attachBulk, applyBulkProgress, applyBulkFinished]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {isDemo() && <DemoBanner />}
      {/* Three columns: the logo, the tab strip (centered, so the two side
          columns match), and the bell just right of the tabs. The tabs run
          along the bottom edge, on the tab bar color that also shows above
          them. */}
      <header className="grid h-12 grid-cols-[1fr_auto_1fr] border-b bg-tab-bar px-4 sm:px-6">
        <div className="flex flex-1 items-center">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="DomBot — go to Domains"
            className="peer group relative -top-px -ml-1 flex items-center gap-2"
          >
            <svg
              viewBox="0 0 32 32"
              aria-hidden="true"
              className="size-[34px]"
              fill="var(--brand)"
            >
              <path d="m25 6h-18c-1.06087 0-2.07828.42143-2.82843 1.17157-.75014.75015-1.17157 1.76756-1.17157 2.82843v14c0 1.0609.42143 2.0783 1.17157 2.8284.75015.7502 1.76756 1.1716 2.82843 1.1716h18c1.0609 0 2.0783-.4214 2.8284-1.1716.7502-.7501 1.1716-1.7675 1.1716-2.8284v-14c0-1.06087-.4214-2.07828-1.1716-2.82843-.7501-.75014-1.7675-1.17157-2.8284-1.17157zm2 18c0 .5304-.2107 1.0391-.5858 1.4142s-.8838.5858-1.4142.5858h-18c-.53043 0-1.03914-.2107-1.41421-.5858-.37508-.3751-.58579-.8838-.58579-1.4142v-14c0-.53043.21071-1.03914.58579-1.41421.37507-.37508.88378-.58579 1.41421-.58579h18c.5304 0 1.0391.21071 1.4142.58579.3751.37507.5858.88378.5858 1.41421zm-6.5-7h-9c-.9283 0-1.8185.3687-2.47487 1.0251-.65638.6564-1.02513 1.5466-1.02513 2.4749s.36875 1.8185 1.02513 2.4749c.65637.6564 1.54657 1.0251 2.47487 1.0251h9c.9283 0 1.8185-.3687 2.4749-1.0251s1.0251-1.5466 1.0251-2.4749-.3687-1.8185-1.0251-2.4749-1.5466-1.0251-2.4749-1.0251zm-3.5 2v3h-2v-3zm-7 1.5c0-.3978.158-.7794.4393-1.0607s.6629-.4393 1.0607-.4393h1.5v3h-1.5c-.3978 0-.7794-.158-1.0607-.4393s-.4393-.6629-.4393-1.0607zm10.5 1.5h-1.5v-3h1.5c.3978 0 .7794.158 1.0607.4393s.4393.6629.4393 1.0607-.158.7794-.4393 1.0607-.6629.4393-1.0607.4393z" />
              <circle cx="10.5" cy="12" r="2" />
              <circle cx="21.5" cy="12" r="2" />
            </svg>
            <span className="max-w-0 overflow-hidden text-xl font-bold tracking-tight whitespace-nowrap opacity-0 transition-all duration-200 lg:group-hover:max-w-[7ch] lg:group-hover:opacity-100">
              Dom<span className="text-brand">Bot</span>
            </span>
          </button>
          {/* The running version, dim, just after the logo (it slides over
              as the wordmark opens on hover); opens Settings → About.
              Desktop widths only. */}
          {appInfo && (
            <button
              type="button"
              onClick={() => navigate('/settings?tab=about')}
              className="relative top-[2px] ml-0.5 hidden rounded-sm text-[11px] text-muted-foreground/50 transition-[margin] duration-200 peer-hover:ml-3 hover:text-muted-foreground sm:inline"
              title="About this version"
            >
              v{appInfo.version}
            </button>
          )}
        </div>
        {/* Desktop: the tab strip. On phones it collapses into the hamburger
            menu on the right (MobileNav). */}
        <TabStrip className="hidden self-end sm:flex">
          {NAV_ITEMS.map(({ to, label, icon }) => {
            const { metric, ...options } = TAB_OPTIONS[to] ?? {};
            return (
              <TabLink
                key={to}
                to={to}
                end={to === '/'}
                label={label}
                icon={icon}
                metric={metric ? metrics[metric] : null}
                {...options}
              />
            );
          })}
        </TabStrip>
        {/* Right side: the bell, plus the hamburger on phones. Sync lives in
            the status bar (and in the hamburger menu on phones). */}
        {/* col-start-3 keeps it in the right column on phones, where the
            hidden tab strip leaves the middle one empty. */}
        <div className="col-start-3 flex items-center justify-end gap-2 sm:justify-start sm:pl-3">
          <span className="mr-2 inline-flex sm:mr-0">
            <ActivityBell />
          </span>
          <MobileNav />
        </div>
      </header>

      {/* The window never scrolls: header and status bar stay put and this
          area between them scrolls when a page is taller. Its scrollbar gutter
          is always reserved so pages of different heights line up. The top 8px
          fades out, so scrolled content doesn't cut off hard at the tabs. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable] [mask-image:linear-gradient(to_bottom,transparent,black_8px)] px-4 pt-[22px] pb-4 sm:px-6 sm:pt-[31px]">
        <Routes>
          <Route path="/" element={<Domains />} />
          <Route path="/renewals" element={<Renewals />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      {/* App-wide bottom status bar (MCP status + background-load lights). */}
      <StatusBar />

      {/* App-wide: surfaces MCP connection approvals regardless of route. */}
      <ApprovalModal />

      {/* App-wide toast host. Offset above the fixed status bar (h-6). */}
      <Toaster position="bottom-right" offset={32} />
    </div>
  );
}

const NAV_ITEMS = [
  { to: '/', label: 'Domains', icon: Globe },
  { to: '/renewals', label: 'Renewals', icon: CalendarClock },
  { to: '/activity', label: 'Activity', icon: History },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
] as const;

/**
 * Phone-only hamburger: the primary destinations in a dropdown, since the
 * labeled nav doesn't fit a narrow header. Hidden at sm+, where the centered nav
 * takes over. The active route is checked.
 */
function MobileNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isActive = (to: string) =>
    to === '/' ? pathname === '/' : pathname.startsWith(to);
  const {
    sync,
    syncing,
    disabled: syncDisabled,
    title: syncTitle,
  } = useSyncState();
  const metrics = useTabMetrics();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Open navigation menu"
          className="sm:hidden"
        >
          <Menu />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
          const active = isActive(to);
          const metric = TAB_OPTIONS[to]?.metric;
          return (
            <DropdownMenuItem
              key={to}
              onSelect={() => navigate(to)}
              // The current route is marked by the green fill (matching the
              // desktop nav pill), not a trailing check.
              className={cn(
                'gap-2.5',
                active &&
                  'bg-primary text-primary-foreground focus:bg-primary focus:text-primary-foreground [&_svg]:text-primary-foreground!',
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
              <TabPill
                metric={metric ? metrics[metric] : null}
                className={cn(
                  'ml-auto',
                  active && 'bg-white/20 text-primary-foreground',
                )}
              />
            </DropdownMenuItem>
          );
        })}
        {/* The Sync action lives here on phones; on wider screens it's in the
            status bar. Domains has its own in the page header. */}
        {pathname !== '/' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => sync()}
              disabled={syncDisabled}
              title={syncTitle}
              className="gap-2.5"
            >
              <RefreshCw
                className={cn('size-4 shrink-0', syncing && 'animate-spin')}
              />
              {syncing ? 'Syncing…' : 'Sync'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
