import { toast } from 'sonner';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Ellipsis, ExternalLink, Plus, RefreshCw } from 'lucide-react';
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
import { timeAgo } from '../../lib/time';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const accountId = (a: RegistrarMeta) => a.accountId ?? a.name;
const accountLabel = (a: RegistrarMeta) => a.accountLabel ?? 'Default';
const domainCount = (count: number) =>
  `${count} domain${count === 1 ? '' : 's'}`;
const messageOf = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export default function RegistrarsSettings() {
  const registrars = useAppStore((s) => s.registrars);
  const loadRegistrars = useAppStore((s) => s.loadRegistrars);
  const syncRegistrar = useAppStore((s) => s.syncRegistrar);
  const setEnabled = useAppStore((s) => s.setRegistrarEnabled);
  const refreshCache = useAppStore((s) => s.applyPortfolioCacheUpdate);
  const [catalog, setCatalog] = useState<RegistrarDefinition[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ account?: RegistrarMeta } | null>(
    null,
  );
  const [removing, setRemoving] = useState<RegistrarMeta | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const connectButton = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [definitions] = await Promise.all([
        window.api.getRegistrarCatalog(),
        loadRegistrars(),
      ]);
      setCatalog(
        definitions.sort((a, b) => a.displayName.localeCompare(b.displayName)),
      );
    } catch (err) {
      setLoadError(messageOf(err));
    }
  }, [loadRegistrars]);
  useEffect(() => {
    void load();
  }, [load]);

  // Migration placeholders remain an API compatibility detail, never empty UI accounts.
  const accounts = (registrars ?? []).filter((a) => a.saved ?? a.configured);
  const groups = catalog
    .map((provider) => ({
      provider,
      accounts: accounts.filter((a) => a.name === provider.name),
    }))
    .filter((g) => g.accounts.length);
  const defaultProvider = groups.length === 1 ? groups[0].provider.name : '';

  const run = async (
    id: string,
    status: string,
    action: () => Promise<void>,
  ) => {
    setBusy((current) => ({ ...current, [id]: status }));
    try {
      await action();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };
  const sync = (a: RegistrarAccount) =>
    run(a.id, 'Syncing domains…', async () => {
      const result = await syncRegistrar(a.registrar, a.id);
      if (result.lastError) toast.error(`${a.label}: ${result.lastError}`);
      else
        toast.success(`${a.label}: ${domainCount(result.domainCount)} synced`);
    });
  const saved = async (a: RegistrarAccount, shouldSync: boolean) => {
    setEditor(null);
    await loadRegistrars();
    if (shouldSync) await sync(a);
    else await refreshCache();
  };
  const remove = async () => {
    if (!removing) return;
    const id = accountId(removing);
    setRemoveError(null);
    setBusy((current) => ({ ...current, [id]: 'Removing…' }));
    try {
      await window.api.removeRegistrarAccount(id);
      await loadRegistrars();
      await refreshCache();
      setRemoving(null);
    } catch (err) {
      setRemoveError(messageOf(err));
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Registrar accounts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            All your accounts, one portfolio.
          </p>
        </div>
        <Button
          ref={connectButton}
          disabled={!catalog.length}
          onClick={() => setEditor({})}
        >
          <Plus />
          Connect account
        </Button>
      </div>
      {loadError ? (
        <div role="alert" className="text-sm text-destructive">
          {loadError}{' '}
          <Button variant="ghost" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : !registrars || !catalog.length ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading accounts…
        </p>
      ) : !accounts.length ? (
        <div className="py-12 text-center">
          <h3 className="font-medium">Connect your first account</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose a registrar and enter its API credentials to bring your
            domains here.
          </p>
        </div>
      ) : (
        groups.map(({ provider, accounts: rows }) => (
          <section key={provider.name} aria-label={provider.displayName}>
            <h3 className="mb-2 flex items-center gap-2.5 font-medium">
              <RegistrarLogo
                name={provider.name}
                label={provider.displayName}
              />
              {provider.displayName}
            </h3>
            <div className="divide-y border-y">
              {rows.map((a) => {
                const id = accountId(a);
                const label = accountLabel(a);
                const working = busy[id];
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-4 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{label}</p>
                      <p
                        role="status"
                        className={cn(
                          'mt-1 text-xs',
                          a.sync.lastError && a.enabled
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                        )}
                      >
                        {working ||
                          (!a.configured
                            ? 'Setup incomplete'
                            : !a.enabled
                              ? 'Paused'
                              : a.sync.lastError
                                ? 'Sync failed'
                                : a.sync.lastSyncedAt == null
                                  ? 'Not synced yet'
                                  : `${domainCount(a.sync.domainCount)} · Synced ${timeAgo(a.sync.lastSyncedAt)}`)}
                      </p>
                      {!working && a.enabled && a.sync.lastError && (
                        <p className="mt-1 max-w-prose break-words text-xs text-destructive">
                          {a.sync.lastError}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {a.configured && a.enabled && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!!working}
                          aria-label={`Sync ${label}`}
                          onClick={() =>
                            void sync({ id, registrar: a.name, label })
                          }
                        >
                          <RefreshCw
                            className={cn(
                              working === 'Syncing domains…' && 'animate-spin',
                            )}
                          />
                          <span className="hidden sm:inline">Sync</span>
                        </Button>
                      )}
                      {!a.configured && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditor({ account: a })}
                        >
                          Finish setup
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={!!working}
                            aria-label={`Manage ${label}`}
                          >
                            <Ellipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => setEditor({ account: a })}
                          >
                            Edit account
                          </DropdownMenuItem>
                          {a.configured && a.enabled && (
                            <DropdownMenuItem
                              onSelect={() =>
                                void run(
                                  id,
                                  'Testing connection…',
                                  async () => {
                                    const result =
                                      await window.api.testRegistrarAccount(
                                        a.name,
                                        id,
                                      );
                                    if (!result.success)
                                      throw new Error(
                                        result.message || 'Connection failed',
                                      );
                                    toast.success(
                                      `${label}: connection successful`,
                                    );
                                  },
                                )
                              }
                            >
                              Test connection
                            </DropdownMenuItem>
                          )}
                          {a.configured && (
                            <DropdownMenuItem
                              onSelect={() =>
                                void run(
                                  id,
                                  a.enabled ? 'Pausing…' : 'Syncing domains…',
                                  () => setEnabled(a.name, !a.enabled, id),
                                )
                              }
                            >
                              {a.enabled ? 'Pause syncing' : 'Resume syncing'}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onSelect={() => {
                              setRemoveError(null);
                              setRemoving(a);
                            }}
                          >
                            Remove account…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
      <p className="text-xs text-muted-foreground">
        API credentials are encrypted on this device or server.
      </p>
      {editor && (
        <AccountEditor
          catalog={catalog}
          account={editor.account}
          defaultProvider={defaultProvider}
          onClose={() => setEditor(null)}
          onSaved={saved}
          onClosed={() => connectButton.current?.focus()}
        />
      )}
      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open && removing && !busy[accountId(removing)])
            setRemoving(null);
        }}
      >
        <DialogContent
          showCloseButton={!removing || !busy[accountId(removing)]}
        >
          <DialogHeader>
            <DialogTitle>
              Remove {removing && accountLabel(removing)}?
            </DialogTitle>
            <DialogDescription>
              Its saved credentials and cached domains will be removed from
              Dombot. Your domains stay at the registrar.
            </DialogDescription>
          </DialogHeader>
          {removeError && (
            <p role="alert" className="text-sm text-destructive">
              {removeError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!removing && !!busy[accountId(removing)]}
              onClick={() => setRemoving(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!!removing && !!busy[accountId(removing)]}
              onClick={() => void remove()}
            >
              Remove account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountEditor({
  catalog,
  account,
  defaultProvider,
  onClose,
  onSaved,
  onClosed,
}: {
  catalog: RegistrarDefinition[];
  account?: RegistrarMeta;
  defaultProvider: RegistrarName | '';
  onClose: () => void;
  onSaved: (account: RegistrarAccount, sync: boolean) => Promise<void>;
  onClosed: () => void;
}) {
  const [providerId, setProviderId] = useState<RegistrarName | ''>(
    account?.name ?? defaultProvider,
  );
  const [label, setLabel] = useState(account?.accountLabel ?? '');
  const [values, setValues] = useState<CredentialValues>({});
  const [original, setOriginal] = useState<CredentialValues>({});
  const [loading, setLoading] = useState(!!account);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = catalog.find((p) => p.name === providerId);
  useEffect(() => {
    if (!account) return;
    let current = true;
    window.api
      .getRegistrarCredentials(account.name, accountId(account))
      .then((credentials) => {
        if (current) {
          setValues(credentials);
          setOriginal(credentials);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (current) setError(messageOf(err));
      });
    return () => {
      current = false;
    };
  }, [account]);
  const ready =
    !!provider &&
    !loading &&
    provider.configFields.every(
      (f) => !f.required || !!values[f.name]?.trim(),
    ) &&
    Object.values(values).some((v) => !!v.trim());
  const submit = async () => {
    if (!provider || !ready || busy) return;
    setBusy(true);
    setError(null);
    let saved: RegistrarAccount;
    let changed = true;
    try {
      const clean = Object.fromEntries(
        Object.entries(values)
          .map(([k, v]) => [k, v.trim()])
          .filter(([, v]) => v),
      );
      if (account) {
        changed = Object.keys({ ...original, ...clean }).some(
          (k) => original[k] !== clean[k],
        );
        if (changed)
          await window.api.saveRegistrarCredentials(
            account.name,
            clean,
            accountId(account),
          );
        const name = label.trim() || accountLabel(account);
        if (name !== accountLabel(account))
          await window.api.renameRegistrarAccount(accountId(account), name);
        saved = {
          id: accountId(account),
          registrar: account.name,
          label: name,
        };
      } else {
        saved = await window.api.connectRegistrarAccount(
          provider.name,
          clean,
          label.trim() || undefined,
        );
      }
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
      return;
    }
    // The account is already saved: close the form before sync so a transport
    // error cannot invite a second Connect submission and create a duplicate.
    onClose();
    try {
      await onSaved(saved, changed && (!account || account.enabled));
    } catch (err) {
      toast.error(`Account saved. ${messageOf(err)}`);
    }
  };
  const help = provider && REGISTRAR_HELP[provider.name];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto"
        showCloseButton={!busy}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onClosed();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {account ? `Edit ${accountLabel(account)}` : 'Connect account'}
          </DialogTitle>
          <DialogDescription>
            {account
              ? `${provider?.displayName} account details.`
              : 'Enter your registrar credentials. We’ll check the connection and sync your domains.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {!account && (
            <Field className="gap-1.5">
              <FieldLabel htmlFor="account-registrar">Registrar</FieldLabel>
              <Select
                value={providerId}
                disabled={busy}
                onValueChange={(value) => {
                  setProviderId(value as RegistrarName);
                  setValues({});
                  setError(null);
                }}
              >
                <SelectTrigger id="account-registrar" className="w-full">
                  <SelectValue placeholder="Choose registrar" />
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((r) => (
                    <SelectItem key={r.name} value={r.name}>
                      {r.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {provider && (
            <>
              {help && (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>{help.summary}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {help.links.map((link) => (
                      <HelpLink key={link.url} link={link} />
                    ))}
                  </div>
                </div>
              )}
              {loading && !error && (
                <p role="status" className="text-sm text-muted-foreground">
                  Loading saved credentials…
                </p>
              )}
              {provider.configFields.map((field) => {
                const id = `account-credential-${field.name}`;
                return (
                  <Field
                    key={`${provider.name}-${field.name}`}
                    className="gap-1.5"
                  >
                    <FieldLabel htmlFor={id}>
                      {field.label}
                      {field.required && (
                        <span aria-hidden className="text-destructive">
                          {' '}
                          *
                        </span>
                      )}
                    </FieldLabel>
                    {help?.fields[field.name] && (
                      <FieldDescription id={`${id}-help`}>
                        {help.fields[field.name]}
                      </FieldDescription>
                    )}
                    {field.type === 'select' ? (
                      <Select
                        value={values[field.name] ?? ''}
                        disabled={busy || loading}
                        onValueChange={(value) =>
                          setValues((old) => ({ ...old, [field.name]: value }))
                        }
                      >
                        <SelectTrigger id={id} className="w-full">
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          {field.options?.map((value) => (
                            <SelectItem key={value} value={value}>
                              {value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={id}
                        type={field.type === 'password' ? 'password' : 'text'}
                        required={field.required}
                        value={values[field.name] ?? ''}
                        disabled={busy || loading}
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby={
                          help?.fields[field.name] ? `${id}-help` : undefined
                        }
                        onChange={(e) =>
                          setValues((old) => ({
                            ...old,
                            [field.name]: e.target.value,
                          }))
                        }
                      />
                    )}
                  </Field>
                );
              })}
              <Field className="gap-1.5">
                <FieldLabel htmlFor="account-label">
                  Account label{' '}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </FieldLabel>
                <Input
                  id="account-label"
                  value={label}
                  disabled={busy}
                  maxLength={100}
                  placeholder="e.g. Personal or Company"
                  onChange={(e) => setLabel(e.target.value)}
                />
                <FieldDescription>
                  Helps you tell accounts at the same registrar apart.
                </FieldDescription>
              </Field>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {busy
                ? account
                  ? 'Saving…'
                  : 'Checking connection…'
                : account
                  ? 'Save changes'
                  : 'Connect account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
