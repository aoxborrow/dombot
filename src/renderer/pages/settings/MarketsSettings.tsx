import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  CircleAlert,
  Ellipsis,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  SEARCH_DATA_FLAG,
  type MarketAccountView,
  type MarketId,
  type MarketInfo,
} from '../../../shared/markets';
import {
  parseVerificationId,
  verificationHelp,
  verificationNameserver,
  verificationTxt,
} from '../../../shared/market-verification';
import { cn } from '@/lib/utils';
import { useAppStore } from '../../store/app';
import { MarketLogo } from '../../components/RegistrarLogo';
import { timeAgo } from '../../lib/time';
import { useSyncState } from '../../lib/sync-state';
import {
  leaseCommissionDiscount,
  useLeaseDefaults,
  type LeaseDefaults,
} from '../../lib/lease-to-own';
import { Button } from '@/components/ui/button';
import { EmptyState } from '../../components/EmptyState';
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
import {
  SettingsExternalLink,
  SettingsField,
  SettingsHelp,
} from './SettingsCard';

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
  const enabledCount = (accounts ?? []).filter(
    (a) => a.enabled && a.configured,
  ).length;
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
        {/* As on Registrars: Sync all on the left (it acts on the cards
            below), the page's main action on the right. */}
        {loaded && (
          <div className="flex flex-wrap items-center gap-2">
            {enabledCount > 1 && <SyncAllButton />}
            <div className="ml-auto">
              <AddMarketMenu
                catalog={catalog}
                disabled={draft !== null}
                onPick={startDraft}
              />
            </div>
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

/**
 * Syncs every enabled market account at once (Sync now on the Domains page
 * adds the registrars). Each card shows Syncing… while it runs, and a toast
 * sums up the result.
 */
function SyncAllButton() {
  const { syncMarkets, marketsSyncing, syncing, bulkRunning } = useSyncState();
  return (
    <Button
      variant="outline"
      onClick={syncMarkets}
      disabled={syncing || bulkRunning}
      title={
        bulkRunning
          ? 'A bulk action is running — sync when it finishes'
          : 'Sync every enabled market account'
      }
    >
      <RefreshCw className={cn(marketsSyncing && 'animate-spin')} />
      {marketsSyncing ? 'Syncing…' : 'Sync all'}
      {/* Room for the full label beside Add from sm up. */}
      {!marketsSyncing && (
        <span className="-ml-1 hidden sm:inline">markets</span>
      )}
    </Button>
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
    <EmptyState
      boxed
      title="No market accounts yet"
      description="Add one to see your listings, sales, and traffic."
    />
  );
}

/** Where to get keys, and the market's own note about them. */
function MarketHelp({ market }: { market: MarketInfo }) {
  return (
    <SettingsHelp
      summary={market.helpText}
      links={[{ label: `Open ${market.name}`, url: market.keysUrl }]}
    />
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
          <SettingsField
            key={field.name}
            htmlFor={id}
            label={
              <>
                {field.label}
                {field.required && <span className="text-destructive"> *</span>}
              </>
            }
          >
            {field.type === 'password' ? (
              <PasswordInput
                {...props}
                className="font-mono"
                revealLabel={`Show ${field.label}`}
              />
            ) : (
              <Input {...props} className="font-mono" />
            )}
          </SettingsField>
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
              Account Name (optional)
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
  // A Sync now or Sync all covers every enabled account.
  const syncingAll =
    useAppStore((s) => s.marketsSyncing) &&
    account.enabled &&
    account.configured;
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

  // Ownership verification, kept in DomBot. The field shows what the market
  // shows (the TXT value); null means untouched.
  const savedVerificationId = account.verificationId ?? null;
  const shownVerification = savedVerificationId
    ? verificationTxt(market.id, savedVerificationId)
    : '';
  const [verifyValue, setVerifyValue] = useState<string | null>(null);
  // The key was refused: saving again retries it, changed or not.
  const [keyRefused, setKeyRefused] = useState(false);
  const verification = verifyValue ?? shownVerification;
  const verificationChanged = verification.trim() !== shownVerification;

  const dirty = changed || verificationChanged;

  /**
   * One Save for the whole card: the key (tested first, so a refused one
   * saves nothing), then the verification ID. A verification value that
   * isn't the market's stops it before anything is saved.
   */
  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      if (verificationChanged) {
        parseVerificationId(market.id, verification, market.name);
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
      return;
    }
    let views: MarketAccountView[] | null = null;
    try {
      if (changed || keyRefused) {
        try {
          views = await window.api.saveMarketCredentials(account.id, values);
          setOriginal(values);
          setKeyRefused(false);
        } catch (err) {
          setKeyRefused(true);
          throw new Error(
            `${errorMessage(err)} Nothing was saved; the account keeps its key.`,
          );
        }
      }
      if (verificationChanged) {
        views = await window.api.setMarketVerification(
          account.id,
          verification,
        );
        setVerifyValue(null);
      }
      if (views) await setMarketAccounts(views);
      toast.success(
        `Saved ${market.name}${account.label !== market.name ? ` · ${account.label}` : ''}.`,
      );
    } catch (err) {
      setError(errorMessage(err));
      setOpen(true);
    } finally {
      setBusy(null);
    }
  };
  const syncing = busy === 'sync' || syncingAll;
  const syncFailed =
    account.enabled && !syncing && account.sync?.lastError != null;
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
            <SyncLine account={account} syncing={syncing} />
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
                  disabled={busy !== null || syncingAll}
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
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span className="min-w-0 break-words">
              {account.sync?.lastError}
            </span>
          </div>
        )}

        <CollapsibleContent className="border-t px-5 py-4">
          <form
            className="flex flex-col gap-7"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {account.sync?.notes.map((note) => (
              <p key={note} className="text-sm text-muted-foreground">
                {note}
              </p>
            ))}
            <div>
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
                <VerificationField
                  market={market}
                  idPrefix={account.id}
                  value={verification}
                  savedId={savedVerificationId}
                  disabled={busy !== null}
                  onValue={setVerifyValue}
                />
              </FieldGroup>
            </div>
            {(account.sync?.status?.length ||
              (lease && lease.enabled !== null)) && (
              <MarketAccountSummary
                market={market}
                flags={account.sync?.status ?? []}
                lease={lease && lease.enabled !== null ? lease : null}
              />
            )}
            <div className="flex flex-col gap-3">
              <div>
                <Button
                  type="submit"
                  // After a refused save, Save stays on even with the saved
                  // values back in the fields, so it can always be retried.
                  disabled={
                    busy !== null ||
                    !(dirty || error) ||
                    !filled(market, values)
                  }
                >
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </Button>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          </form>
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
              Account Name
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

/**
 * The account's Ownership Verification ID (docs/markets.md, "Ownership
 * verification"): the value the market gives the account, pasted whole and
 * read on save, for Ownership verification TXT… and Afternic's NS3 preset.
 * Labelled the same for every market; the help says where the market keeps
 * it.
 */
function VerificationField({
  market,
  idPrefix,
  value,
  savedId,
  disabled,
  onValue,
}: {
  market: MarketInfo;
  idPrefix: string;
  value: string;
  savedId: string | null;
  disabled: boolean;
  onValue: (value: string) => void;
}) {
  const help = verificationHelp(market.id);
  const ns3 = verificationNameserver(market.id, savedId);
  return (
    <SettingsField
      htmlFor={`${idPrefix}-verification`}
      label="Ownership Verification ID"
      description={
        <>
          {help.path}.{' '}
          <SettingsExternalLink url={help.url}>
            Open {market.name}
          </SettingsExternalLink>
        </>
      }
    >
      <Input
        id={`${idPrefix}-verification`}
        value={value}
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
        disabled={disabled}
        onChange={(e) => onValue(e.target.value)}
      />
      {ns3 && (
        <p className="text-xs break-all text-muted-foreground">
          NS3: <span className="font-mono">{ns3}</span>
        </p>
      )}
    </SettingsField>
  );
}

/** Where a market's own account settings are changed, when DomBot only shows them. */
const ACCOUNT_SETTINGS_URL: Partial<Record<MarketId, string>> = {
  afternic: 'https://www.afternic.com/account/lander',
};

/**
 * What the market account itself holds, read through its API and shown
 * read-only: what the account has (Discount Domain Club Domain Pro, from
 * sync), and its lease-to-own defaults (Afternic's account settings), which
 * a new listing in DomBot starts from. They're changed on the market.
 */
function MarketAccountSummary({
  market,
  flags,
  lease,
}: {
  market: MarketInfo;
  flags: { label: string; on: boolean }[];
  lease: LeaseDefaults | null;
}) {
  const settingsUrl = ACCOUNT_SETTINGS_URL[market.id];
  const months = lease?.months ?? null;
  return (
    <div className="overflow-hidden rounded-md border text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b bg-muted/40 px-3 py-2">
        <h3 className="font-medium">{market.name} Account Settings</h3>
        {settingsUrl && (
          <SettingsExternalLink url={settingsUrl} className="text-[13px]">
            Open {market.name}
          </SettingsExternalLink>
        )}
      </div>
      {/* Each setting beside its value, in two columns: the setting muted,
          its value in the text colour. */}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 px-3 py-2.5">
        {flags.map((flag) =>
          // The API doesn't say the membership level; search counts, which
          // only Domain Pro gets, say whether it's that one.
          flag.label === SEARCH_DATA_FLAG ? (
            <SummaryRow key={flag.label} label="Discount Domain Club">
              <span
                className={cn(!flag.on && 'text-muted-foreground')}
                title={`Read from whether ${market.name} sends search counts, which only Domain Pro members get; its API doesn’t say the level.`}
              >
                {flag.on ? 'Domain Pro' : 'Not Domain Pro'}
              </span>
            </SummaryRow>
          ) : (
            <SummaryRow key={flag.label} label={flag.label}>
              <span className={cn(!flag.on && 'text-muted-foreground')}>
                {flag.on ? 'Yes' : 'No'}
              </span>
            </SummaryRow>
          ),
        )}
        {lease && (
          <SummaryRow label="Lease To Own">
            <span className={cn(!lease.enabled && 'text-muted-foreground')}>
              {lease.enabled ? 'On' : 'Off'}
            </span>
          </SummaryRow>
        )}
        {lease?.enabled && months !== null && (
          <SummaryRow label="Maximum Lease Period">
            {months} months
            {leaseCommissionDiscount(months) > 0 && (
              <span className="text-muted-foreground">
                {' '}
                · {leaseCommissionDiscount(months)}% discount
              </span>
            )}
          </SummaryRow>
        )}
      </dl>
    </div>
  );
}

/** One row of the account card: the setting, then its value. */
function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
