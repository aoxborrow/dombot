import {
  registrarGroups,
  registrarSummary,
} from '../../lib/registrar-accounts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, CircleX, ExternalLink, RefreshCw } from 'lucide-react';
import type {
  CredentialValues,
  RegistrarAccount,
  RegistrarDefinition,
  RegistrarMeta,
  RegistrarName,
} from '../../../shared/ipc';
import {
  REGISTRAR_HELP,
  type HelpLink as HelpLinkData,
} from '../../../shared/registrar-help';
import { cn } from '@/lib/utils';
import { useAppStore } from '../../store/app';
import { namecheapCredentials } from '../../../shared/namecheap-proxy';
import { isWeb } from '../../lib/platform';
import { timeAgo } from '../../lib/time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function RegistrarsSettings() {
  const registrars = useAppStore((s) => s.registrars);
  const loadRegistrars = useAppStore((s) => s.loadRegistrars);
  const [catalog, setCatalog] = useState<RegistrarDefinition[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Shared store metadata is the source of truth (so the status bar and Domains
  // agree); load it once and let store actions (save/sync) keep it fresh.
  useEffect(() => {
    void Promise.all([loadRegistrars(), window.api.getRegistrarCatalog()])
      .then(([, definitions]) => setCatalog(definitions))
      .catch((err) => setLoadError(errorMessage(err)));
  }, [loadRegistrars]);

  const groups = useMemo(
    () =>
      registrarGroups(
        catalog
          .slice()
          .sort((a, b) => a.displayName.localeCompare(b.displayName)),
        registrars ?? [],
      ),
    [catalog, registrars],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold">Registrars</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Store API credentials for each registrar. They&apos;re encrypted at
          rest and used by both the app and the MCP server. Saving syncs that
          registrar&apos;s domains automatically.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        )}
        {groups.map(({ provider, accounts, canAddAccount }) => (
          <RegistrarCard
            key={provider.name}
            provider={provider}
            accounts={accounts}
            canAddAccount={canAddAccount}
          />
        ))}
      </div>
    </div>
  );
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const idOf = (account: RegistrarMeta) => account.accountId ?? account.name;

function RegistrarCard({
  provider,
  accounts,
  canAddAccount,
}: {
  provider: RegistrarDefinition;
  accounts: RegistrarMeta[];
  canAddAccount: boolean;
}) {
  const syncRegistrar = useAppStore((s) => s.syncRegistrar);
  const setRegistrarEnabled = useAppStore((s) => s.setRegistrarEnabled);
  const loadRegistrars = useAppStore((s) => s.loadRegistrars);
  const refreshCache = useAppStore((s) => s.applyPortfolioCacheUpdate);
  const [selectedId, setSelectedId] = useState(
    accounts[0] && idOf(accounts[0]),
  );
  const selected = accounts.find((a) => idOf(a) === selectedId) ?? accounts[0];
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const [addedNotice, setAddedNotice] = useState<
    (RegistrarAccount & { message: string }) | null
  >(null);
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const multiple = accounts.length > 1;
  const summary = registrarSummary(provider, accounts);
  // The draft for another account must never replace the selected account.
  const draft = !selected;
  const meta: RegistrarMeta = draft
    ? {
        ...provider,
        configured: false,
        enabled: true,
        sync: { lastSyncedAt: null, lastError: null, domainCount: 0 },
      }
    : selected;
  const [values, setValues] = useState<CredentialValues>({});
  const [original, setOriginal] = useState<CredentialValues>({});
  const [label, setLabel] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toggling, setToggling] = useState(false);
  // Namecheap fixed-IP proxy: on for an account whose stored creds carry one.
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentId = selected && idOf(selected);
  const currentLabel = selected?.accountLabel ?? 'Default';

  useEffect(() => {
    if (!open) return;
    let current = true;
    setError(null);
    if (draft || !currentId) {
      setValues({});
      setOriginal({});
      setLabel('');
      setProxyEnabled(false);
      setLoading(false);
    } else {
      setLoading(true);
      setLabel(currentLabel);
      window.api
        .getRegistrarCredentials(provider.name, currentId)
        .then((creds) => {
          if (current) {
            setValues(creds);
            setOriginal(creds);
            setProxyEnabled(
              Boolean(creds.proxyUrl?.trim() || creds.proxyIp?.trim()),
            );
            setLoading(false);
          }
        })
        .catch((err) => {
          if (current) setError(errorMessage(err));
        });
    }
    return () => {
      current = false;
    };
  }, [open, draft, currentId, currentLabel, provider.name]);

  const runSync = async (allAccounts = false) => {
    if (!selected || draft) return;
    setSyncing(true);
    setError(null);
    try {
      const targets = allAccounts
        ? accounts.filter((account) => account.configured && account.enabled)
        : [selected];
      for (const account of targets) {
        await syncRegistrar(provider.name, idOf(account));
      }
    } catch (err) {
      setError(errorMessage(err));
      if (allAccounts) setOpen(true);
    } finally {
      setSyncing(false);
    }
  };

  const save = async () => {
    if (loading) return;
    setSaving(true);
    setError(null);
    try {
      const trimmed = Object.fromEntries(
        Object.entries(values)
          .map(([k, v]) => [k, v.trim()])
          .filter(([, v]) => v),
      ) as CredentialValues;
      // Namecheap: apply/strip the fixed-IP proxy per the toggle. This validates
      // an enabled proxy (both URL and IP present and public) before any save.
      const clean =
        provider.name === 'namecheap'
          ? namecheapCredentials(trimmed, proxyEnabled)
          : trimmed;
      if (draft) {
        // Same Save action as before; no empty account is created beforehand.
        const account = await window.api.connectRegistrarAccount(
          provider.name,
          clean,
        );
        setSelectedId(account.id);
        await loadRegistrars();
        await syncRegistrar(provider.name, account.id);
      } else {
        const id = idOf(selected);
        const changed = Object.keys({ ...original, ...clean }).some(
          (k) => original[k] !== clean[k],
        );
        if (changed)
          await window.api.saveRegistrarCredentials(provider.name, clean, id);
        if (renaming && label.trim() && label.trim() !== currentLabel)
          await window.api.renameRegistrarAccount(id, label.trim());
        setOriginal(clean);
        setValues(clean);
        setRenaming(false);
        if (changed) await syncRegistrar(provider.name, id);
        else {
          await loadRegistrars();
          await refreshCache();
        }
      }
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const toggleEnabled = async (next: boolean, allAccounts = false) => {
    if (!selected || draft) return;
    setToggling(true);
    setError(null);
    try {
      const targets = allAccounts
        ? accounts.filter(
            (account) => account.configured && account.enabled !== next,
          )
        : [selected];
      for (const account of targets) {
        await setRegistrarEnabled(provider.name, next, idOf(account));
      }
    } catch (err) {
      setError(errorMessage(err));
      if (allAccounts) setOpen(true);
    } finally {
      setToggling(false);
    }
  };
  const remove = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await window.api.removeRegistrarAccount(idOf(selected));
      await loadRegistrars();
      await refreshCache();
      setRemoving(false);
      setRenaming(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const added = (account: RegistrarAccount) => {
    setAdding(false);
    requestAnimationFrame(() => addButton.current?.focus());
    setAddedNotice({
      ...account,
      message: `“${account.label}” added. Syncing its domains…`,
    });
    void (async () => {
      await loadRegistrars();
      const result = await syncRegistrar(provider.name, account.id);
      setAddedNotice((notice) =>
        notice?.id === account.id
          ? {
              ...notice,
              message: result.lastError
                ? `“${account.label}” added. Sync failed: ${result.lastError}`
                : `“${account.label}” added · ${result.domainCount} domain${result.domainCount === 1 ? '' : 's'} synced.`,
            }
          : notice,
      );
    })().catch((err) =>
      setAddedNotice((notice) =>
        notice?.id === account.id
          ? {
              ...notice,
              message: `“${account.label}” added. Could not refresh: ${errorMessage(err)}`,
            }
          : notice,
      ),
    );
  };

  const busy = saving || syncing || toggling || loading;
  const { configured, enabled, sync } = meta;
  const help = REGISTRAR_HELP[provider.name];
  const hasCredentials = Object.values(values).some((v) => v.trim());
  // A Namecheap proxy supplies the outgoing ClientIp, so it isn't required in the
  // form when the proxy is on (the URL/IP live in the proxy section below).
  const proxySuppliesIp = provider.name === 'namecheap' && proxyEnabled;
  const missingRequired =
    hasCredentials &&
    provider.configFields.some(
      (f) =>
        f.required &&
        !values[f.name]?.trim() &&
        !(proxySuppliesIp && f.name === 'clientIp'),
    );

  return (
    <Card className="gap-0 overflow-hidden rounded-md py-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        {/* Header row: the name + sync status expand the card; the Sync button
            sits outside the triggers so it works even while collapsed. */}
        <div className="flex items-center gap-3 px-5 py-[13px]">
          {/* Enable/disable toggle, kept to the far left and outside the expand
              triggers so it reads as a row-level on/off (not a sync switch) and
              isn't hit when expanding the card. Always shown so every logo lines
              up; read-only (off) until the registrar has credentials. */}
          <div className="flex w-9 shrink-0 justify-center">
            <Switch
              checked={summary.configured && summary.enabled}
              onCheckedChange={(v) => void toggleEnabled(v, true)}
              disabled={busy || !summary.configured}
              aria-label={
                summary.configured
                  ? `${summary.enabled ? 'Disable' : 'Enable'} ${meta.displayName}${multiple ? ' — all accounts' : ''}`
                  : `${meta.displayName} — add credentials to enable`
              }
              title={
                !summary.configured
                  ? 'Add credentials to enable this registrar'
                  : summary.enabled
                    ? 'Disable this registrar’s accounts (keeps credentials and cached data)'
                    : 'Enable and sync this registrar’s accounts'
              }
            />
          </div>
          <CollapsibleTrigger className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[18px] gap-y-1 text-left">
            <span
              className={cn(
                'flex shrink-0 items-center gap-2.5 whitespace-nowrap font-medium',
                // Dim the name for a configured-but-disabled registrar so the
                // off state reads at a glance.
                summary.configured && !summary.enabled && 'opacity-50',
              )}
            >
              <RegistrarLogo name={meta.name} label={meta.displayName} />
              {meta.displayName}
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <SyncStatus
                meta={multiple ? summary : meta}
                syncing={syncing}
                showCount={!multiple}
              />
              {multiple && (
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  · {summary.sync.domainCount} domain
                  {summary.sync.domainCount === 1 ? '' : 's'}
                </span>
              )}
            </span>
          </CollapsibleTrigger>
          {/* Sync only makes sense for an enabled registrar. */}
          {summary.configured && summary.enabled && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void runSync(true)}
              disabled={busy}
              title="Sync all enabled accounts for this registrar"
              // Absorb the button's height into the row's vertical padding so a
              // configured row (which shows this button) stays the same slim
              // height as an unconfigured one, rather than growing to fit it.
              className="-my-1 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn(syncing && 'animate-spin')} />
              {syncing ? 'Syncing…' : 'Sync'}
            </Button>
          )}
          <CollapsibleTrigger
            className="shrink-0"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform',
                open && 'rotate-180',
              )}
            />
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent className="border-t px-5 py-4">
          {multiple && (
            <div className="mb-4 flex items-center gap-3">
              <Field className="flex-1 gap-1.5">
                <FieldLabel htmlFor={`${provider.name}-account`}>
                  Account
                </FieldLabel>
                <Select
                  value={currentId}
                  disabled={busy}
                  onValueChange={(id) => {
                    setSelectedId(id);
                    setRenaming(false);
                    setRemoving(false);
                  }}
                >
                  <SelectTrigger
                    id={`${provider.name}-account`}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {accounts.map((a) => (
                        <SelectItem key={idOf(a)} value={idOf(a)}>
                          {a.accountLabel ?? 'Default'}
                          {!a.enabled ? ' (disabled)' : ''}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {!renaming && (
                <Button
                  className="self-end"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setRenaming(true)}
                >
                  Rename
                </Button>
              )}
            </div>
          )}
          {multiple && (
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Switch
                checked={configured && enabled}
                onCheckedChange={(value) => void toggleEnabled(value)}
                disabled={busy || !configured}
                aria-label={`${enabled ? 'Disable' : 'Enable'} ${currentLabel}`}
              />
              <span className="text-sm">Account status</span>
              <SyncStatus meta={meta} syncing={syncing} showCount={false} />
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                · {meta.sync.domainCount} domain
                {meta.sync.domainCount === 1 ? '' : 's'}
              </span>
              {configured && enabled && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void runSync()}
                >
                  <RefreshCw className={cn(syncing && 'animate-spin')} />
                  Sync account
                </Button>
              )}
            </div>
          )}
          {renaming && (
            <Field className="mb-4 gap-1.5">
              <FieldLabel htmlFor={`${provider.name}-account-label`}>
                Account label
              </FieldLabel>
              <Input
                id={`${provider.name}-account-label`}
                form={`${provider.name}-credentials`}
                placeholder="e.g. Personal or Company"
                value={label}
                disabled={busy}
                maxLength={100}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
          )}
          {loading && !error && (
            <p role="status" className="mb-3 text-sm text-muted-foreground">
              Loading credentials…
            </p>
          )}
          <form
            id={`${provider.name}-credentials`}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {/* Where the credentials come from, with real links to the pages
              (opened in the system browser via the window-open handler). */}
            <div className="mb-4 flex flex-col gap-2">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {help.summary}
              </p>
              {help.links.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {help.links.map((link) => (
                    <HelpLink key={link.url} link={link} />
                  ))}
                </div>
              )}
            </div>

            <CredentialFields
              provider={provider}
              idPrefix={provider.name}
              values={values}
              disabled={busy}
              onChange={(name, value) =>
                setValues((current) => ({ ...current, [name]: value }))
              }
              hideFields={
                proxySuppliesIp ? new Set(['clientIp']) : undefined
              }
            />

            {provider.name === 'namecheap' && (
              <div className="mt-5 border-t pt-4">
                <div className="flex items-center gap-3">
                  <Switch
                    id={`${provider.name}-proxy-enabled`}
                    checked={proxyEnabled}
                    onCheckedChange={setProxyEnabled}
                    disabled={busy}
                  />
                  <FieldLabel htmlFor={`${provider.name}-proxy-enabled`}>
                    Use fixed IP proxy
                  </FieldLabel>
                </div>
                {proxyEnabled && (
                  <FieldGroup className="mt-4 gap-4">
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor={`${provider.name}-proxy-url`}>
                        Proxy URL
                      </FieldLabel>
                      <FieldDescription>
                        HTTP CONNECT proxy with a public IPv4 endpoint. Include
                        username and password if required.
                      </FieldDescription>
                      <Input
                        id={`${provider.name}-proxy-url`}
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono"
                        placeholder="http://user:password@proxy-ip:port"
                        value={values.proxyUrl ?? ''}
                        disabled={busy}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, proxyUrl: e.target.value }))
                        }
                      />
                    </Field>
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor={`${provider.name}-proxy-ip`}>
                        Outgoing IPv4 address
                      </FieldLabel>
                      <FieldDescription>
                        Allowlist this address in Namecheap API settings. It may
                        differ from the proxy endpoint.
                      </FieldDescription>
                      <Input
                        id={`${provider.name}-proxy-ip`}
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono"
                        placeholder="Your proxy’s outgoing IPv4"
                        value={values.proxyIp ?? ''}
                        disabled={busy}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, proxyIp: e.target.value }))
                        }
                      />
                    </Field>
                    {isWeb() && (
                      <p className="text-sm text-muted-foreground">
                        Workers proxy connections use an experimental TLS client.
                        Review the{' '}
                        <a
                          className="underline"
                          href="https://github.com/latentharbor/tunnelfetch#readme"
                          target="_blank"
                          rel="noreferrer"
                        >
                          transport’s security limitations
                        </a>{' '}
                        before enabling it.
                      </p>
                    )}
                  </FieldGroup>
                )}
              </div>
            )}

            <div className="mt-4 flex items-center gap-3">
              <Button
                type="submit"
                disabled={
                  busy ||
                  missingRequired ||
                  (draft && !hasCredentials) ||
                  (renaming && !label.trim())
                }
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
              {renaming ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setRenaming(false);
                    setLabel(currentLabel);
                  }}
                >
                  Cancel
                </Button>
              ) : (
                canAddAccount && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy || adding}
                    ref={addButton}
                    aria-expanded={adding}
                    aria-controls={`${provider.name}-new-account`}
                    onClick={() => {
                      setAdding(true);
                      setAddedNotice(null);
                      setRemoving(false);
                    }}
                  >
                    Add another account
                  </Button>
                )
              )}
              {multiple && !renaming && (
                <Button
                  type="button"
                  variant="ghost"
                  className="ml-auto text-muted-foreground"
                  disabled={busy}
                  onClick={() => setRemoving(true)}
                >
                  Remove account
                </Button>
              )}
              {configured && !syncing && sync.lastError && (
                <span className="ml-auto flex items-center gap-1.5 text-sm text-destructive">
                  <CircleX className="size-4" />
                  {sync.lastError}
                </span>
              )}
            </div>
            {error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
          {removing && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
              <span>
                Remove “{currentLabel}” from Dombot? Its domains stay at the
                registrar.
              </span>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                Remove
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setRemoving(false)}
              >
                Cancel
              </Button>
            </div>
          )}
          {adding && (
            <NewRegistrarAccountForm
              provider={provider}
              onAdded={added}
              onCancel={() => {
                setAdding(false);
                requestAnimationFrame(() => addButton.current?.focus());
              }}
            />
          )}
          {addedNotice && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
              <p role="status">{addedNotice.message}</p>
              <Button
                variant="ghost"
                size="sm"
                disabled={!accounts.some((a) => idOf(a) === addedNotice.id)}
                onClick={() => {
                  setSelectedId(addedNotice.id);
                  setAddedNotice(null);
                }}
              >
                View account
              </Button>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function CredentialFields({
  provider,
  idPrefix,
  values,
  disabled,
  onChange,
  hideFields,
}: {
  provider: RegistrarDefinition;
  idPrefix: string;
  values: CredentialValues;
  disabled: boolean;
  onChange: (name: string, value: string) => void;
  hideFields?: ReadonlySet<string>;
}) {
  const help = REGISTRAR_HELP[provider.name];
  return (
    <FieldGroup className="gap-4">
      {provider.configFields.map((field) => {
        if (hideFields?.has(field.name)) return null;
        const id = `${idPrefix}-${field.name}`;
        const fieldHelp = help.fields[field.name];
        return (
          <Field key={field.name} className="gap-1.5">
            <FieldLabel htmlFor={id}>
              {field.label}
              {field.required && <span className="text-destructive"> *</span>}
            </FieldLabel>
            {/* Only fields that need disambiguating carry a description;
                      it sits under the label, ahead of the input. */}
            {fieldHelp && (
              <FieldDescription className="text-[13px]">
                {fieldHelp}
              </FieldDescription>
            )}
            {field.type === 'select' ? (
              <Select
                disabled={disabled}
                value={values[field.name] ?? ''}
                onValueChange={(value) => onChange(field.name, value)}
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {field.options?.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={id}
                value={values[field.name] ?? ''}
                type={field.type === 'password' ? 'password' : 'text'}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                onChange={(e) => onChange(field.name, e.target.value)}
              />
            )}
          </Field>
        );
      })}
    </FieldGroup>
  );
}

/** A separate sibling form: opening, typing, failing or cancelling it cannot
 * change the selected account's credentials, label, enabled state or sync UI. */
function NewRegistrarAccountForm({
  provider,
  onAdded,
  onCancel,
}: {
  provider: RegistrarDefinition;
  onAdded: (account: RegistrarAccount) => void;
  onCancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Reveal the appended heading, not a replacement view or the entire form.
    heading.current?.scrollIntoView({ block: 'nearest' });
    heading.current?.focus({ preventScroll: true });
  }, []);
  const [values, setValues] = useState<CredentialValues>({});
  const [label, setLabel] = useState('');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // With the Namecheap proxy on, its outgoing IP supplies the required ClientIp,
  // so the direct field isn't needed; the proxy URL/IP are required instead.
  const proxySuppliesIp = provider.name === 'namecheap' && proxyEnabled;
  const ready =
    Object.values(values).some((value) => value.trim()) &&
    provider.configFields.every(
      (field) =>
        !field.required ||
        values[field.name]?.trim() ||
        (proxySuppliesIp && field.name === 'clientIp'),
    ) &&
    (!proxyEnabled ||
      Boolean(values.proxyUrl?.trim() && values.proxyIp?.trim()));
  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const credentials =
        provider.name === 'namecheap'
          ? namecheapCredentials(values, proxyEnabled)
          : values;
      const account = await window.api.connectRegistrarAccount(
        provider.name,
        credentials,
        label.trim() || undefined,
      );
      onAdded(account);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };
  return (
    <section
      id={`${provider.name}-new-account`}
      aria-labelledby={`${provider.name}-new-heading`}
      className="mt-5 border-t pt-5"
    >
      <h4
        ref={heading}
        tabIndex={-1}
        id={`${provider.name}-new-heading`}
        className="mb-4 scroll-mb-24 text-sm font-medium outline-none"
      >
        Add another {provider.displayName} account
      </h4>
      <form
        aria-label={`New ${provider.displayName} account`}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <CredentialFields
          provider={provider}
          idPrefix={`${provider.name}-new`}
          values={values}
          disabled={saving}
          onChange={(name, value) =>
            setValues((current) => ({ ...current, [name]: value }))
          }
          hideFields={proxySuppliesIp ? new Set(['clientIp']) : undefined}
        />
        {provider.name === 'namecheap' && (
          <div className="border-t pt-4">
            <div className="flex items-center gap-3">
              <Switch
                id={`${provider.name}-new-proxy-enabled`}
                checked={proxyEnabled}
                onCheckedChange={setProxyEnabled}
                disabled={saving}
              />
              <FieldLabel htmlFor={`${provider.name}-new-proxy-enabled`}>
                Use fixed IP proxy
              </FieldLabel>
            </div>
            {proxyEnabled && (
              <FieldGroup className="mt-4 gap-4">
                <Field className="gap-1.5">
                  <FieldLabel htmlFor={`${provider.name}-new-proxy-url`}>
                    Proxy URL
                  </FieldLabel>
                  <FieldDescription>
                    HTTP CONNECT proxy with a public IPv4 endpoint. Include
                    username and password if required.
                  </FieldDescription>
                  <Input
                    id={`${provider.name}-new-proxy-url`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    placeholder="http://user:password@proxy-ip:port"
                    value={values.proxyUrl ?? ''}
                    disabled={saving}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, proxyUrl: e.target.value }))
                    }
                  />
                </Field>
                <Field className="gap-1.5">
                  <FieldLabel htmlFor={`${provider.name}-new-proxy-ip`}>
                    Outgoing IPv4 address
                  </FieldLabel>
                  <FieldDescription>
                    Allowlist this address in Namecheap API settings. It may
                    differ from the proxy endpoint.
                  </FieldDescription>
                  <Input
                    id={`${provider.name}-new-proxy-ip`}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    placeholder="Your proxy’s outgoing IPv4"
                    value={values.proxyIp ?? ''}
                    disabled={saving}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, proxyIp: e.target.value }))
                    }
                  />
                </Field>
                {isWeb() && (
                  <p className="text-sm text-muted-foreground">
                    Workers proxy connections use an experimental TLS client.
                    Review the{' '}
                    <a
                      className="underline"
                      href="https://github.com/latentharbor/tunnelfetch#readme"
                      target="_blank"
                      rel="noreferrer"
                    >
                      transport’s security limitations
                    </a>{' '}
                    before enabling it.
                  </p>
                )}
              </FieldGroup>
            )}
          </div>
        )}
        <Field className="gap-1.5">
          <FieldLabel htmlFor={`${provider.name}-new-label`}>
            Account label{' '}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </FieldLabel>
          <Input
            id={`${provider.name}-new-label`}
            value={label}
            disabled={saving}
            maxLength={100}
            placeholder="e.g. Personal or Company"
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!ready || saving}>
            {saving ? 'Adding…' : 'Add account'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * A real external link in the help copy. `target="_blank"` hands the URL to the
 * main process's window-open handler, which opens it in the system browser and
 * denies the in-app window.
 */
function HelpLink({ link }: { link: HelpLinkData }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
    >
      {link.label}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

// Brand SVGs live with the marketing site (site/src/assets/logos); share that
// one folder so adding a registrar is just dropping in `<name>.svg` — the glob
// picks it up here, no import to edit. Keyed by filename, which matches the
// RegistrarName (e.g. godaddy.svg → "godaddy").
const LOGO_RAW = import.meta.glob('../../../../site/src/assets/logos/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(LOGO_RAW).map(([path, svg]) => [
    path
      .split('/')
      .pop()!
      .replace(/\.svg$/, ''),
    svg,
  ]),
);

/**
 * Strip the brand fills so the logo renders as a flat monochrome mark that
 * inherits `currentColor` — letting a `text-*` class tint it a uniform grey.
 * Drops width/height too so the size comes from CSS.
 */
function monochrome(svg: string): string {
  return (
    svg
      // Drop the XML prolog and comments some exports carry (e.g. dynadot).
      .replace(/<\?xml[\s\S]*?\?>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      // Drop <style> blocks (e.g. dynadot colors its paths via a `.st0` class).
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/\s(?:width|height|fill)="[^"]*"/g, '')
      // Neutralize any inline `fill:#…` left in style attributes.
      .replace(/fill:\s*#[0-9a-fA-F]{3,8}/g, 'fill:currentColor')
      .replace('<svg', '<svg fill="currentColor"')
      .trim()
  );
}

/**
 * The registrar's logo, shown as a small grey mark before the name. Reuses the
 * marketing site's brand SVGs, flattened to `currentColor` for a uniform tint.
 */
function RegistrarLogo({
  name,
  label,
}: {
  name: RegistrarName;
  label: string;
}) {
  const svg = LOGOS[name];
  if (!svg) return null;
  return (
    <span
      role="img"
      aria-label={`${label} logo`}
      className="inline-flex size-[27px] shrink-0 items-center justify-center text-muted-foreground/70 [&>svg]:size-full"
      dangerouslySetInnerHTML={{ __html: monochrome(svg) }}
    />
  );
}

/**
 * The registrar's sync state, shown in the card header:
 *  - not configured → "Not set" badge
 *  - configured but disabled → "Disabled" badge
 *  - configured + last sync ok → green "Last synced <ago> · N domains"
 *  - configured + last sync errored → amber "Sync failed" (error in tooltip)
 *  - configured + never synced → amber "Not synced yet"
 *  - a sync in flight → muted "Syncing…"
 */
function SyncStatus({
  meta,
  syncing,
  showCount = true,
}: {
  meta: RegistrarMeta;
  syncing: boolean;
  showCount?: boolean;
}) {
  if (syncing) {
    return <span className="text-sm text-muted-foreground">Syncing…</span>;
  }
  if (!meta.configured) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Not set
      </Badge>
    );
  }
  if (!meta.enabled) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Disabled
      </Badge>
    );
  }

  const { lastSyncedAt, lastError, domainCount } = meta.sync;
  if (lastError) {
    return (
      <span className="flex items-center gap-1.5" title={lastError}>
        <span className="size-2 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
        <span className="text-[13px] font-medium text-amber-600 dark:text-amber-400">
          Sync failed
        </span>
      </span>
    );
  }
  if (lastSyncedAt == null) {
    // Configured but never synced — pending, not a problem, so keep it neutral
    // (amber is reserved for actual sync failures).
    return (
      <span className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
        <span className="text-[13px] font-medium text-muted-foreground">
          Not synced yet
        </span>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="size-2 shrink-0 rounded-full bg-[#31613b] dark:bg-[#7ac28d]" />
      <span className="whitespace-nowrap text-[13px] font-medium text-[#31613b] dark:text-[#7ac28d]">
        Last synced {timeAgo(lastSyncedAt)}
      </span>
      {showCount && (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          · {domainCount} domain{domainCount === 1 ? '' : 's'}
        </span>
      )}
    </span>
  );
}
