import { useMemo, useRef, useState } from 'react';
import { toAscii } from '../../../shared/domain-name';
import type { Domain } from '../../../shared/ipc';
import {
  listedPriceFor,
  type ListedPrice,
  type ListedPriceSource,
} from '../../../shared/listed-prices';
import { sameListPrice } from '../../../shared/list-prices';
import type { MarketId } from '../../../shared/markets';
import {
  DEFAULT_CURRENCY,
  DEFAULT_NUMBER_FORMAT,
  formatMoney,
} from '../../../shared/money';
import { useAppStore } from '../../store/app';
import { MarketLogo } from '../RegistrarLogo';
import { ActionHeader } from '../actions/ActionDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { cn } from '@/lib/utils';

const names = (n: number) => `${n.toLocaleString()} name${n === 1 ? '' : 's'}`;

/**
 * Price from listings: copy what a market lists names for (BIN price,
 * minimum offer, floor) into their asking prices in DomBot, from one market
 * or from whichever listing is highest. For starting out in DomBot with
 * prices set on a market, then pricing here and listing everywhere. For a
 * selection, names that already have an asking price keep it unless you
 * choose to replace them; one name picked from its row is replaced.
 */
export function PriceFromListingsDialog({
  domains,
  onClose,
}: {
  domains: Domain[];
  onClose: () => void;
}) {
  const listings = useAppStore((s) => s.marketListings);
  const listPrices = useAppStore((s) => s.listPrices);
  const catalog = useAppStore((s) => s.marketCatalog);
  const accounts = useAppStore((s) => s.marketAccounts);
  const rates = useAppStore((s) => s.exchangeRates);
  const settings = useAppStore((s) => s.settings);
  const saveListPrices = useAppStore((s) => s.saveListPrices);
  const formatId = settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT;
  const preferred = settings?.preferredCurrency ?? DEFAULT_CURRENCY;

  const keys = useMemo(
    () => [...new Set(domains.map((d) => toAscii(d.domainName)))],
    [domains],
  );
  const one = keys.length === 1;
  const marketName = (id: MarketId) =>
    catalog.find((m) => m.id === id)?.name ?? id;

  // Every connected market, in the catalog's order, with how many of these
  // names it lists a price for.
  const sources = useMemo(() => {
    const connected = new Set((accounts ?? []).map((a) => a.market));
    const markets = catalog.map((m) => m.id).filter((id) => connected.has(id));
    const count = (source: ListedPriceSource) =>
      keys.filter((k) => listedPriceFor(listings[k], source, rates)).length;
    return [
      ...(markets.length > 1
        ? [{ source: 'highest' as const, count: count('highest') }]
        : []),
      ...markets.map((id) => ({ source: id, count: count(id) })),
    ];
  }, [accounts, catalog, keys, listings, rates]);

  const [source, setSource] = useState<ListedPriceSource>(
    () => sources.find((s) => s.count > 0)?.source ?? 'highest',
  );
  const [replace, setReplace] = useState(one);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveRef = useRef<HTMLButtonElement>(null);

  // What each name would get, and why the rest are skipped.
  const plan = useMemo(() => {
    const found: { key: string; price: ListedPrice }[] = [];
    let unlisted = 0;
    let kept = 0;
    let same = 0;
    for (const key of keys) {
      const price = listedPriceFor(listings[key], source, rates);
      if (!price) {
        unlisted++;
        continue;
      }
      const current = listPrices[key];
      if (current && sameListPrice(current, { ...price, updatedAt: 0 })) {
        same++;
        continue;
      }
      if (current && !replace) {
        kept++;
        continue;
      }
      found.push({ key, price });
    }
    return { found, unlisted, kept, same };
  }, [keys, listings, listPrices, rates, replace, source]);
  const priced = keys.filter((k) => listPrices[k]).length;

  const money = (amount: string | null, currency: string) =>
    amount ? formatMoney(amount, currency, preferred, formatId, true) : '—';
  const where = source === 'highest' ? 'any market' : marketName(source);

  async function run() {
    setError(null);
    setSaving(true);
    try {
      await saveListPrices(
        plan.found.map(({ key, price }) => ({
          domainName: key,
          amount: price.amount,
          minOffer: price.minOffer,
          floor: price.floor,
          currency: price.currency,
        })),
      );
      onClose();
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Could not save.';
      setError(raw.replace(/^Error invoking remote method '[^']+':\s*/, ''));
      setSaving(false);
    }
  }

  // One name: show the price it would get, beside the one it has.
  const single = one ? listedPriceFor(listings[keys[0]], source, rates) : null;
  const current = one ? listPrices[keys[0]] : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        // Start on Save rather than the first source, whose focus ring looks
        // like a selection. With nothing to save, the dialog itself.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const save = saveRef.current;
          if (save && !save.disabled) save.focus();
          else (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <ActionHeader
          title={one ? 'Price from listings' : 'Prices from listings'}
          names={domains.map((d) => d.domainName)}
        />
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            Copies the BIN price, minimum offer and floor from market listings
            into your asking {one ? 'price' : 'prices'} in DomBot. From then on
            you can price here and list on every market.
          </p>
          {sources.length > 1 && (
            <Field>
              <FieldLabel>From</FieldLabel>
              <div
                role="radiogroup"
                aria-label="Price from"
                className="flex flex-col gap-2"
              >
                {sources.map((s) => (
                  <label
                    key={s.source}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5',
                      s.count === 0 && 'text-muted-foreground',
                    )}
                  >
                    <input
                      type="radio"
                      name="listed-price-source"
                      className="size-4 accent-primary"
                      checked={source === s.source}
                      onChange={() => setSource(s.source)}
                    />
                    {s.source !== 'highest' && (
                      <MarketLogo
                        market={s.source}
                        label={marketName(s.source)}
                        className="size-5 text-muted-foreground"
                      />
                    )}
                    {s.source === 'highest'
                      ? 'Highest listed price'
                      : marketName(s.source)}
                    {!one && (
                      <span className="text-muted-foreground">
                        {s.count ? `${names(s.count)} listed` : 'none listed'}
                      </span>
                    )}
                    {one && s.count === 0 && (
                      <span className="text-muted-foreground">not listed</span>
                    )}
                  </label>
                ))}
              </div>
            </Field>
          )}

          {one && single && (
            <dl className="grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 rounded-md border px-3 py-2 tabular-nums">
              <dt />
              <dd className="text-xs text-muted-foreground">
                {sources.length > 1 && source === 'highest'
                  ? 'Highest listed'
                  : 'Listed'}
              </dd>
              <dd className="text-xs text-muted-foreground">Yours now</dd>
              {(
                [
                  ['BIN price', 'amount'],
                  ['Minimum offer', 'minOffer'],
                  ['Floor', 'floor'],
                ] as const
              ).map(([label, field]) => (
                <div key={field} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>{money(single[field], single.currency)}</dd>
                  <dd className="text-muted-foreground">
                    {current
                      ? money(current[field] ?? null, current.currency)
                      : '—'}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {one && single && plan.same > 0 && (
            <p className="text-muted-foreground">
              Your asking price already matches.
            </p>
          )}
          {one ? (
            !single && <p>Not listed on {where}.</p>
          ) : (
            <>
              {priced > 0 && (
                <label className="flex cursor-pointer items-center gap-2.5">
                  <Checkbox
                    checked={replace}
                    onCheckedChange={(on) => setReplace(on === true)}
                  />
                  Replace asking prices already set
                  <span className="text-muted-foreground">{names(priced)}</span>
                </label>
              )}
              <p>
                {plan.found.length
                  ? `${names(plan.found.length)} will get ${source === 'highest' ? 'their highest listed price' : `the price listed on ${where}`}.`
                  : 'Nothing to import for this selection.'}
                {[
                  plan.unlisted &&
                    `${names(plan.unlisted)} not listed${source === 'highest' ? '' : ' there'}`,
                  plan.kept && `${names(plan.kept)} keeping the price you set`,
                  plan.same && `${names(plan.same)} already at that price`,
                ]
                  .filter(Boolean)
                  .map((text) => (
                    <span key={String(text)} className="text-muted-foreground">
                      {' '}
                      {text}.
                    </span>
                  ))}
              </p>
            </>
          )}
          {error && (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            ref={saveRef}
            disabled={saving || plan.found.length === 0}
            onClick={() => void run()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
