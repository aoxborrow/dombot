import { accountCards } from '../../lib/registrar-accounts';
import {
  accountSuffix,
  accountTitle,
  isAutoLabel,
} from '../../../shared/account-label';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleX,
  Copy,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  CredentialValues,
  ProxySettings,
  RegistrarAccount,
  RegistrarDefinition,
  RegistrarMeta,
} from '../../../shared/ipc';
import {
  REGISTRAR_HELP,
  type HelpLink as HelpLinkData,
} from '../../../shared/registrar-help';
import { cn } from '@/lib/utils';
import { RegistrarLogo } from '../../components/RegistrarLogo';
import { useAppStore } from '../../store/app';
import { Link } from 'react-router-dom';
import { isDemo } from '../../lib/platform';
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
  // The one configured proxy (Settings → Proxy), if any; accounts only opt in.
  const [proxy, setProxy] = useState<ProxySettings['proxy']>(null);

  // Shared store metadata is the source of truth (so the status bar and Domains
  // agree); load it once and let store actions (save/sync) keep it fresh.
  useEffect(() => {
    void Promise.all([
      loadRegistrars(),
      window.api.getRegistrarCatalog(),
      window.api.getProxySettings(),
    ])
      .then(([, definitions, proxySettings]) => {
        setCatalog(definitions);
        setProxy(proxySettings.proxy);
      })
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
            disabled={draft !== null || isDemo()}
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
            proxy={proxy}
            onAdded={(account) => added(draft.provider, account)}
            onCancel={() => setDraft(null)}
          />
        )}
        {cards.map(({ provider, account, hasSiblings }) => (
          <AccountCard
            key={idOf(account)}
            provider={provider}
            account={account}
            hasSiblings={hasSiblings}
            proxy={proxy}
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
            isDemo()
              ? 'Adding accounts is turned off in the demo'
              : disabled
                ? 'Finish or cancel the new account first'
                : undefined
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
  hasSiblings,
  proxy,
  firstSync,
}: {
  provider: RegistrarDefinition;
  account: RegistrarMeta;
  /** The registrar has other accounts, so an unnamed one shows its number. */
  hasSiblings: boolean;
  proxy: ProxySettings['proxy'];
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
  // Inline nickname edit in the title bar; null = not editing.
  const [nickname, setNickname] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingHere, setSyncing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const usesProxy = Boolean(account.proxy);
  const [proxyEnabled, setProxyEnabled] = useState(usesProxy);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncing = syncingHere || firstSync;

  useEffect(() => {
    if (!open) return;
    let current = true;
    setError(null);
    setLoading(true);
    window.api
      .getRegistrarCredentials(provider.name, id)
      .then((creds) => {
        if (!current) return;
        setValues(creds);
        setOriginal(creds);
        setProxyEnabled(usesProxy);
        setLoading(false);
      })
      .catch((err) => {
        if (current) setError(errorMessage(err));
      });
    return () => {
      current = false;
    };
  }, [open, id, provider.name, usesProxy]);

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
      const clean = Object.fromEntries(
        Object.entries(values)
          .map(([k, v]) => [k, v.trim()])
          .filter(([, v]) => v),
      ) as CredentialValues;
      // Switching the route counts as a change: the account is re-synced over
      // the connection it will use from now on.
      const changed =
        proxyEnabled !== usesProxy ||
        Object.keys({ ...original, ...clean }).some(
          (k) => original[k] !== clean[k],
        );
      if (changed)
        await window.api.saveRegistrarCredentials(
          provider.name,
          clean,
          id,
          proxyEnabled,
        );
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

  // Saves on its own, apart from the credentials form. Blank removes the
  // nickname, and the account goes back to its number.
  const saveNickname = async () => {
    if (nickname === null || renaming) return;
    const next = nickname.trim();
    const current = isAutoLabel(currentLabel) ? '' : currentLabel;
    if (next === current) {
      setNicknameError(null);
      return setNickname(null);
    }
    setRenaming(true);
    setNicknameError(null);
    try {
      await window.api.renameRegistrarAccount(id, next);
      await loadRegistrars();
      await refreshCache();
      setNickname(null);
    } catch (err) {
      // Keep the field open with what was typed so it can be corrected.
      setNicknameError(errorMessage(err));
    } finally {
      setRenaming(false);
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
  // The demo shows the form (with its stub credentials) but takes no edits.
  const locked = busy || isDemo();
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
  const title = accountTitle(provider.displayName, currentLabel, hasSiblings);
  const suffix = accountSuffix(currentLabel, hasSiblings);
  const hasNickname = !isAutoLabel(currentLabel);

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
              disabled={locked || !configured}
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
          <CollapsibleTrigger
            className={cn(
              'flex min-w-0 flex-wrap items-center gap-x-[18px] gap-y-1 text-left',
              !open && 'flex-1',
            )}
          >
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
              {suffix && nickname === null && (
                <span className="-ml-1 flex min-w-0 items-center gap-1.5 font-normal text-muted-foreground">
                  {/* The bullet is its own item so the gap is equal on both
                      sides, whatever the font's space width. */}
                  {suffix.startsWith(' · ') && <span aria-hidden>·</span>}
                  <span className="truncate">
                    {suffix.replace(/^ (· )?/, '')}
                  </span>
                </span>
              )}
            </span>
            {!open && (
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <SyncStatus meta={account} syncing={syncing} />
              </span>
            )}
          </CollapsibleTrigger>
          {/* Expanded: the nickname is edited right in the title bar. The input
              can't sit inside the trigger (a button), so the status gets its own
              trigger after it and the row still expands/collapses on click. */}
          {open &&
            (nickname === null ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-ml-2.5 size-6 shrink-0 text-muted-foreground/60 hover:text-foreground"
                disabled={locked}
                aria-label={
                  hasNickname ? `Rename ${title}` : `Add a nickname to ${title}`
                }
                title={hasNickname ? 'Rename' : 'Add a nickname'}
                onClick={() => setNickname(hasNickname ? currentLabel : '')}
              >
                <Pencil className="size-3" />
              </Button>
            ) : (
              <Input
                autoFocus
                value={nickname}
                disabled={renaming}
                maxLength={100}
                autoComplete="off"
                placeholder="Add a nickname"
                aria-label={`Nickname for ${title}`}
                className="-ml-1 h-8 w-44 shrink"
                aria-invalid={nicknameError ? true : undefined}
                onChange={(e) => {
                  setNickname(e.target.value);
                  setNicknameError(null);
                }}
                onBlur={() => void saveNickname()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void saveNickname();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setNicknameError(null);
                    setNickname(null);
                  }
                }}
              />
            ))}
          {open && nickname !== null && nicknameError && (
            <span
              role="alert"
              className="min-w-0 flex-1 text-sm text-destructive"
            >
              {nicknameError}
            </span>
          )}
          {open && !(nickname !== null && nicknameError) && (
            <CollapsibleTrigger
              tabIndex={-1}
              aria-hidden
              className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-left"
            >
              <SyncStatus meta={account} syncing={syncing} />
            </CollapsibleTrigger>
          )}
          {/* Sync only makes sense for an enabled account. */}
          {configured && enabled && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runSync()}
              disabled={busy}
              title="Sync this account's domains"
              // Absorb the button's height into the row's vertical padding so
              // the row stays slim rather than growing to fit it.
              className="-my-1 shrink-0 border-border text-muted-foreground hover:text-foreground"
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
              <CredentialFields
                provider={provider}
                idPrefix={id}
                values={values}
                disabled={locked}
                onChange={(name, value) =>
                  setValues((current) => ({ ...current, [name]: value }))
                }
                hideFields={proxySuppliesIp ? new Set(['clientIp']) : undefined}
              />
            </FieldGroup>

            <ProxyToggle
              id={`${id}-proxy`}
              provider={provider}
              proxy={proxy}
              enabled={proxyEnabled}
              disabled={locked}
              onChange={setProxyEnabled}
            />

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                disabled={locked || missingRequired || !hasCredentials}
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
                variant="outline"
                className="ml-auto border-border text-muted-foreground"
                disabled={locked}
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
                Remove {title} from DomBot? Its domains stay at{' '}
                {provider.displayName}.
              </span>
              <Button
                variant="destructive"
                disabled={locked}
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
  proxy,
  onAdded,
  onCancel,
}: {
  provider: RegistrarDefinition;
  proxy: ProxySettings['proxy'];
  onAdded: (account: RegistrarAccount) => void;
  onCancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.scrollIntoView({ block: 'nearest' });
    heading.current?.focus({ preventScroll: true });
  }, []);
  const [values, setValues] = useState<CredentialValues>({});
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optional, edited inline in the title bar like on a saved card. It only
  // lives here until the account is saved.
  const [nickname, setNickname] = useState('');
  const [editingNickname, setEditingNickname] = useState(false);
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
    );

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const account = await window.api.connectRegistrarAccount(
        provider.name,
        values,
        // Without a nickname the account takes the next number.
        nickname.trim() || undefined,
        proxyEnabled,
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
        {editingNickname ? (
          <Input
            autoFocus
            value={nickname}
            disabled={saving}
            maxLength={100}
            autoComplete="off"
            placeholder="Add a nickname"
            aria-label={`Nickname for the new ${provider.displayName} account`}
            className="h-8 w-44 shrink"
            onChange={(e) => setNickname(e.target.value)}
            onBlur={() => setEditingNickname(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                if (e.key === 'Escape') setNickname('');
                setEditingNickname(false);
              }
            }}
          />
        ) : (
          <>
            {nickname.trim() && (
              <span className="-ml-1 flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span aria-hidden>·</span>
                <span className="truncate">{nickname.trim()}</span>
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-ml-1.5 size-6 shrink-0 text-muted-foreground/60 hover:text-foreground"
              disabled={saving}
              aria-label={
                nickname.trim() ? 'Change nickname' : 'Add a nickname'
              }
              title={nickname.trim() ? 'Change nickname' : 'Add a nickname'}
              onClick={() => setEditingNickname(true)}
            >
              <Pencil className="size-3" />
            </Button>
          </>
        )}
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
        <ProxyToggle
          id={`${idPrefix}-proxy`}
          provider={provider}
          proxy={proxy}
          enabled={proxyEnabled}
          disabled={saving}
          onChange={setProxyEnabled}
        />
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

/** Routes one account through the proxy set up on the Proxy tab. The
 * proxy itself is never edited here; an account only opts in or out. */
function ProxyToggle({
  id,
  provider,
  proxy,
  enabled,
  disabled,
  onChange,
}: {
  id: string;
  provider: RegistrarDefinition;
  proxy: ProxySettings['proxy'];
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const proxyLink = (
    <Link to="/settings?tab=proxy" className="underline underline-offset-4">
      configured proxy
    </Link>
  );

  const copyEgressIp = async () => {
    if (!proxy) return;
    try {
      await navigator.clipboard.writeText(proxy.egressIp);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable: the address is still selectable by hand.
    }
  };

  return (
    <div className="mt-5 border-t pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Switch
          id={id}
          checked={enabled}
          onCheckedChange={onChange}
          // Always allow switching it off; switching it on needs a proxy.
          disabled={disabled || (!proxy && !enabled)}
        />
        <FieldLabel htmlFor={id}>Use fixed IP proxy</FieldLabel>
        {proxy && enabled && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded border border-border/60 bg-muted/30 py-0.5 pr-0.5 pl-2">
            <input
              readOnly
              value={proxy.egressIp}
              size={Math.max(proxy.egressIp.length, 7)}
              aria-label="Outgoing IP address"
              onFocus={(e) => e.currentTarget.select()}
              className="bg-transparent font-mono text-xs text-foreground outline-none"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void copyEgressIp()}
              aria-label="Copy outgoing IP address"
              className={cn(
                'size-5 shrink-0 text-muted-foreground hover:text-foreground',
                copied && 'text-[#7ac28d] hover:text-[#7ac28d]',
              )}
            >
              {copied ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
            </Button>
          </div>
        )}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        {!proxy ? (
          <>
            Set up a{' '}
            <Link
              to="/settings?tab=proxy"
              className="underline underline-offset-4"
            >
              proxy
            </Link>{' '}
            to use this.
          </>
        ) : enabled ? (
          <>
            This account&apos;s requests go through your proxy, so{' '}
            {provider.displayName} sees them arrive from a fixed address.
            Whitelist this IP address in the {provider.displayName} API settings.
          </>
        ) : (
          <>Send this account&apos;s requests through your {proxyLink}.</>
        )}
      </p>
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

/**
 * The registrar's sync state, shown in the card header:
 *  - not configured → "Needs credentials" badge
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
        Needs credentials
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
