import { useEffect, useState } from 'react';
import { useAppStore } from '../store/app';

export default function Home() {
  const { appInfo, loadAppInfo, clicks, increment } = useAppStore();
  const [pong, setPong] = useState<string | null>(null);

  useEffect(() => {
    void loadAppInfo();
  }, [loadAppInfo]);

  const handlePing = async () => {
    setPong(await window.api.ping());
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Welcome to dombot</h1>
        <p className="mt-1 text-slate-400">
          Electron + React + TypeScript + Vite, with a typed IPC bridge.
        </p>
      </div>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Zustand store
        </h2>
        <div className="mt-3 flex items-center gap-4">
          <button
            onClick={increment}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Clicked {clicks} times
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          IPC bridge
        </h2>
        <div className="mt-3 flex items-center gap-4">
          <button
            onClick={handlePing}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium hover:bg-slate-800"
          >
            Send ping
          </button>
          {pong && (
            <span className="text-sm text-emerald-400">
              main replied: <code>{pong}</code>
            </span>
          )}
        </div>

        {appInfo && (
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="App" value={`${appInfo.name} v${appInfo.version}`} />
            <Row label="Platform" value={appInfo.platform} />
            <Row label="Electron" value={appInfo.electron} />
            <Row label="Chromium" value={appInfo.chrome} />
            <Row label="Node" value={appInfo.node} />
          </dl>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-mono text-slate-200">{value}</dd>
    </>
  );
}
