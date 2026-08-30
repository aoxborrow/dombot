const stack = [
  ['Electron', 'Cross-platform desktop shell'],
  ['Electron Forge', 'Packaging, makers & the Vite plugin'],
  ['React 19', 'Renderer UI'],
  ['TypeScript', 'End-to-end types, including IPC'],
  ['Vite', 'Dev server & bundling'],
  ['Tailwind CSS v4', 'Styling'],
  ['React Router', 'Client-side routing'],
  ['Zustand', 'State management'],
];

export default function About() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">About</h1>
        <p className="mt-1 text-slate-400">The stack powering this app.</p>
      </div>

      <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
        {stack.map(([name, desc]) => (
          <li key={name} className="flex items-baseline gap-4 px-5 py-3">
            <span className="w-40 shrink-0 font-medium">{name}</span>
            <span className="text-sm text-slate-400">{desc}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
