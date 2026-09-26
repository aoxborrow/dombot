import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  CalendarClock,
  Globe,
  History,
  Menu,
  RefreshCw,
  Settings as SettingsIcon,
  Store,
  Tag,
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
import Placeholder from './pages/Placeholder';
import Settings from './pages/Settings';
import ApprovalModal from './components/ApprovalModal';
import DemoBanner from './components/DemoBanner';
import StatusBar from './components/StatusBar';
import { isDemo } from './lib/platform';
import { useTabMetrics, type TabMetric } from './lib/tab-metrics';
import { SyncStatusMini, useSyncState } from './components/SyncControl';
import { Toaster } from '@/components/ui/sonner';

/**
 * Browser-style tab strip filling the header's full height. Inactive tabs form
 * a shared muted strip with hairline dividers; the active tab is in the page
 * background with no bottom border, so it reads as attached to the content
 * below.
 */
const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    // A 2px gap between neighbouring tabs shows the header shell between them.
    // Padding widens at xl; pills and the Settings label drop out at
    // narrower widths (see TabPill and the Settings tab) so all five tabs fit.
    'relative ml-0.5 inline-flex items-center gap-2 border px-3 text-base font-medium leading-none transition-colors first:ml-0 xl:px-[18px] [&>svg]:-mr-0.5 [&>svg]:opacity-80',
    isActive
      ? // The selected tab stands 2px proud of the strip, in the page
        // background so it merges into the content.
        'z-10 h-[38px] rounded-t-[6px] border-border border-b-background bg-background text-foreground'
      : // Light mode uses a shade deeper than --muted/--border so the strip
        // reads against the white page; dark mode keeps the tokens.
        'h-[36px] rounded-t-[7px] border-[oklch(0.88_0_0)] border-b-transparent bg-[oklch(0.915_0_0)] text-[oklch(0.45_0_0)] shadow-[inset_0_-1px_2px_-1px_rgba(0,0,0,0.14)] hover:text-foreground dark:border-white/6 dark:bg-muted dark:text-muted-foreground dark:shadow-[inset_0_-1px_2px_-1px_rgba(0,0,0,0.35)]',
  );

/** The metric pill inside a tab (count, spend, or an alert-tinted issue count). */
function TabPill({
  metric,
  className,
  compactHide = false,
}: {
  metric: TabMetric | null;
  className?: string;
  /** Hide below lg so the strip fits narrower windows; Domains keeps its
   *  count down to md. */
  compactHide?: boolean;
}) {
  if (!metric) return null;
  return (
    <span
      title={metric.title}
      className={cn(
        'h-5 items-center rounded-full px-2 text-xs font-medium tabular-nums',
        compactHide ? 'hidden lg:inline-flex' : 'inline-flex',
        metric.alert
          ? 'bg-destructive/12 text-destructive'
          : 'bg-foreground/8 text-muted-foreground',
        className,
      )}
    >
      {metric.value}
    </span>
  );
}

export default function App() {
  const hydrateFromCache = useAppStore((s) => s.hydrateFromCache);
  const applyPortfolioCacheUpdate = useAppStore(
    (s) => s.applyPortfolioCacheUpdate,
  );
  const loadFolders = useAppStore((s) => s.loadFolders);
  const attachBulk = useAppStore((s) => s.attachBulk);
  const applyBulkProgress = useAppStore((s) => s.applyBulkProgress);
  const applyBulkFinished = useAppStore((s) => s.applyBulkFinished);
  const navigate = useNavigate();
  const metrics = useTabMetrics();

  // <main> reserves a scrollbar gutter (see below), which narrows its content
  // box and shifts the centered page container left by half the gutter. The
  // header doesn't scroll, so it can't reserve one — instead measure the
  // gutter and pad the header's tab container by the same amount, keeping the
  // Settings tab flush with the page's content edge. Re-measured on resize in
  // case the platform swaps overlay/classic scrollbars.
  const mainRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = mainRef.current;
      if (!el) return;
      document.documentElement.style.setProperty(
        '--scrollbar-gutter',
        `${el.offsetWidth - el.clientWidth}px`,
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

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
  }, [loadFolders]);

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
      {/* Demo banner temporarily disabled while iterating on the header. */}
      {false && isDemo() && <DemoBanner />}
      {/* Header shell: a light grey just off-white in light mode, a very dark
          grey a step darker than the tab strip in dark mode. It shows behind
          the logo and, via the top padding, above the tabs so their tops (and
          the selected tab's rounded corners) are visible. */}
      <header className="relative flex h-12 items-end border-b bg-[oklch(0.955_0_0)] px-4 sm:px-6 dark:bg-[oklch(0.2_0_0)]">
        {/* Logo, pinned to the left edge and vertically centered (nudged up
            1px, since the mark is bottom-heavy), out of the tab strip's flow. */}
        <div className="absolute inset-y-0 left-4 flex items-center sm:left-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="DomBot — go to Domains"
            className="group relative -top-px -ml-1 flex items-center gap-2"
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
        </div>
        {/* Desktop: the tab strip, right-justified inside the same max-w-4xl
            container the Settings page uses, so the Settings tab's right edge
            tracks that page's content edge at every width. On phones it
            collapses into the hamburger menu (MobileNav). */}
        <div className="hidden flex-1 pr-(--scrollbar-gutter) sm:block">
          <div className="mx-auto flex w-full max-w-4xl justify-end">
            <nav className="-mb-px flex items-end">
              <NavLink to="/" end className={tabClass}>
                <Globe className="size-[15px]" />
                Domains
                {/* Count hidden below md so all six tabs fit. */}
                <TabPill metric={metrics.domains} className="max-md:hidden" />
              </NavLink>
              <NavLink to="/markets" className={tabClass}>
                <Store className="size-[15px]" />
                Markets
                <TabPill metric={metrics.markets} compactHide />
              </NavLink>
              <NavLink to="/sales" className={tabClass}>
                <Tag className="size-[15px]" />
                Sales
                <TabPill metric={metrics.sales} compactHide />
              </NavLink>
              <NavLink to="/renewals" className={tabClass}>
                <CalendarClock className="size-[15px]" />
                Renewals
                <TabPill metric={metrics.renewals} compactHide />
              </NavLink>
              {/* Icon-only below lg (like Settings' gear) so six tabs fit. */}
              <NavLink
                to="/activity"
                className={(state) => cn(tabClass(state), 'max-lg:px-3.5')}
                title="Activity"
              >
                <History className="size-[15px] max-lg:mr-0!" />
                <span className="hidden lg:inline">Activity</span>
              </NavLink>
              {/* Below md the Settings tab is just its gear: even padding, a
                  touch wider, and the gear's label-tightening margin dropped.
                  From lg, where the other tabs show pills, 4px extra on the
                  right so it doesn't read as short beside them. */}
              <NavLink
                to="/settings"
                className={(state) =>
                  cn(tabClass(state), 'max-md:px-3.5 lg:pr-4 xl:pr-[22px]')
                }
              >
                <SettingsIcon className="size-[17px] mr-0! md:-mr-[3px]!" />
                <span className="hidden md:inline">Settings</span>
                <TabPill metric={metrics.settings} compactHide />
              </NavLink>
            </nav>
          </div>
        </div>
        {/* Phones: a compact sync status, right-justified to the left of the
            hamburger (the Sync action lives inside the menu). */}
        <div className="ml-auto flex items-center gap-2 self-center sm:hidden">
          <SyncStatusMini className="mr-2" />
          <MobileNav />
        </div>
      </header>

      {/* The content area is the scroll container, not the document, so the
          header always spans the full window and the scrollbar sits below it.
          The gutter is reserved inside <main> so content doesn't shift
          horizontally between pages that do and don't scroll. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <main
          ref={mainRef}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-[22px] pb-4 [scrollbar-gutter:stable] sm:px-6 sm:pt-[31px]"
        >
          <Routes>
            <Route path="/" element={<Domains />} />
            <Route
              path="/markets"
              element={
                <Placeholder
                  title="Markets"
                  description="Marketplace listings and demand."
                />
              }
            />
            <Route
              path="/sales"
              element={
                <Placeholder
                  title="Sales"
                  description="Domains you've sold and offers received."
                />
              }
            />
            <Route path="/renewals" element={<Renewals />} />
            <Route
              path="/activity"
              element={
                <Placeholder
                  title="Activity"
                  description="Changes across your portfolio."
                />
              }
            />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
        {/* Scrolled content fades into the page background just under the
            header, so rows don't cut off hard against the tab strip. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-background to-transparent"
        />
      </div>

      {/* App-wide bottom status bar (MCP status + background-load lights). */}
      <StatusBar />

      {/* App-wide: surfaces MCP connection approvals regardless of route. */}
      <ApprovalModal />

      {/* App-wide toast host. Offset above the fixed status bar (h-6). */}
      <Toaster position="bottom-right" offset={32} />
    </div>
  );
}

const MOBILE_NAV = [
  { to: '/', label: 'Domains', icon: Globe, metric: 'domains' },
  { to: '/markets', label: 'Markets', icon: Store, metric: 'markets' },
  { to: '/sales', label: 'Sales', icon: Tag, metric: 'sales' },
  {
    to: '/renewals',
    label: 'Renewals',
    icon: CalendarClock,
    metric: 'renewals',
  },
  { to: '/activity', label: 'Activity', icon: History, metric: null },
  {
    to: '/settings',
    label: 'Settings',
    icon: SettingsIcon,
    metric: 'settings',
  },
] as const;

/**
 * Phone-only hamburger: the three primary destinations in a dropdown, since the
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
        {MOBILE_NAV.map(({ to, label, icon: Icon, metric }) => {
          const active = isActive(to);
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
        {/* The Sync action lives here on phones (the desktop header has its own
            button); the last-synced time/errors show beside the hamburger. */}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
