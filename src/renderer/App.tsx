import { NavLink, Route, Routes } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ModeToggle } from '@/components/mode-toggle';
import Domains from './pages/Domains';
import Renewals from './pages/Renewals';
import Settings from './pages/Settings';
import ApprovalModal from './components/ApprovalModal';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );

export default function App() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b px-6 py-3">
        <span className="text-lg font-semibold tracking-tight">dombot</span>
        <nav className="flex gap-1">
          <NavLink to="/" end className={navLinkClass}>
            Domains
          </NavLink>
          <NavLink to="/renewals" className={navLinkClass}>
            Renewals
          </NavLink>
          <NavLink to="/settings" className={navLinkClass}>
            Settings
          </NavLink>
        </nav>
        <div className="ml-auto">
          <ModeToggle />
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <Routes>
          <Route path="/" element={<Domains />} />
          <Route path="/renewals" element={<Renewals />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      {/* App-wide: surfaces MCP connection approvals regardless of route. */}
      <ApprovalModal />
    </div>
  );
}
