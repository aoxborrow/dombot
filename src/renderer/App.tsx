import { useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { CalendarClock, Globe, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from './store/app';
import Domains from './pages/Domains';
import Renewals from './pages/Renewals';
import Settings from './pages/Settings';
import ApprovalModal from './components/ApprovalModal';
import StatusBar from './components/StatusBar';
import SyncControl from './components/SyncControl';
import { Toaster } from '@/components/ui/sonner';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    // inline-flex + items-center + leading-none centers the icon/label as one
    // box, so the active pill's fill is vertically symmetric (plain line-height
    // left a few extra px on top).
    'inline-flex h-9 items-center gap-2 rounded-md px-[15px] text-base font-medium leading-none transition-colors',
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );

export default function App() {
  const hydrateFromCache = useAppStore((s) => s.hydrateFromCache);
  const applyPortfolioCacheUpdate = useAppStore(
    (s) => s.applyPortfolioCacheUpdate,
  );
  const loadFolders = useAppStore((s) => s.loadFolders);

  // Restore the last-cached portfolio, detail, aftermarket, and pricing on
  // launch so the app opens fully populated with no network calls. The user
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

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center border-b px-6 py-2">
        <div className="flex flex-1 items-center">
          <button
            type="button"
            onClick={() => void window.api.openExternal('https://dombot.ai')}
            aria-label="DomBot — open dombot.ai"
            className="group ml-[2px] flex items-center gap-2"
          >
            <svg
              viewBox="0 0 32 32"
              aria-hidden="true"
              className="size-[37px]"
              fill="#7ac28d"
            >
              <path d="m25 6h-18c-1.06087 0-2.07828.42143-2.82843 1.17157-.75014.75015-1.17157 1.76756-1.17157 2.82843v14c0 1.0609.42143 2.0783 1.17157 2.8284.75015.7502 1.76756 1.1716 2.82843 1.1716h18c1.0609 0 2.0783-.4214 2.8284-1.1716.7502-.7501 1.1716-1.7675 1.1716-2.8284v-14c0-1.06087-.4214-2.07828-1.1716-2.82843-.7501-.75014-1.7675-1.17157-2.8284-1.17157zm2 18c0 .5304-.2107 1.0391-.5858 1.4142s-.8838.5858-1.4142.5858h-18c-.53043 0-1.03914-.2107-1.41421-.5858-.37508-.3751-.58579-.8838-.58579-1.4142v-14c0-.53043.21071-1.03914.58579-1.41421.37507-.37508.88378-.58579 1.41421-.58579h18c.5304 0 1.0391.21071 1.4142.58579.3751.37507.5858.88378.5858 1.41421zm-6.5-7h-9c-.9283 0-1.8185.3687-2.47487 1.0251-.65638.6564-1.02513 1.5466-1.02513 2.4749s.36875 1.8185 1.02513 2.4749c.65637.6564 1.54657 1.0251 2.47487 1.0251h9c.9283 0 1.8185-.3687 2.4749-1.0251s1.0251-1.5466 1.0251-2.4749-.3687-1.8185-1.0251-2.4749-1.5466-1.0251-2.4749-1.0251zm-3.5 2v3h-2v-3zm-7 1.5c0-.3978.158-.7794.4393-1.0607s.6629-.4393 1.0607-.4393h1.5v3h-1.5c-.3978 0-.7794-.158-1.0607-.4393s-.4393-.6629-.4393-1.0607zm10.5 1.5h-1.5v-3h1.5c.3978 0 .7794.158 1.0607.4393s.4393.6629.4393 1.0607-.158.7794-.4393 1.0607-.6629.4393-1.0607.4393z" />
              <circle cx="10.5" cy="12" r="2" />
              <circle cx="21.5" cy="12" r="2" />
            </svg>
            <span className="max-w-0 overflow-hidden text-xl font-bold tracking-tight whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[7ch] group-hover:opacity-100">
              Dom<span style={{ color: '#7ac28d' }}>Bot</span>
            </span>
          </button>
        </div>
        <nav className="flex flex-1 justify-center gap-4">
          <NavLink to="/" end className={navLinkClass}>
            <Globe className="size-[18px]" />
            Domains
          </NavLink>
          <NavLink to="/renewals" className={navLinkClass}>
            <CalendarClock className="size-[18px]" />
            Renewals
          </NavLink>
          <NavLink to="/settings" className={navLinkClass}>
            <SettingsIcon className="size-[18px]" />
            Settings
          </NavLink>
        </nav>
        {/* Global sync control on the right; also balances the logo so the nav
            stays centered. */}
        <div className="flex flex-1 justify-end">
          <SyncControl />
        </div>
      </header>

      {/* Extra bottom padding clears the fixed status bar (h-6) so the last
          row of a page is never hidden behind it. */}
      <main className="flex-1 px-6 pt-[21px] pb-14">
        <Routes>
          <Route path="/" element={<Domains />} />
          <Route path="/renewals" element={<Renewals />} />
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
