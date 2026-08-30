import { NavLink, Route, Routes } from 'react-router-dom';
import Domains from './pages/Domains';
import Settings from './pages/Settings';
import ApprovalModal from './components/ApprovalModal';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    isActive
      ? 'bg-indigo-600 text-white'
      : 'text-slate-300 hover:bg-slate-800 hover:text-white',
  ].join(' ');

export default function App() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center gap-4 border-b border-slate-800 px-6 py-3">
        <span className="text-lg font-semibold tracking-tight">dombot</span>
        <nav className="flex gap-1">
          <NavLink to="/" end className={navLinkClass}>
            Domains
          </NavLink>
          <NavLink to="/settings" className={navLinkClass}>
            Settings
          </NavLink>
        </nav>
      </header>

      <main className="flex-1 px-6 py-8">
        <Routes>
          <Route path="/" element={<Domains />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      {/* App-wide: surfaces MCP connection approvals regardless of route. */}
      <ApprovalModal />
    </div>
  );
}
