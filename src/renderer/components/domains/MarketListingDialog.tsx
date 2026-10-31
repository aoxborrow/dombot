import { useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { toAscii } from '../../../shared/domain-name';
import type { Domain } from '../../../shared/ipc';
import type {
  MarketListing,
  MarketListingChange,
  MarketWriteResult,
} from '../../../shared/markets';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  formatMoney,
  parseLocalizedAmount,
  type NumberFormatId,
} from '../../../shared/money';
import { useAppStore } from '../../store/app';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ActionHeader } from '../actions/ActionDialog';
import { LIST_PRICE_HELP } from './ListPriceDialog';
import { MoneyInput } from './MoneyInput';
import { FIELD_LABEL } from './MarketActionDialog';
import {
  DEFAULT_LEASE_MONTHS,
  leaseCommissionDiscount,
  leaseMonthOptions,
  monthlyPayment,
  useLeaseDefaults,
} from '../../lib/lease-to-own';
import { listingChange } from './market-listing-change';

// One name's listing on one market, edited where it is: the fields are the
// ones that market has (its capabilities, docs/markets.md), and Save writes
// straight to the market. Only what you changed is sent, so the market's
// other settings stay as they are. A name not listed there yet is listed,
// starting from the asking price you set in DomBot.

const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+':\s*/,
    '',
  );

/** Listings whose checks a save re-runs, where the market can. */
const STUCK: ReadonlySet<string> = new Set(['inactive', 'rejected', 'pending']);

/** Before the catalog loads: a plain price, nothing else. */
const NO_CAPS = {
  currencies: ['USD'],
  minOffer: false,
  floor: false,
  leaseToOwn: false,
} as const;

/** An amount as the whole number typed in the inputs. */
const whole = (value: string | null | undefined) =>
  value ? String(Math.round(Number(value))) : '';

export function MarketListingDialog({
  domain,
  market,
  onClose,
}: {
  /** A name, or just its name (the Sales overview). */
  domain: Pick<Domain, 'domainName'>;
  market: string;
  onClose: () => void;
}) {
  const catalog = useAppStore((s) => s.marketCatalog);
  const accounts = useAppStore((s) => s.marketAccounts) ?? [];
  const listings = useAppStore((s) => s.marketListings);
  const listPrices = useAppStore((s) => s.listPrices);
  const settings = useAppStore((s) => s.settings);
  const loadMarkets = useAppStore((s) => s.loadMarkets);
  const formatId: NumberFormatId =
    settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;

  const info = catalog.find((m) => m.id === market);
  const caps = info?.capabilities;
  const marketName = info?.name ?? market;
  const key = toAscii(domain.domainName);
  const mine = listPrices[key];
  const usable = accounts.filter(
    (a) => a.market === market && a.enabled && a.configured,
  );
  const listingOn = (accountId: string): MarketListing | null =>
    listings[key]?.find((l) => l.accountId === accountId) ?? null;

  // The account that lists the name, or the first one to list it on.
  const [accountId, setAccountId] = useState(
    () => (usable.find((a) => listingOn(a.id)) ?? usable[0])?.id ?? '',
  );
  const account = usable.find((a) => a.id === accountId);
  const where =
    account && usable.length > 1
      ? `${marketName} (${account.label})`
      : marketName;
  const listing = account ? listingOn(account.id) : null;

  const currencies = caps?.currencies ?? ['USD'];
  const fits = (c: string | undefined) =>
    c !== undefined && currencies.includes(c as (typeof currencies)[number]);
  // A new listing starts from your DomBot price when the market takes its
  // currency.
  const start = listing
    ? {
        price: listing.price,
        minOffer: listing.minOffer,
        floor: listing.floor,
        currency: listing.currency as string,
      }
    : mine && fits(mine.currency)
      ? {
          price: mine.amount,
          minOffer: caps?.minOffer ? mine.minOffer : null,
          floor: caps?.floor ? mine.floor : null,
          currency: mine.currency,
        }
      : {
          price: null,
          minOffer: null,
          floor: null,
          currency: fits(preferred) ? preferred : currencies[0],
        };

  const [currency, setCurrency] = useState(start.currency);
  const [price, setPrice] = useState(whole(start.price));
  const [minOffer, setMinOffer] = useState(whole(start.minOffer));
  const [floor, setFloor] = useState(whole(start.floor));
  // Lease-to-own: the listing's own, or for a new listing the account's
  // defaults (Afternic's settings), which Afternic itself doesn't apply.
  const leaseDefaults = useLeaseDefaults(
    caps?.leaseToOwn && caps.accountSettings && account ? account.id : null,
  );
  const [leaseChoice, setLease] = useState<boolean | null>(
    listing?.leaseToOwn ? listing.leaseToOwn.enabled : null,
  );
  const [monthsChoice, setMonths] = useState<number | null>(
    listing?.leaseToOwn?.maxPayments ?? null,
  );
  const lease = leaseChoice ?? leaseDefaults?.enabled ?? true;
  const months = monthsChoice ?? leaseDefaults?.months ?? DEFAULT_LEASE_MONTHS;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelist, setConfirmDelist] = useState(false);
  const [result, setResult] = useState<{
    delisted: boolean;
    write: MarketWriteResult | null;
  } | null>(null);

  // Your DomBot asking price, offered when it isn't what's in the form.
  const mineDiffers =
    mine?.amount != null &&
    fits(mine.currency) &&
    (mine.currency !== currency || whole(mine.amount) !== price);
  const useMine = () => {
    if (!mine) return;
    setCurrency(mine.currency);
    setPrice(whole(mine.amount));
    if (caps?.minOffer) setMinOffer(whole(mine.minOffer));
    if (caps?.floor) setFloor(whole(mine.floor));
  };

  /** The fields that changed, or everything set for a new listing. */
  function changeOf(): MarketListingChange {
    const parse = (text: string, label: string) =>
      parseLocalizedAmount(text, currency, formatId, label);
    return listingChange(key, listing, caps ?? NO_CAPS, {
      price: parse(price, 'Price'),
      minOffer: caps?.minOffer ? parse(minOffer, 'Minimum offer') : null,
      floor: caps?.floor ? parse(floor, 'Floor price') : null,
      currency,
      leaseToOwn: lease,
      leaseMonths: months,
    });
  }

  async function save() {
    if (!account) return;
    setError(null);
    let change: MarketListingChange;
    try {
      change = changeOf();
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    // A stuck listing gets the market's checks re-run, as List at your
    // price does (Afternic's relist), even when no field changed.
    const recheck = !!(listing && caps?.relist && STUCK.has(listing.status));
    const changed = Object.keys(change).length > 1;
    if (!changed && !recheck) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const [r]: (MarketWriteResult | undefined)[] = changed
        ? await window.api.writeMarketListings(account.id, [change])
        : [
            {
              name: key,
              ok: true,
              pending: false,
              saved: null,
              adjusted: [],
              error: null,
            },
          ];
      if (r?.ok && recheck) {
        const mode = listing!.status === 'inactive' ? 'REACTIVATE' : 'RESYNC';
        try {
          const [again] = await window.api.relistMarketListings(
            account.id,
            [key],
            mode,
          );
          r.relisted = {
            ok: again?.ok ?? false,
            message: again?.ok ? null : (again?.error?.message ?? null),
          };
        } catch (err) {
          r.relisted = { ok: false, message: errorMessage(err) };
        }
      }
      await loadMarkets().catch(() => {});
      if (!r?.ok) {
        setError(r?.error?.message ?? `${where} didn’t save it.`);
      } else if (r.pending || r.adjusted.length || r.relisted) {
        setResult({ delisted: false, write: r });
      } else {
        onClose();
      }
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  async function delist() {
    if (!account) return;
    setError(null);
    setBusy(true);
    try {
      const [r] = await window.api.deleteMarketListings(account.id, [key]);
      await loadMarkets().catch(() => {});
      if (r && !r.ok)
        setError(r.error?.message ?? `${where} didn’t delist it.`);
      else setResult({ delisted: true, write: null });
    } catch (err) {
      setError(errorMessage(err));
    }
    setConfirmDelist(false);
    setBusy(false);
  }

  const offersOnly = market === 'atom' ? 'Make an Offer' : 'Offers only';
  // Each lease payment at the typed price, for the period chosen.
  const leasePayment = monthlyPayment(
    /^\d+$/.test(price) ? Number(price) : null,
    months,
  );
  // Hidden from buyers on the market: saving shows it (listingChange).
  const hidden = !!listing && !listing.forSale && listing.status !== 'pending';

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <ActionHeader
          title={listing ? `${marketName} listing` : `List on ${marketName}`}
          names={[domain.domainName]}
        />
        {result ? (
          <Outcome result={result} where={where} />
        ) : !account ? (
          <p className="text-sm text-muted-foreground">
            No {marketName} account is turned on. Check Settings → Markets.
          </p>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            {usable.length > 1 && (
              <Field label="Account">
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger aria-label="Account" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {usable.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label}
                        {listingOn(a.id) ? '' : ' (not listed)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {listing && (
              <ListingStatus listing={listing} recheck={!!caps?.relist} />
            )}
            {hidden && (
              <p className="text-muted-foreground">
                Hidden from buyers on {where}. Saving shows it.
              </p>
            )}
            <div
              className={
                currencies.length > 1
                  ? 'grid grid-cols-[minmax(0,1fr)_7rem] gap-3'
                  : undefined
              }
            >
              <Field
                id="market-price"
                label="Price"
                help={`${LIST_PRICE_HELP.amount} Leave it empty for ${market === 'atom' ? offersOnly : offersOnly.toLowerCase()}.`}
              >
                <MoneyInput
                  whole
                  id="market-price"
                  currency={currency}
                  value={price}
                  placeholder={offersOnly}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </Field>
              {currencies.length > 1 && (
                <Field label="Currency" help="For every price here.">
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger aria-label="Currency" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currencies.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
            {mineDiffers && (
              <p className="-mt-2 text-xs text-muted-foreground">
                Your BIN price in DomBot is{' '}
                {formatMoney(
                  mine.amount!,
                  mine.currency,
                  preferred,
                  formatId,
                  true,
                )}
                .{' '}
                <button
                  type="button"
                  className="text-foreground underline underline-offset-2 hover:text-brand"
                  onClick={useMine}
                >
                  Use it
                </button>
              </p>
            )}
            {(caps?.minOffer || caps?.floor) && (
              <div className="grid grid-cols-2 gap-3">
                {caps.minOffer && (
                  <Field
                    id="market-min-offer"
                    label="Minimum offer"
                    help={LIST_PRICE_HELP.minOffer}
                  >
                    <MoneyInput
                      whole
                      id="market-min-offer"
                      currency={currency}
                      value={minOffer}
                      placeholder="Optional"
                      onChange={(e) => setMinOffer(e.target.value)}
                    />
                  </Field>
                )}
                {caps.floor && (
                  <Field
                    id="market-floor"
                    label="Floor price"
                    help={LIST_PRICE_HELP.floor}
                  >
                    <MoneyInput
                      whole
                      id="market-floor"
                      currency={currency}
                      value={floor}
                      placeholder="Optional"
                      onChange={(e) => setFloor(e.target.value)}
                    />
                  </Field>
                )}
              </div>
            )}
            {caps?.leaseToOwn && (
              <div className="flex flex-col gap-1.5">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
                  <Field label="Lease To Own" help="Monthly installments.">
                    <label className="flex h-9 cursor-pointer items-center gap-2.5 text-sm">
                      <Switch checked={lease} onCheckedChange={setLease} />
                      {lease ? 'Enabled' : 'Disabled'}
                    </label>
                  </Field>
                  <Field
                    label="Maximum Lease Period"
                    help="Longer is a lower commission."
                  >
                    <Select
                      value={String(months)}
                      disabled={!lease}
                      onValueChange={(v) => setMonths(Number(v))}
                    >
                      <SelectTrigger
                        aria-label="Maximum Lease Period"
                        className="w-full"
                      >
                        <SelectValue>
                          {months} months
                          {(leasePayment !== null ||
                            leaseCommissionDiscount(months) > 0) && (
                            <span className="text-muted-foreground">
                              {[
                                leasePayment !== null &&
                                  `${formatMoney(String(leasePayment), currency, preferred, formatId, true)}/mo`,
                                leaseCommissionDiscount(months) > 0 &&
                                  `${leaseCommissionDiscount(months)}% off`,
                              ]
                                .filter(Boolean)
                                .map((part) => `· ${part}`)
                                .join(' ')}
                            </span>
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="end">
                        {leaseMonthOptions(months).map((m) => {
                          const pay = monthlyPayment(
                            /^\d+$/.test(price) ? Number(price) : null,
                            m,
                          );
                          return (
                            <SelectItem key={m} value={String(m)}>
                              {m} months
                              {pay !== null && (
                                <span className="text-muted-foreground">
                                  {' '}
                                  ·{' '}
                                  {formatMoney(
                                    String(pay),
                                    currency,
                                    preferred,
                                    formatId,
                                    true,
                                  )}
                                  /mo
                                </span>
                              )}
                              {leaseCommissionDiscount(m) > 0 && (
                                <span className="text-muted-foreground">
                                  {' '}
                                  · {leaseCommissionDiscount(m)}% discount
                                </span>
                              )}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground">
                  Installments need a Buy Now price between $495 and $5,000,000.
                  If the price is too low for the period, {marketName} sets it
                  as close as it can.
                </p>
              </div>
            )}
            {confirmDelist && (
              <p className="font-medium">
                Delist {domain.domainName} from {where}? The name stays in your
                registrar account, and you can list it again later.
              </p>
            )}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          {result || !account ? (
            <Button onClick={onClose}>Done</Button>
          ) : confirmDelist ? (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmDelist(false)}
              >
                Keep it listed
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void delist()}
              >
                {busy ? 'Delisting…' : 'Delist'}
              </Button>
            </>
          ) : (
            <>
              {listing && (
                <Button
                  variant="destructive"
                  className="sm:mr-auto"
                  disabled={busy}
                  onClick={() => setConfirmDelist(true)}
                >
                  Delist…
                </Button>
              )}
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void save()}>
                {busy ? 'Saving…' : listing ? 'Save' : `List on ${marketName}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The listing's status, when there's something to say about it. */
function ListingStatus({
  listing,
  recheck,
}: {
  listing: MarketListing;
  /** Saving re-runs the market's checks. */
  recheck: boolean;
}) {
  const again = recheck ? ' Saving asks the market to check it again.' : '';
  const note =
    listing.status === 'pending'
      ? `Pending: the market lists it once it can verify you own the name.${again}`
      : listing.status === 'inactive' || listing.status === 'rejected'
        ? `${listing.status === 'inactive' ? 'Inactive' : 'Rejected'} (${listing.statusRaw}).${again}`
        : listing.status === 'on_hold'
          ? `On hold (${listing.statusRaw}).`
          : listing.status === 'sold'
            ? 'Sold on this market.'
            : null;
  if (!note) return null;
  return <p className="text-muted-foreground">{note}</p>;
}

function Outcome({
  result,
  where,
}: {
  result: { delisted: boolean; write: MarketWriteResult | null };
  where: string;
}) {
  const r = result.write;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="flex items-center gap-2">
        <CircleCheck className="size-4 text-brand" />
        {result.delisted ? `Delisted from ${where}.` : `Saved on ${where}.`}
      </p>
      {r?.pending && (
        <p className="text-muted-foreground">
          Pending: {where} lists it once it can verify you own the name. Point
          its nameservers at {where}&apos;s, or verify it there.
        </p>
      )}
      {r?.relisted && (
        <p className="text-muted-foreground">
          {r.relisted.ok
            ? `The listing was stuck, so ${where} is re-running its checks.`
            : `${where} couldn’t re-run its checks: ${r.relisted.message}`}
        </p>
      )}
      {r && r.adjusted.length > 0 && (
        <p className="flex items-start gap-2">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <span>
            {where} saved{' '}
            {r.adjusted
              .map(
                (a) =>
                  `${FIELD_LABEL[a.field] ?? a.field} as ${String(a.saved ?? 'none')} (asked ${String(a.asked ?? 'none')})`,
              )
              .join(', ')}
            .
          </span>
        </p>
      )}
    </div>
  );
}

/** A label, an optional line of help, then the input. */
function Field({
  id,
  label,
  help,
  children,
}: {
  id?: string;
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {help && <p className="-mt-0.5 text-xs text-muted-foreground">{help}</p>}
      {children}
    </div>
  );
}
