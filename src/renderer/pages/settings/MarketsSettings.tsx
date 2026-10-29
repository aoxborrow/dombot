import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  CircleX,
  Ellipsis,
  ExternalLink,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { MarketAccountView, MarketInfo } from '../../../shared/markets';
import { cn } from '@/lib/utils';
import { useAppStore } from '../../store/app';
import { MarketLogo } from '../../components/RegistrarLogo';
import { timeAgo } from '../../lib/time';
import {
  DEFAULT_LEASE_MONTHS,
  leaseCommissionDiscount,
  leaseMonthOptions,
  useLeaseDefaults,
  type LeaseDefaults,
} from '../../lib/lease-to-own';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Card } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { ConfirmDialog } from '../../components/ConfirmDialog';

// Settings → Markets (docs/markets.md): one card per connected marketplace
// account, built like the registrar cards. Everything a card shows comes from
// the market's catalog entry, so a new market needs no code here.

type Values = Record<string, string>;

/** The message alone, without Electron's IPC prefix or the error's class. */
const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^\w*Error:\s*/, '');
const count = (n: number, noun: string) =>
  `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;

/** Until when a card's expand toggle is ignored (see RegistrarsSettings). */
let ignoreToggleUntil = 0;

export default function MarketsSettings() {
  const accounts = useAppStore((s) => s.marketAccounts);
  const loadMarkets = useAppStore((s) => s.loadMarkets);
  const [catalog, setCatalog] = useState<MarketInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    market: MarketInfo;
    key: number;
  } | null>(null);

  useEffect(() => {
    void Promise.all([loadMarkets(), window.api.getMarketCatalog()])
      .then(([, markets]) => setCatalog(markets))
      .catch((err) => setLoadError(errorMessage(err)));
  }, [loadMarkets]);

  const loaded = accounts !== null && catalog.length > 0;
  const infoFor = (account: MarketAccountView) =>
    catalog.find((m) => m.id === account.market);
  const startDraft = (market: MarketInfo) =>
    setDraft({ market, key: Date.now() });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold">Markets</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect the marketplaces where you list domains for sale. DomBot syncs
          each account&apos;s listings, sales and traffic with your registrars.
          Keys are encrypted at rest and used by the app and the MCP server.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {loaded && (
          <div className="flex justify-end">
            <AddMarketMenu
              catalog={catalog}
              disabled={draft !== null}
              onPick={startDraft}
            />
          </div>
        )}
        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        )}
        {draft && (
          <DraftMarketCard
            key={draft.key}
            market={draft.market}
            onDone={() => setDraft(null)}
          />
        )}
        {accounts?.map((account) => {
          const market = infoFor(account);
          return market ? (
            <MarketCard key={account.id} market={market} account={account} />
          ) : null;
        })}
        {loaded && accounts.length === 0 && !draft && <EmptyMarkets />}
      </div>
    </div>
  );
}

function AddMarketMenu({
  catalog,
  disabled,
  onPick,
}: {
  catalog: MarketInfo[];
  disabled: boolean;
  onPick: (market: MarketInfo) => void;
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
          Add market account
          <ChevronDown className="opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {catalog.map((market) => (
          <DropdownMenuItem key={market.id} onSelect={() => onPick(market)}>
            <MarketLogo
              market={market.id}
              label={market.name}
              className="size-4 p-[1.5px]"
            />
            {market.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyMarkets() {
  return (
    <Empty className="rounded-md border border-dashed">
      <EmptyHeader>
        <EmptyTitle>No market accounts yet</EmptyTitle>
        <EmptyDescription>
          Add one to see which names are listed, at what prices, what sold, and
          how much traffic they get.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Where to get keys, and the market's own note about them. */
function MarketHelp({ market }: { market: MarketInfo }) {
  return (
    <p className="mb-4 text-sm text-muted-foreground">
      {market.helpText}{' '}
      <a
        href={market.keysUrl}
        className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
        onClick={(e) => {
          e.preventDefault();
          void window.api.openExternal(market.keysUrl);
        }}
      >
        Open {market.website}
        <ExternalLink className="size-3.5" />
      </a>
    </p>
  );
}

function CredentialFields({
  market,
  idPrefix,
  values,
  disabled,
  onChange,
}: {
  market: MarketInfo;
  idPrefix: string;
  values: Values;
  disabled: boolean;
  onChange: (name: string, value: string) => void;
}) {
  return (
    <>
      {market.configFields.map((field) => {
        const id = `${idPrefix}-${field.name}`;
        const props = {
          id,
          value: values[field.name] ?? '',
          disabled,
          autoComplete: 'off',
          spellCheck: false,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            onChange(field.name, e.target.value),
        };
        return (
          <Field key={field.name}>
            <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
            {field.type === 'password' ? (
              <PasswordInput {...props} revealLabel={`Show ${field.label}`} />
            ) : (
              <Input {...props} />
            )}
          </Field>
        );
      })}
    </>
  );
}

const filled = (market: MarketInfo, values: Values) =>
  market.configFields.every((f) => !f.required || values[f.name]?.trim());

/** A new account: nothing is saved until its key passes a test. */
function DraftMarketCard({
  market,
  onDone,
}: {
  market: MarketInfo;
  onDone: () => void;
}) {
  const setMarketAccounts = useAppStore((s) => s.setMarketAccounts);
  const [values, setValues] = useState<Values>({});
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setSaving(true);
    setError(null);
    try {
      const accounts = await window.api.connectMarketAccount(
        market.id,
        values,
        label.trim() || undefined,
      );
      await setMarketAccounts(accounts);
      const added = accounts.at(-1);
      if (added?.sync?.lastError) {
        toast.error(`${market.name} account added, but sync failed`, {
          description: added.sync.lastError,
        });
      } else if (added?.sync) {
        toast.success(
          `${market.name} account added · ${count(added.sync.listings, 'listing')}, ${count(added.sync.sales, 'sale')}`,
        );
      }
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Card className="gap-0 rounded-md px-5 py-4">
      <div className="mb-3 flex items-center gap-2.5 font-medium">
        <MarketLogo
          market={market.id}
          label={market.name}
          className="size-[22px] text-muted-foreground/70"
        />
        New {market.name} account
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <MarketHelp market={market} />
        <FieldGroup className="gap-4">
          <CredentialFields
            market={market}
            idPrefix="new-market"
            values={values}
            disabled={saving}
            onChange={(name, value) =>
              setValues((current) => ({ ...current, [name]: value }))
            }
          />
          <Field>
            <FieldLabel htmlFor="new-market-label">
              Account name (optional)
            </FieldLabel>
            <Input
              id="new-market-label"
              value={label}
              maxLength={100}
              disabled={saving}
              placeholder={market.name}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
        </FieldGroup>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving || !filled(market, values)}>
            {saving ? 'Connecting…' : 'Connect'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={onDone}
          >
            Cancel
          </Button>
          {saving && (
            <span className="text-sm text-muted-foreground">
              Checking the key and reading listings and sales…
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </Card>
  );
}

function SyncLine({
  account,
  syncing,
}: {
  account: MarketAccountView;
  syncing: boolean;
}) {
  const { sync } = account;
  let text: string;
  if (syncing) text = 'Syncing…';
  else if (!account.enabled) text = 'Disabled';
  else if (!sync) text = 'Not synced yet';
  else
    text = [
      count(sync.listings, 'listing'),
      count(sync.sales, 'sale'),
      // `at` is the last attempt, so a failed one says so.
      sync.lastError
        ? `sync failed ${timeAgo(sync.at)}`
        : `synced ${timeAgo(sync.at)}`,
    ].join(' · ');
  return (
    <span className="truncate text-sm text-muted-foreground">
      {text}
      {sync?.incomplete && !syncing && (
        <span title="The portfolio changed while it was being read; the next sync completes it.">
          {' '}
          · partial
        </span>
      )}
    </span>
  );
}

function MarketCard({
  market,
  account,
}: {
  market: MarketInfo;
  account: MarketAccountView;
}) {
  const setMarketAccounts = useAppStore((s) => s.setMarketAccounts);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [original, setOriginal] = useState<Values>({});
  const [busy, setBusy] = useState<
    'sync' | 'save' | 'toggle' | 'remove' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const dialogFromMenu = useRef<'rename' | 'remove' | null>(null);
  const menuOpen = useRef(false);
  // The account's own lease-to-own defaults, read from the market when the
  // card opens (Afternic's account settings).
  const lease = useLeaseDefaults(
    open &&
      market.capabilities.accountSettings &&
      market.capabilities.leaseToOwn &&
      account.enabled &&
      account.configured
      ? account.id
      : null,
  );

  useEffect(() => {
    if (!open) return;
    let current = true;
    window.api
      .getMarketCredentials(account.id)
      .then((creds) => {
        if (!current) return;
        setValues(creds);
        setOriginal(creds);
      })
      .catch((err) => current && setError(errorMessage(err)));
    return () => {
      current = false;
    };
  }, [open, account.id]);

  const run = async (
    kind: NonNullable<typeof busy>,
    action: () => Promise<MarketAccountView[]>,
  ) => {
    setBusy(kind);
    setError(null);
    try {
      await setMarketAccounts(await action());
      return true;
    } catch (err) {
      setError(errorMessage(err));
      setOpen(true);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const changed = Object.keys({ ...original, ...values }).some(
    (k) => (original[k] ?? '') !== (values[k]?.trim() ?? ''),
  );
  const syncFailed =
    account.enabled && busy !== 'sync' && account.sync?.lastError != null;
  const title = account.label;

  return (
    <Card className="@container gap-0 overflow-hidden rounded-md py-0">
      <Collapsible
        open={open}
        onOpenChange={(next) => {
          if (Date.now() < ignoreToggleUntil) return;
          setOpen(next);
        }}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-[13px] pr-5 pl-[15px] @min-[600px]:flex-nowrap">
          <CollapsibleTrigger className="flex min-w-0 items-center gap-2.5 text-left">
            <span
              className={cn(
                'flex min-w-0 items-center gap-2.5 font-medium',
                !account.enabled && 'opacity-50',
              )}
            >
              <MarketLogo
                market={market.id}
                label={market.name}
                className="size-[22px] text-muted-foreground/70"
              />
              <span className="truncate">{market.name}</span>
              {title !== market.name && (
                <span className="flex min-w-0 items-center gap-1.5 font-normal text-muted-foreground">
                  <span aria-hidden>·</span>
                  <span className="truncate">{title}</span>
                </span>
              )}
            </span>
          </CollapsibleTrigger>
          <CollapsibleTrigger
            tabIndex={-1}
            aria-hidden
            className="order-last flex min-w-0 basis-full pl-[32px] text-left @min-[600px]:order-none @min-[600px]:grow @min-[600px]:basis-0 @min-[600px]:pl-0"
          >
            <SyncLine account={account} syncing={busy === 'sync'} />
          </CollapsibleTrigger>

          <DropdownMenu
            onOpenChange={(next) => {
              menuOpen.current = next;
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-my-1 ml-auto size-8 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={`Actions for ${market.name} ${title}`}
                title="Account actions"
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-48"
              onPointerDownOutside={() => {
                if (menuOpen.current) ignoreToggleUntil = Date.now() + 500;
              }}
              onCloseAutoFocus={(e) => {
                const dialog = dialogFromMenu.current;
                if (!dialog) return;
                dialogFromMenu.current = null;
                e.preventDefault();
                if (dialog === 'rename') setRenaming(account.label);
                else setRemoving(true);
              }}
            >
              {account.enabled && (
                <DropdownMenuItem
                  disabled={busy !== null}
                  onSelect={() =>
                    void run('sync', () =>
                      window.api.syncMarketAccount(account.id),
                    )
                  }
                >
                  <RefreshCw />
                  Sync now
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={busy !== null}
                onSelect={() => {
                  dialogFromMenu.current = 'rename';
                }}
              >
                <Pencil />
                Edit account name…
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy !== null}
                onSelect={() =>
                  void run('toggle', () =>
                    window.api.setMarketAccountEnabled(
                      account.id,
                      !account.enabled,
                    ),
                  )
                }
              >
                <Power />
                {account.enabled ? 'Disable account' : 'Enable account'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={busy !== null}
                onSelect={() => {
                  dialogFromMenu.current = 'remove';
                }}
              >
                <Trash2 />
                Remove account…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

        {syncFailed && (
          <div
            role="alert"
            className="mx-5 mt-0.5 mb-[18px] flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          >
            <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span className="min-w-0 break-words">
              {account.sync?.lastError}
            </span>
          </div>
        )}

        <CollapsibleContent className="flex flex-col gap-6 border-t px-5 py-4">
          {/* What the market itself holds, read through its API (and, for
              settings, saved back there), in a box of its own apart from
              what DomBot keeps. */}
          {(account.sync?.status?.length ||
            (lease && lease.enabled !== null)) && (
            <MarketAccountSettings
              // Remounts once the settings arrive, after the flags.
              key={`${account.id}:${lease ? 'loaded' : 'loading'}`}
              accountId={account.id}
              marketName={market.name}
              flags={account.sync?.status ?? []}
              lease={lease && lease.enabled !== null ? lease : null}
            />
          )}
          <div className="flex flex-col gap-3">
            {account.sync?.notes.map((note) => (
              <p key={note} className="text-sm text-muted-foreground">
                {note}
              </p>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run('save', () =>
                  window.api.saveMarketCredentials(account.id, values),
                ).then((ok) => {
                  if (ok) setOriginal(values);
                  // The key is tested before it's saved, so a refused one
                  // changes nothing: say so.
                  else
                    setError(
                      (e) =>
                        `${e} Nothing was saved; the account keeps its key.`,
                    );
                });
              }}
            >
              <MarketHelp market={market} />
              <FieldGroup className="gap-4">
                <CredentialFields
                  market={market}
                  idPrefix={account.id}
                  values={values}
                  disabled={busy !== null}
                  onChange={(name, value) =>
                    setValues((current) => ({ ...current, [name]: value }))
                  }
                />
              </FieldGroup>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  // After a refused save, Save stays on even with the saved
                  // values back in the fields, so it can always be retried.
                  disabled={
                    busy !== null ||
                    !(changed || error) ||
                    !filled(market, values)
                  }
                >
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </Button>
              </div>
              {error && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {error}
                </p>
              )}
            </form>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {removing && (
        <ConfirmDialog
          title={`Remove ${market.name} · ${title}?`}
          description={`DomBot forgets this account's key and synced listings. Your listings stay on ${market.name}, and sales DomBot recorded stay in your history.`}
          actionLabel="Remove account"
          busyLabel="Removing…"
          busy={busy === 'remove'}
          destructive
          onConfirm={() =>
            void run('remove', () =>
              window.api.removeMarketAccount(account.id),
            ).then((ok) => ok && setRemoving(false))
          }
          onClose={() => setRemoving(false)}
        >
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </ConfirmDialog>
      )}
      {renaming !== null && (
        <ConfirmDialog
          title="Edit account name"
          description={`Name this account to tell your ${market.name} accounts apart. Leave it blank to use "${market.name}".`}
          actionLabel="Save"
          busy={busy !== null}
          onConfirm={() =>
            void run('save', () =>
              window.api.renameMarketAccount(account.id, renaming),
            ).then((ok) => ok && setRenaming(null))
          }
          onClose={() => setRenaming(null)}
        >
          <Field>
            <FieldLabel htmlFor={`${account.id}-label`}>
              Account name
            </FieldLabel>
            <Input
              id={`${account.id}-label`}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              value={renaming}
              maxLength={100}
              autoComplete="off"
              onChange={(e) => setRenaming(e.target.value)}
            />
          </Field>
        </ConfirmDialog>
      )}
    </Card>
  );
}

/** One setting: its name on the left, its value or control on the right. */
function SettingRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2 text-sm">
      <span>{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * What the market account itself holds, read through its API: what the
 * account has (read-only, e.g. Discount Domain Club Domain Pro), and its
 * settings (Afternic's lease-to-own defaults), saved back to the market
 * together with one Save. Lease-to-own applies to listings created on the
 * market itself; DomBot sends lease-to-own with every listing it creates.
 */
function MarketAccountSettings({
  accountId,
  marketName,
  flags,
  lease,
}: {
  accountId: string;
  marketName: string;
  flags: { label: string; on: boolean }[];
  lease: LeaseDefaults | null;
}) {
  const [saved, setSaved] = useState(lease);
  const [enabled, setEnabled] = useState(lease?.enabled ?? false);
  const [months, setMonths] = useState(lease?.months ?? DEFAULT_LEASE_MONTHS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    !!saved &&
    (enabled !== saved.enabled || (enabled && months !== saved.months));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.api.setMarketListingDefaults(
        accountId,
        enabled
          ? { leasingEnabled: true, maxLeasePeriod: months }
          : { leasingEnabled: false },
      );
      setSaved({ enabled, months: enabled ? months : (saved?.months ?? null) });
      toast.success(`Saved your ${marketName} account settings.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border">
      <div className="flex items-start justify-between gap-3 rounded-t-md bg-muted/40 px-3 py-2">
        <div>
          <h3 className="text-sm font-medium">{marketName} account settings</h3>
          <p className="text-xs text-muted-foreground">
            Read from your {marketName} account
            {lease ? `; saving changes them on ${marketName}` : ''}.
          </p>
        </div>
        {lease && (
          <Button
            size="sm"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>
      <div className="py-1">
        {flags.map((flag) => (
          <SettingRow key={flag.label} label={flag.label}>
            <span
              className={cn(
                'flex items-center gap-2',
                !flag.on && 'text-muted-foreground',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  flag.on
                    ? 'bg-emerald-500'
                    : 'border border-muted-foreground/60',
                )}
              />
              {flag.on ? 'Yes' : 'No'}
            </span>
          </SettingRow>
        ))}
        {lease && (
          <>
            <SettingRow label="Lease-to-own for new listings">
              <Checkbox
                aria-label="Lease-to-own for new listings"
                checked={enabled}
                onCheckedChange={(on) => setEnabled(on === true)}
              />
            </SettingRow>
            <SettingRow label="Most monthly payments">
              <Select
                value={String(months)}
                disabled={!enabled}
                onValueChange={(v) => setMonths(Number(v))}
              >
                <SelectTrigger
                  aria-label="Most monthly payments by default"
                  className="h-8 w-68"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {leaseMonthOptions(months).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      Up to {m} months
                      {leaseCommissionDiscount(m) > 0 && (
                        <span className="text-muted-foreground">
                          {' '}
                          · {leaseCommissionDiscount(m)}% discount
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
