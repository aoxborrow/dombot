import { useEffect, useState } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type {
  ProxySettings as ProxySettingsData,
  ProxyTestResult,
  RegistrarDefinition,
} from '../../../shared/ipc';
import { accountTitle } from '../../../shared/account-label';
import { parseProxy } from '../../../shared/proxy';
import { isDemo, isWeb } from '../../lib/platform';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SettingsCard } from './SettingsCard';

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The fixed IP proxy: configured once here, switched on per account under
 * Registrars. Identical on desktop and web, and included in data exports, so
 * the same proxy and the same allowlisted address work on both.
 */
export default function ProxySettings() {
  const [settings, setSettings] = useState<ProxySettingsData | null>(null);
  const [catalog, setCatalog] = useState<RegistrarDefinition[]>([]);
  const [url, setUrl] = useState('');
  const [egressIp, setEgressIp] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<ProxyTestResult | null>(null);

  const apply = (next: ProxySettingsData) => {
    setSettings(next);
    setUrl(next.proxy?.url ?? '');
    setEgressIp(next.proxy?.egressIp ?? '');
  };

  useEffect(() => {
    void Promise.all([
      window.api.getProxySettings(),
      window.api.getRegistrarCatalog(),
    ])
      .then(([next, definitions]) => {
        apply(next);
        setCatalog(definitions);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  // The demo shows the page but takes no edits and makes no connections.
  const locked = busy !== null || settings === null || isDemo();
  const saved = settings?.proxy ?? null;
  const users = settings?.users ?? [];
  const filled = Boolean(url.trim() && egressIp.trim());
  const dirty =
    url.trim() !== (saved?.url ?? '') ||
    egressIp.trim() !== (saved?.egressIp ?? '');

  // Same validation the server runs, so a typo is caught before any request.
  const validate = (): { url: string; egressIp: string } | null => {
    try {
      const route = parseProxy({ url, egressIp });
      if (!route) throw new Error('Enter both the proxy URL and its address.');
      return { url: url.trim(), egressIp: egressIp.trim() };
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  };

  const run = async (kind: 'save' | 'test' | 'remove') => {
    setError(null);
    if (kind !== 'test') setTest(null);
    const input = kind === 'remove' ? null : validate();
    if (kind !== 'remove' && !input) return;
    setBusy(kind);
    try {
      if (kind === 'test') setTest(await window.api.testProxySettings(input!));
      else {
        if (kind === 'save') await window.api.saveProxySettings(input!);
        else await window.api.removeProxySettings();
        apply(await window.api.getProxySettings());
        toast.success(kind === 'save' ? 'Proxy saved' : 'Proxy removed');
      }
    } catch (err) {
      if (kind === 'test') setTest(null);
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const registrarName = (name: string) =>
    catalog.find((r) => r.name === name)?.displayName ?? name;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold">Proxy</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Some registrars only accept API requests from an address you have
          allowlisted. If the machine running DomBot doesn&apos;t have a fixed
          one, send those requests through a proxy that does. Set it up once
          here, then turn on <strong>Use fixed IP proxy</strong> for each
          account under Registrars.
        </p>
      </div>

      <SettingsCard title="Fixed IP proxy">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run('save');
          }}
        >
          <FieldGroup className="gap-4">
            <Field className="gap-1.5">
              <FieldLabel htmlFor="proxy-url">Proxy URL</FieldLabel>
              <FieldDescription className="text-[13px]">
                An HTTP or HTTPS CONNECT proxy, by hostname or public IPv4
                address. Prefer HTTPS when the proxy needs a username and
                password; an HTTP proxy receives them unencrypted.
              </FieldDescription>
              <Input
                id="proxy-url"
                type="password"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                placeholder="https://user:password@proxy.example.com:8080"
                value={url}
                disabled={locked}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setTest(null);
                }}
              />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="proxy-egress-ip">
                Outgoing IPv4 address
              </FieldLabel>
              <FieldDescription className="text-[13px]">
                The address registrars see, which may differ from the proxy
                endpoint. Add it to each registrar&apos;s API allowlist.
              </FieldDescription>
              <Input
                id="proxy-egress-ip"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                placeholder="203.0.113.10"
                value={egressIp}
                disabled={locked}
                onChange={(e) => {
                  setEgressIp(e.target.value);
                  setTest(null);
                }}
              />
            </Field>
          </FieldGroup>

          {isWeb() && (
            <p className="mt-4 text-sm text-muted-foreground">
              On a self-hosted instance, proxy connections use{' '}
              <a
                className="underline"
                href="https://github.com/latentharbor/tunnelfetch#readme"
                target="_blank"
                rel="noreferrer"
              >
                tunnelfetch
              </a>
              , which has some limitations.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={locked || !filled || !dirty}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={locked || !filled}
              onClick={() => void run('test')}
            >
              {busy === 'test' ? 'Testing…' : 'Test'}
            </Button>
            {saved && (
              <Button
                type="button"
                variant="ghost"
                className="ml-auto text-muted-foreground"
                disabled={locked || users.length > 0}
                title={
                  users.length > 0
                    ? 'Turn the proxy off for the accounts below first'
                    : undefined
                }
                onClick={() => void run('remove')}
              >
                {busy === 'remove' ? 'Removing…' : 'Remove proxy'}
              </Button>
            )}
          </div>

          {test && (
            <p
              role="status"
              className={
                test.matches
                  ? 'mt-3 flex items-start gap-1.5 text-sm text-[#31613b] dark:text-[#7ac28d]'
                  : 'mt-3 flex items-start gap-1.5 text-sm text-amber-600 dark:text-amber-400'
              }
            >
              {test.matches ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0" />
              ) : (
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              )}
              {test.matches
                ? `Connected. Requests leave from ${test.ip}.`
                : `Connected, but requests leave from ${test.ip}, not ${test.expected}. Registrars will see ${test.ip}, so use that as the outgoing address.`}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      </SettingsCard>

      {saved && (
        <SettingsCard title="Used by">
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No accounts use the proxy yet. Turn on{' '}
              <strong>Use fixed IP proxy</strong> in an account under
              Registrars.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {users.map((user) => (
                <li key={user.accountId}>
                  {accountTitle(
                    registrarName(user.registrar),
                    user.label,
                    user.hasSiblings,
                  )}
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>
      )}
    </div>
  );
}
