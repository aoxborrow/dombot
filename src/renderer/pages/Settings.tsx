import { useState } from 'react';
import RegistrarsSettings from './settings/RegistrarsSettings';
import McpClientsSettings from './settings/McpClientsSettings';

const SECTIONS = [
  { id: 'registrars', label: 'Registrars' },
  { id: 'mcp', label: 'MCP' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export default function Settings() {
  const [section, setSection] = useState<SectionId>('registrars');

  return (
    <div className="mx-auto flex max-w-4xl gap-8">
      <aside className="w-44 shrink-0">
        <h1 className="mb-3 px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Settings
        </h1>
        <nav className="space-y-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={[
                'block w-full rounded-md px-3 py-1.5 text-left text-sm font-medium transition-colors',
                section === s.id
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-white',
              ].join(' ')}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        {section === 'registrars' && <RegistrarsSettings />}
        {section === 'mcp' && <McpClientsSettings />}
      </div>
    </div>
  );
}
