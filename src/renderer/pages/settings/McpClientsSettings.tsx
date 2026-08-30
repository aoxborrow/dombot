import { useCallback, useEffect, useState } from 'react';
import type { McpClient, McpInfo } from '../../../shared/ipc';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

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
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold">MCP</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Agents connect to dombot&apos;s local MCP server to manage your
          portfolio. New connections must be approved in the app.
        </p>
      </div>

      {info?.running && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              Connect a client
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Server URL:{' '}
              <span className="font-mono text-foreground">{info.url}</span>
            </p>
            <div>
              <p className="mb-1 text-xs tracking-wide text-muted-foreground uppercase">
                Claude Code
              </p>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                <code>{`claude mcp add dombot --transport http ${info.url}`}</code>
              </pre>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Paired clients
          </CardTitle>
        </CardHeader>
        <CardContent>
          {clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No clients paired yet. Connect one and approve it to see it here.
            </p>
          ) : (
            <ul className="flex flex-col">
              {clients.map((c, i) => (
                <li key={c.clientId}>
                  {i > 0 && <Separator />}
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">{c.clientName}</p>
                      <p className="text-xs text-muted-foreground">
                        Paired {formatDate(c.pairedAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void revoke(c.clientId)}
                    >
                      Revoke
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatDate(ms: number): string {
  if (!ms) return 'recently';
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? 'recently' : d.toLocaleString();
}
