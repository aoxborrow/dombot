import { useEffect } from 'react';
import { useAppStore } from '../store/app';

export default function Home() {
  const {
    appInfo,
    loadAppInfo,
    mcpInfo,
    loadMcpInfo,
    domains,
    domainsLoading,
    domainsError,
    loadDynadotDomains,
  } = useAppStore();

  useEffect(() => {
    void loadAppInfo();
    void loadMcpInfo();
  }, [loadAppInfo, loadMcpInfo]);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Welcome to dombot</h1>
        <p className="mt-1 text-slate-400">
          Manage a domain portfolio across registrars and marketplaces.
        </p>
      </div>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Dynadot portfolio
          </h2>
          <button
            onClick={() => void loadDynadotDomains()}
            disabled={domainsLoading}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {domainsLoading ? 'Loading…' : 'Load domains'}
          </button>
        </div>

        {domainsError && (
          <p className="mt-4 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {domainsError}
          </p>
        )}

        {domains.length > 0 && (
          <>
            <p className="mt-4 text-sm text-slate-400">
              {domains.length} domain{domains.length === 1 ? '' : 's'} via
              @aoxborrow/registrar-client
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-800">
                    <th className="py-2 pr-4 font-medium">Domain</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Expires</th>
                    <th className="py-2 pr-4 font-medium">Auto-renew</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {domains.map((d) => (
                    <tr key={d.domainName}>
                      <td className="py-2 pr-4 font-mono text-slate-200">
                        {d.domainName}
                      </td>
                      <td className="py-2 pr-4 text-slate-400">{d.status}</td>
                      <td className="py-2 pr-4 text-slate-400">
                        {formatDate(d.expirationDate)}
                      </td>
                      <td className="py-2 pr-4 text-slate-400">
                        {d.autoRenew ? 'on' : 'off'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!domainsLoading && !domainsError && domains.length === 0 && (
          <p className="mt-4 text-sm text-slate-500">
            Click “Load domains” to fetch your Dynadot portfolio.
          </p>
        )}
      </section>

      {mcpInfo?.running && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Connect an agent (MCP)
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            A local MCP server is running. Point Claude Code (or another MCP
            client) at it to manage this portfolio across your registrars.
          </p>
          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <Row label="URL" value={mcpInfo.url} />
            <Row label="Token" value={mcpInfo.token} />
          </dl>
          <p className="mt-4 text-xs uppercase tracking-wide text-slate-500">
            Claude Code
          </p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-slate-950 p-3 text-xs text-slate-300">
            <code>{`claude mcp add dombot --transport http ${mcpInfo.url} \\\n  --header "Authorization: Bearer ${mcpInfo.token}"`}</code>
          </pre>
        </section>
      )}

      {appInfo && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Runtime
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="App" value={`${appInfo.name} v${appInfo.version}`} />
            <Row label="Platform" value={appInfo.platform} />
            <Row label="Electron" value={appInfo.electron} />
            <Row label="Chromium" value={appInfo.chrome} />
            <Row label="Node" value={appInfo.node} />
          </dl>
        </section>
      )}
    </div>
  );
}

function formatDate(date: Date | null): string {
  if (!date) return '—';
  // IPC delivers a Date via structured clone; guard against string fallbacks.
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-mono text-slate-200">{value}</dd>
    </>
  );
}
