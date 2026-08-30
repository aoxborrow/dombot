import { useCallback, useEffect, useState } from 'react';
import type { McpClient, McpInfo } from '../../../shared/ipc';

export default function McpClientsSettings() {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [clients, setClients] = useState<McpClient[]>([]);

  const refresh = useCallback(async () => {
    const [mcpInfo, list] = await Promise.all([
      window.api.getMcpInfo(),
      window.api.listMcpClients(),
    ]);
    setInfo(mcpInfo);
    setClients(list);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = async (clientId: string) => {
    await window.api.revokeMcpClient(clientId);
    await refresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">MCP Clients</h2>
        <p className="mt-1 text-sm text-slate-400">
          Agents connect to dombot&apos;s local MCP server to manage your
          portfolio. New connections must be approved in the app.
        </p>
      </div>

      {info?.running && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Connect a client
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Server URL:{' '}
            <span className="font-mono text-slate-200">{info.url}</span>
          </p>
          <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">
            Claude Code
          </p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-slate-950 p-3 text-xs text-slate-300">
            <code>{`claude mcp add dombot --transport http ${info.url}`}</code>
          </pre>
        </section>
      )}

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Paired clients
        </h3>
        {clients.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No clients paired yet. Connect one and approve it to see it here.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-800">
            {clients.map((c) => (
              <li
                key={c.clientId}
                className="flex items-center justify-between py-3"
              >
                <div>
                  <p className="text-sm font-medium">{c.clientName}</p>
                  <p className="text-xs text-slate-500">
                    Paired {formatDate(c.pairedAt)}
                  </p>
                </div>
                <button
                  onClick={() => void revoke(c.clientId)}
                  className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/40"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatDate(ms: number): string {
  if (!ms) return 'recently';
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? 'recently' : d.toLocaleString();
}
