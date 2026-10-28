import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  CircleX,
  Ellipsis,
  ExternalLink,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Store,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { MarketAccountView, MarketInfo } from '../../../shared/markets';
import { cn } from '@/lib/utils';
import { useAppStore } from '../../store/app';
import { timeAgo } from '../../lib/time';
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

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
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
            <Store />
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
        <Store className="size-[22px]" />
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
              <Store className="size-[22px] shrink-0" />
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

        <CollapsibleContent className="border-t px-5 py-4">
          {account.sync?.notes.map((note) => (
            <p key={note} className="mb-3 text-sm text-muted-foreground">
              {note}
            </p>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run('save', () =>
                window.api.saveMarketCredentials(account.id, values),
              ).then((ok) => ok && setOriginal(values));
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
                disabled={busy !== null || !changed || !filled(market, values)}
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
