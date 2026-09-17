import {
  accountCards,
  isAutoLabel,
  savedSiblings,
} from '../../lib/registrar-accounts';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  CircleX,
  ExternalLink,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const idOf = (account: RegistrarMeta) => account.accountId ?? account.name;
const plural = (n: number) => `${n} domain${n === 1 ? '' : 's'}`;

export default function RegistrarsSettings() {
  const registrars = useAppStore((s) => s.registrars);
  const loadRegistrars = useAppStore((s) => s.loadRegistrars);
  const syncRegistrar = useAppStore((s) => s.syncRegistrar);
  const [catalog, setCatalog] = useState<RegistrarDefinition[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The one unsaved account being added. It lives only here: nothing is
  // persisted until its connection test passes. `key` remounts the form when
  // the same registrar is picked again after a cancel.
  const [draft, setDraft] = useState<{
    provider: RegistrarDefinition;
    key: number;
  } | null>(null);
  // Accounts whose first sync this page started (a new card has no state yet).
  const [syncingIds, setSyncingIds] = useState<ReadonlySet<string>>(new Set());

  // Shared store metadata is the source of truth (so the status bar and Domains
  // agree); load it once and let store actions (save/sync) keep it fresh.
  useEffect(() => {
    void Promise.all([loadRegistrars(), window.api.getRegistrarCatalog()])
      .then(([, definitions]) => setCatalog(definitions))
      .catch((err) => setLoadError(errorMessage(err)));
  }, [loadRegistrars]);

  const sortedCatalog = useMemo(
    () =>
      catalog
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [catalog],
  );
  const cards = useMemo(
    () => accountCards(sortedCatalog, registrars ?? []),
    [sortedCatalog, registrars],
  );
  const loaded = registrars !== null && catalog.length > 0;

  const startDraft = (provider: RegistrarDefinition) =>
    setDraft({ provider, key: Date.now() });

  const added = (provider: RegistrarDefinition, account: RegistrarAccount) => {
    setDraft(null);
    const mark = (on: boolean) =>
      setSyncingIds((ids) => {
        const next = new Set(ids);
        if (on) next.add(account.id);
        else next.delete(account.id);
        return next;
      });
    mark(true);
    void (async () => {
      await loadRegistrars();
      const result = await syncRegistrar(provider.name, account.id);
      if (result.lastError)
        toast.error(`${provider.displayName} account added, but sync failed`, {
          description: result.lastError,
        });
      else
        toast.success(
          `${provider.displayName} account added · ${plural(result.domainCount)} synced`,
        );
    })()
      .catch((err) =>
        toast.error(`${provider.displayName} account added`, {
          description: `Could not refresh: ${errorMessage(err)}`,
        }),
      )
      .finally(() => mark(false));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <h2 className="text-xl font-bold">Registrars</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Store API credentials for each registrar account. They&apos;re
            encrypted at rest and used by both the app and the MCP server.
            Saving syncs that account&apos;s domains automatically.
          </p>
        </div>
        {loaded && cards.length > 0 && (
          <AddAccountMenu
            catalog={sortedCatalog}
            disabled={draft !== null}
            onPick={startDraft}
          />
        )}
      </div>

      <div className="flex flex-col gap-3">
        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        )}
        {draft && (
          <DraftAccountCard
            key={draft.key}
            provider={draft.provider}
            siblings={savedSiblings(registrars ?? [], draft.provider.name)}
            onAdded={(account) => added(draft.provider, account)}
            onCancel={() => setDraft(null)}
          />
        )}
        {cards.map(({ provider, account, showLabel }) => (
          <AccountCard
            key={idOf(account)}
            provider={provider}
            account={account}
            showLabel={showLabel}
            firstSync={syncingIds.has(idOf(account))}
          />
        ))}
        {loaded && cards.length === 0 && !draft && (
          <EmptyRegistrars catalog={sortedCatalog} onPick={startDraft} />
        )}
      </div>
    </div>
  );
}

/** The single way to add an account, for a registrar's first and its fifth. */
function AddAccountMenu({
  catalog,
  disabled,
  onPick,
}: {
  catalog: RegistrarDefinition[];
  disabled: boolean;
  onPick: (provider: RegistrarDefinition) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          disabled={disabled}
          title={
            disabled ? 'Finish or cancel the new account first' : undefined
          }
        >
          <Plus />
          Add registrar account
          <ChevronDown className="opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {catalog.map((provider) => (
          <DropdownMenuItem
            key={provider.name}
            onSelect={() => onPick(provider)}
          >
            <RegistrarLogo
              name={provider.name}
              label={provider.displayName}
              className="size-5"
            />
            {provider.displayName}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Nothing connected yet: show what's supported, each one click from a form. */
function EmptyRegistrars({
  catalog,
  onPick,
}: {
  catalog: RegistrarDefinition[];
  onPick: (provider: RegistrarDefinition) => void;
}) {
  return (
    <Card className="gap-4 rounded-md px-5 py-5">
      <div>
        <h3 className="font-medium">Connect your first registrar</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose where your domains are registered. You can add more accounts,
          including several at the same registrar, at any time.
        </p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
        {catalog.map((provider) => (
          <Button
            key={provider.name}
            variant="outline"
            className="h-auto justify-start gap-2.5 px-3 py-2.5"
            onClick={() => onPick(provider)}
          >
            <RegistrarLogo name={provider.name} label={provider.displayName} />
            {provider.displayName}
          </Button>
        ))}
      </div>
    </Card>
  );
}

/** One saved account: its identity, status, credentials and controls. */
function AccountCard({
  provider,
  account,
  showLabel,
  firstSync,
}: {
  provider: RegistrarDefinition;
  account: RegistrarMeta;
  showLabel: boolean;
  firstSync: boolean;
}) {
  const syncRegistrar = useAppStore((s) => s.syncRegistrar);
  const setRegistrarEnabled = useAppStore((s) => s.setRegistrarEnabled);
  const loadRegistrars = useAppStore((s) => s.loadRegistrars);
  const refreshCache = useAppStore((s) => s.applyPortfolioCacheUpdate);
  const id = idOf(account);
  const currentLabel = account.accountLabel ?? '';
  const [values, setValues] = useState<CredentialValues>({});
  const [original, setOriginal] = useState<CredentialValues>({});
  const [label, setLabel] = useState(currentLabel);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingHere, setSyncing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Namecheap fixed-IP proxy: on for an account whose stored creds carry one.
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncing = syncingHere || firstSync;

  useEffect(() => {
    if (!open) return;
    let current = true;
    setError(null);
    setLoading(true);
    setLabel(currentLabel);
    window.api
      .getRegistrarCredentials(provider.name, id)
      .then((creds) => {
        if (!current) return;
        setValues(creds);
        setOriginal(creds);
        setProxyEnabled(
          Boolean(creds.proxyUrl?.trim() || creds.proxyIp?.trim()),
        );
        setLoading(false);
      })
      .catch((err) => {
        if (current) setError(errorMessage(err));
      });
    return () => {
      current = false;
    };
  }, [open, id, currentLabel, provider.name]);

  const runSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncRegistrar(provider.name, id);
    } catch (err) {
      setError(errorMessage(err));
      setOpen(true);
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
      const changed = Object.keys({ ...original, ...clean }).some(
        (k) => original[k] !== clean[k],
      );
      // A blank nickname keeps the current one: every account carries a name,
      // it just isn't shown until the registrar has a second account.
      const nextLabel = label.trim();
      if (nextLabel && nextLabel !== currentLabel)
        await window.api.renameRegistrarAccount(id, nextLabel);
      else setLabel(currentLabel);
      if (changed)
        await window.api.saveRegistrarCredentials(provider.name, clean, id);
      setOriginal(clean);
      setValues(clean);
      if (changed) await syncRegistrar(provider.name, id);
      else {
        await loadRegistrars();
        await refreshCache();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (next: boolean) => {
    setToggling(true);
    setError(null);
    try {
      await setRegistrarEnabled(provider.name, next, id);
    } catch (err) {
      setError(errorMessage(err));
      setOpen(true);
    } finally {
      setToggling(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError(null);
    try {
      await window.api.removeRegistrarAccount(id);
      await loadRegistrars();
      await refreshCache();
    } catch (err) {
      // On success the card unmounts; only a failure leaves state to reset.
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const busy = saving || syncing || toggling || loading;
  const { configured, enabled, sync } = account;
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
  const renamed = Boolean(label.trim()) && label.trim() !== currentLabel;
  const title = showLabel
    ? `${provider.displayName} · ${currentLabel}`
    : provider.displayName;

  return (
    <Card className="gap-0 overflow-hidden rounded-md py-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        {/* Header row: the name + sync status expand the card; the Sync button
            sits outside the triggers so it works even while collapsed. */}
        <div className="flex items-center gap-3 px-5 py-[13px]">
          {/* Enable/disable toggle, kept to the far left and outside the expand
              triggers so it reads as a row-level on/off (not a sync switch) and
              isn't hit when expanding the card. */}
          <div className="flex shrink-0 items-center">
            <Switch
              checked={configured && enabled}
              onCheckedChange={(v) => void toggleEnabled(v)}
              disabled={busy || !configured}
              aria-label={
                configured
                  ? `${enabled ? 'Disable' : 'Enable'} ${title}`
                  : `${title}: add credentials to enable`
              }
              title={
                !configured
                  ? 'Add credentials to enable this account'
                  : enabled
                    ? 'Disable this account (keeps credentials and cached data)'
                    : 'Enable and sync this account'
              }
            />
          </div>
          <CollapsibleTrigger className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[18px] gap-y-1 text-left">
            <span
              className={cn(
                'flex min-w-0 items-center gap-2.5 font-medium',
                // Dim the name for a configured-but-disabled account so the
                // off state reads at a glance.
                configured && !enabled && 'opacity-50',
              )}
            >
              <RegistrarLogo
                name={provider.name}
                label={provider.displayName}
              />
              <span className="whitespace-nowrap">{provider.displayName}</span>
              {showLabel && (
                <span className="truncate font-normal text-muted-foreground">
                  · {currentLabel}
                </span>
              )}
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <SyncStatus meta={account} syncing={syncing} />
            </span>
          </CollapsibleTrigger>
          {/* Sync only makes sense for an enabled account. */}
          {configured && enabled && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void runSync()}
              disabled={busy}
              title="Sync this account's domains"
              // Absorb the button's height into the row's vertical padding so
              // the row stays slim rather than growing to fit it.
              className="-my-1 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn(syncing && 'animate-spin')} />
              {syncing ? 'Syncing…' : 'Sync'}
            </Button>
          )}
          <CollapsibleTrigger
            className="shrink-0"
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
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
          {loading && !error && (
            <p role="status" className="mb-3 text-sm text-muted-foreground">
              Loading credentials…
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <RegistrarHelp provider={provider} />
            <FieldGroup className="gap-4">
              <NicknameField
                id={`${id}-label`}
                value={label}
                disabled={busy}
                onChange={setLabel}
                description={
                  showLabel
                    ? undefined
                    : `Shown once you have more than one ${provider.displayName} account.`
                }
              />
              <CredentialFields
                provider={provider}
                idPrefix={id}
                values={values}
                disabled={busy}
                onChange={(name, value) =>
                  setValues((current) => ({ ...current, [name]: value }))
                }
                hideFields={proxySuppliesIp ? new Set(['clientIp']) : undefined}
              />
            </FieldGroup>

            {provider.name === 'namecheap' && (
              <NamecheapProxyFields
                idPrefix={id}
                className="mt-5"
                enabled={proxyEnabled}
                onEnabledChange={setProxyEnabled}
                values={values}
                disabled={busy}
                onChange={(name, value) =>
                  setValues((current) => ({ ...current, [name]: value }))
                }
              />
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                disabled={
                  busy || missingRequired || (!hasCredentials && !renamed)
                }
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
              {configured && !syncing && sync.lastError && (
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-destructive">
                  <CircleX className="size-4 shrink-0" />
                  {sync.lastError}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                className="ml-auto text-muted-foreground"
                disabled={busy}
                onClick={() => setRemoving(true)}
              >
                Remove account
              </Button>
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
                Remove {showLabel ? `“${currentLabel}”` : 'this account'} from
                DomBot? Its domains stay at {provider.displayName}.
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
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/** An account being added. It is its own card and shares no state with a saved
 * one, so opening, typing, failing or cancelling it can't disturb them. Nothing
 * is persisted until the connection test passes. */
function DraftAccountCard({
  provider,
  siblings,
  onAdded,
  onCancel,
}: {
  provider: RegistrarDefinition;
  siblings: RegistrarMeta[];
  onAdded: (account: RegistrarAccount) => void;
  onCancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.scrollIntoView({ block: 'nearest' });
    heading.current?.focus({ preventScroll: true });
  }, []);
  // A second account must be tellable from the first. If the only existing
  // account still carries a name DomBot made up, ask for a real one now.
  const needsNickname = siblings.length > 0;
  const unnamed =
    siblings.length === 1 && isAutoLabel(siblings[0].accountLabel)
      ? siblings[0]
      : null;
  const [values, setValues] = useState<CredentialValues>({});
  const [label, setLabel] = useState('');
  const [siblingLabel, setSiblingLabel] = useState('');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // With the Namecheap proxy on, its outgoing IP supplies the required ClientIp,
  // so the direct field isn't needed; the proxy URL/IP are required instead.
  const proxySuppliesIp = provider.name === 'namecheap' && proxyEnabled;
  const same = (a: string, b: string) =>
    a.trim().toLowerCase() === b.trim().toLowerCase();
  const taken = siblings.some(
    (s) => s !== unnamed && same(s.accountLabel ?? '', label),
  );
  const nicknameError = !label.trim()
    ? null
    : taken
      ? 'Another account already uses that nickname.'
      : unnamed && siblingLabel.trim() && same(siblingLabel, label)
        ? 'Give the two accounts different nicknames.'
        : null;
  const ready =
    Object.values(values).some((value) => value.trim()) &&
    provider.configFields.every(
      (field) =>
        !field.required ||
        values[field.name]?.trim() ||
        (proxySuppliesIp && field.name === 'clientIp'),
    ) &&
    (!proxyEnabled ||
      Boolean(values.proxyUrl?.trim() && values.proxyIp?.trim())) &&
    (!needsNickname || Boolean(label.trim())) &&
    (!unnamed || Boolean(siblingLabel.trim())) &&
    !nicknameError;

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const credentials =
        provider.name === 'namecheap'
          ? namecheapCredentials(values, proxyEnabled)
          : values;
      // Name the existing account first so the new nickname can't collide with
      // the made-up one it is replacing.
      if (unnamed && !same(siblingLabel, unnamed.accountLabel ?? ''))
        await window.api.renameRegistrarAccount(
          idOf(unnamed),
          siblingLabel.trim(),
        );
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

  const idPrefix = `${provider.name}-new`;
  return (
    <Card className="gap-0 overflow-hidden rounded-md border-primary/40 py-0">
      <div className="flex items-center gap-2.5 px-5 py-[13px]">
        <RegistrarLogo name={provider.name} label={provider.displayName} />
        <h3
          ref={heading}
          tabIndex={-1}
          className="scroll-mt-24 font-medium outline-none"
        >
          New {provider.displayName} account
        </h3>
        <Badge variant="outline" className="text-muted-foreground">
          Not saved
        </Badge>
      </div>
      <form
        aria-label={`New ${provider.displayName} account`}
        className="border-t px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <RegistrarHelp provider={provider} />
        <FieldGroup className="gap-4">
          {needsNickname && (
            <p className="text-sm text-muted-foreground">
              You already have{' '}
              {siblings.length === 1
                ? `a ${provider.displayName} account`
                : `${siblings.length} ${provider.displayName} accounts`}
              . Nicknames tell them apart in Domains, Renewals and exports.
            </p>
          )}
          {unnamed && (
            <NicknameField
              id={`${idPrefix}-sibling-label`}
              label="Nickname for your existing account"
              required
              value={siblingLabel}
              disabled={saving}
              onChange={setSiblingLabel}
              description={`Currently “${unnamed.accountLabel ?? 'Default'}”, with ${plural(unnamed.sync.domainCount)}.`}
            />
          )}
          <NicknameField
            id={`${idPrefix}-label`}
            label={needsNickname ? 'Nickname for this account' : 'Nickname'}
            required={needsNickname}
            value={label}
            disabled={saving}
            onChange={setLabel}
            error={nicknameError}
            description={
              needsNickname
                ? undefined
                : `Optional. Shown once you have more than one ${provider.displayName} account.`
            }
          />
          <CredentialFields
            provider={provider}
            idPrefix={idPrefix}
            values={values}
            disabled={saving}
            onChange={(name, value) =>
              setValues((current) => ({ ...current, [name]: value }))
            }
            hideFields={proxySuppliesIp ? new Set(['clientIp']) : undefined}
          />
        </FieldGroup>
        {provider.name === 'namecheap' && (
          <NamecheapProxyFields
            idPrefix={idPrefix}
            className="mt-5"
            enabled={proxyEnabled}
            onEnabledChange={setProxyEnabled}
            values={values}
            disabled={saving}
            onChange={(name, value) =>
              setValues((current) => ({ ...current, [name]: value }))
            }
          />
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5 flex items-center gap-3">
          <Button type="submit" disabled={!ready || saving}>
            {saving ? 'Testing connection…' : 'Add account'}
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
    </Card>
  );
}

/** Where the credentials come from, with real links to the pages (opened in
 * the system browser via the window-open handler). */
function RegistrarHelp({ provider }: { provider: RegistrarDefinition }) {
  const help = REGISTRAR_HELP[provider.name];
  return (
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
  );
}

function NicknameField({
  id,
  label = 'Nickname',
  value,
  disabled,
  required = false,
  description,
  error,
  onChange,
}: {
  id: string;
  label?: string;
  value: string;
  disabled: boolean;
  required?: boolean;
  description?: string;
  error?: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </FieldLabel>
      {description && (
        <FieldDescription className="text-[13px]">
          {description}
        </FieldDescription>
      )}
      <Input
        id={id}
        value={value}
        disabled={disabled}
        maxLength={100}
        autoComplete="off"
        placeholder="e.g. Personal or Company"
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Field>
  );
}

/** Namecheap's fixed-IP proxy switch and its two fields, shared by the saved
 * and draft forms. */
function NamecheapProxyFields({
  idPrefix,
  className,
  enabled,
  onEnabledChange,
  values,
  disabled,
  onChange,
}: {
  idPrefix: string;
  className?: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  values: CredentialValues;
  disabled: boolean;
  onChange: (name: 'proxyUrl' | 'proxyIp', value: string) => void;
}) {
  return (
    <div className={cn('border-t pt-4', className)}>
      <div className="flex items-center gap-3">
        <Switch
          id={`${idPrefix}-proxy-enabled`}
          checked={enabled}
          onCheckedChange={onEnabledChange}
          disabled={disabled}
        />
        <FieldLabel htmlFor={`${idPrefix}-proxy-enabled`}>
          Use fixed IP proxy
        </FieldLabel>
      </div>
      {enabled && (
        <FieldGroup className="mt-4 gap-4">
          <Field className="gap-1.5">
            <FieldLabel htmlFor={`${idPrefix}-proxy-url`}>Proxy URL</FieldLabel>
            <FieldDescription>
              HTTP or HTTPS CONNECT proxy, by hostname or public IPv4 address.
              Prefer HTTPS when the proxy needs a username and password; an HTTP
              proxy receives them unencrypted.
            </FieldDescription>
            <Input
              id={`${idPrefix}-proxy-url`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              placeholder="https://user:password@proxy.example.com:8080"
              value={values.proxyUrl ?? ''}
              disabled={disabled}
              onChange={(e) => onChange('proxyUrl', e.target.value)}
            />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor={`${idPrefix}-proxy-ip`}>
              Outgoing IPv4 address
            </FieldLabel>
            <FieldDescription>
              Allowlist this address in Namecheap API settings. It may differ
              from the proxy endpoint.
            </FieldDescription>
            <Input
              id={`${idPrefix}-proxy-ip`}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              placeholder="Your proxy’s outgoing IPv4"
              value={values.proxyIp ?? ''}
              disabled={disabled}
              onChange={(e) => onChange('proxyIp', e.target.value)}
            />
          </Field>
          {isWeb() && (
            <p className="text-sm text-muted-foreground">
              Workers proxy connections use an experimental TLS client. Review
              the{' '}
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
    <>
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
    </>
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
  className,
}: {
  name: RegistrarName;
  label: string;
  className?: string;
}) {
  const svg = LOGOS[name];
  if (!svg) return null;
  return (
    <span
      role="img"
      aria-label={`${label} logo`}
      className={cn(
        'inline-flex size-[27px] shrink-0 items-center justify-center text-muted-foreground/70 [&>svg]:size-full',
        className,
      )}
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
