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
import { RegistrarLogo } from '../../components/RegistrarLogo';
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
 * the same proxy and the same whitelisted address work on both.
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
  // Emptying the URL and saving clears the stored proxy (and its address).
  const clearing = !url.trim() && Boolean(saved);
  const canSave = dirty && (filled || clearing);

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
    if (kind === 'test') {
      // Testing needs only the URL — the outgoing address is what it reveals.
      if (!url.trim()) {
        setError('Enter the proxy URL.');
        return;
      }
      setBusy('test');
      try {
        const result = await window.api.testProxySettings({
          url: url.trim(),
          egressIp: egressIp.trim(),
        });
        setTest(result);
        // A clean connection with no address entered yet: adopt the one the
        // test found and save it, so it's ready without retyping.
        if (result.matches && !egressIp.trim() && result.ip) {
          setEgressIp(result.ip);
          await window.api.saveProxySettings({
            url: url.trim(),
            egressIp: result.ip,
          });
          apply(await window.api.getProxySettings());
          toast.success('Proxy saved');
        }
      } catch (err) {
        setTest(null);
        setError(errorMessage(err));
      } finally {
        setBusy(null);
      }
      return;
    }

    setTest(null);
    // A save with an emptied URL means "clear it", same as Remove.
    const removing = kind === 'remove' || !url.trim();
    const input = removing ? null : validate();
    if (!removing && !input) return;
    setBusy(kind);
    try {
      if (removing) await window.api.removeProxySettings();
      else await window.api.saveProxySettings(input!);
      apply(await window.api.getProxySettings());
      toast.success(removing ? 'Proxy removed' : 'Proxy saved');
    } catch (err) {
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
          whitelisted. If the machine running DomBot doesn&apos;t have a fixed
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
              <div className="flex items-start gap-2">
                <Input
                  id="proxy-url"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  placeholder="https://user:pass@proxy.example.com:8080"
                  value={url}
                  disabled={locked}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setTest(null);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 border-border"
                  disabled={locked || !url.trim()}
                  onClick={() => void run('test')}
                >
                  {busy === 'test' ? 'Testing…' : 'Test'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground/55">
                <code className="font-mono">
                  https://user:pass@proxy.example.com:8080
                </code>{' '}
                or{' '}
                <code className="font-mono">
                  http://user:pass@203.0.113.10:3128
                </code>
              </p>
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="proxy-egress-ip">
                Proxy IPv4 address
              </FieldLabel>
              <FieldDescription className="text-[13px]">
                The outgoing IP address registrars see, which may differ from the
                proxy endpoint. Whitelist it in each registrar&apos;s API
                settings. Clicking the &ldquo;Test&rdquo; button will fill in the
                IP address here.
              </FieldDescription>
              <Input
                id="proxy-egress-ip"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                placeholder="123.456.789.001"
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
            <Button type="submit" disabled={locked || !canSave}>
              {busy === 'save'
                ? clearing
                  ? 'Clearing…'
                  : 'Saving…'
                : clearing
                  ? 'Clear'
                  : 'Save'}
            </Button>
            {saved && (
              <Button
                type="button"
                variant="outline"
                className="ml-auto border-border text-muted-foreground"
                disabled={locked}
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
                ? test.expected
                  ? `Connected through the proxy. Registrars will see your requests coming from ${test.ip}.`
                  : `Connected through the proxy. Your outgoing address is ${test.ip}.`
                : `Connected, but your requests came from ${test.ip}, not the ${test.expected} you entered. Registrars will see ${test.ip}, so use that as the outgoing address.`}
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
            <ul className="-my-1 flex flex-col divide-y divide-border/60">
              {users.map((user) => (
                <li
                  key={user.accountId}
                  className="flex items-center gap-3 py-2.5"
                >
                  <RegistrarLogo
                    name={user.registrar}
                    label={registrarName(user.registrar)}
                    className="size-6"
                  />
                  <span className="min-w-0 truncate text-sm">
                    {accountTitle(
                      registrarName(user.registrar),
                      user.label,
                      user.hasSiblings,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>
      )}
    </div>
  );
}
