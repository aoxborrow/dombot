import { startTransition, useEffect, useState, type ReactNode } from 'react';
import { Store } from 'lucide-react';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { FilterField } from '../data-table/FilterBar';
import { RangeInputs, rangeSummary } from '../data-table/Toolbar';
import { MarketLogo } from '../RegistrarLogo';
import type { ListPrice } from '../../../shared/ipc';
import {
  MARKET_STATE_CHOICES,
  PRICE_COMPARISONS,
  matchesMarketFilter,
  type MarketFilter,
  type MarketStateChoice,
  type PriceComparison,
} from '../../../shared/market-filter';
import type { MarketListing } from '../../../shared/markets';

// The Domains Markets filter: the markets in play (all to start), then what a
// listing there is like: its state, its price against your DomBot price, and
// a range on its price. A name matches when one market in play has a listing
// meeting all of them (matchesMarketFilter in shared/market-filter).

/** The filter as typed: range bounds are digits, "" is unbounded. */
export interface MarketsFilterValue {
  /** Empty means every market. */
  markets: string[];
  states: MarketStateChoice[];
  comparisons: PriceComparison[];
  min: string;
  max: string;
}

export const NO_MARKETS_FILTER: MarketsFilterValue = {
  markets: [],
  states: [],
  comparisons: [],
  min: '',
  max: '',
};

const STATE_LABEL: Record<MarketStateChoice, string> = {
  active: 'Active',
  pending: 'Pending',
  inactive: 'Inactive',
  rejected: 'Rejected',
  none: 'Not listed',
};

const STATE_HINT: Partial<Record<MarketStateChoice, string>> = {
  pending: 'or on hold',
  inactive: 'or hidden',
};

const COMPARISON_LABEL: Record<PriceComparison, string> = {
  above: 'Above your price',
  below: 'Below your price',
  same: 'At your price',
};

/** The value as matchesMarketFilter takes it. The range is in `currency`. */
export function toMarketFilter(
  value: MarketsFilterValue,
  currency: string,
): MarketFilter {
  return {
    markets: value.markets,
    states: value.states,
    comparisons: value.comparisons,
    min: value.min === '' ? null : Number(value.min),
    max: value.max === '' ? null : Number(value.max),
    currency,
  };
}

/** The chip's text, e.g. "Afternic · Pending · Below your price". */
function marketsSummary(
  value: MarketsFilterValue,
  name: (market: string) => string,
  format: (n: number) => string,
): string | null {
  const parts: string[] = [];
  const list = (labels: string[], plural: string) =>
    labels.length > 2 ? `${labels.length} ${plural}` : labels.join(', ');
  if (value.markets.length)
    parts.push(list(value.markets.map(name), 'markets'));
  if (value.states.length)
    parts.push(
      list(
        value.states.map((s) => STATE_LABEL[s]),
        'states',
      ),
    );
  if (value.comparisons.length)
    parts.push(
      list(
        value.comparisons.map((c) => COMPARISON_LABEL[c]),
        'comparisons',
      ),
    );
  const range = rangeSummary(value.min, value.max, format);
  if (range) parts.push(range);
  return parts.length ? parts.join(' · ') : null;
}

/** One name the counts cover: its listings and DomBot price. */
export interface MarketsFilterRow {
  listings: readonly MarketListing[] | undefined;
  mine: ListPrice | undefined;
}

export function marketsField({
  value,
  onChange,
  markets,
  rows,
  currency,
  format,
}: {
  value: MarketsFilterValue;
  onChange: (next: MarketsFilterValue) => void;
  /** The connected markets, in the catalog's order. */
  markets: { id: string; name: string }[];
  rows: MarketsFilterRow[];
  currency: string;
  format: (n: number) => string;
}): FilterField {
  const name = (id: string) => markets.find((m) => m.id === id)?.name ?? id;
  return {
    kind: 'custom',
    key: 'markets',
    label: 'Markets',
    icon: Store,
    summary: marketsSummary(value, name, format),
    onClear: () => onChange(NO_MARKETS_FILTER),
    content: (
      <MarketsMenu
        value={value}
        onChange={onChange}
        markets={markets}
        rows={rows}
        currency={currency}
      />
    ),
  };
}

function MarketsMenu({
  value,
  onChange,
  markets,
  rows,
  currency,
}: {
  value: MarketsFilterValue;
  onChange: (next: MarketsFilterValue) => void;
  markets: { id: string; name: string }[];
  rows: MarketsFilterRow[];
  currency: string;
}) {
  // The boxes answer from local state at once; the table follows in a
  // transition, as in a list filter's menu.
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const apply = (next: MarketsFilterValue) => {
    setLocal(next);
    startTransition(() => onChange(next));
  };
  const all = markets.map((m) => m.id);
  const inPlay = local.markets.length ? local.markets : all;

  const toggleMarket = (id: string) => {
    const next = inPlay.includes(id)
      ? inPlay.filter((m) => m !== id)
      : [...inPlay, id];
    // At least one stays ticked; all ticked is the same as none chosen.
    if (next.length === 0) return;
    apply({
      ...local,
      markets:
        next.length === all.length ? [] : all.filter((m) => next.includes(m)),
    });
  };
  const toggle = <K extends 'states' | 'comparisons'>(
    key: K,
    item: MarketsFilterValue[K][number],
  ) => {
    const list = local[key] as string[];
    const next = list.includes(item)
      ? list.filter((x) => x !== item)
      : [...list, item];
    apply({ ...local, [key]: next });
  };

  // How many names each option alone would find among the markets in play.
  const count = (over: Partial<MarketFilter>) => {
    const f = {
      ...toMarketFilter(NO_MARKETS_FILTER, currency),
      markets: local.markets,
      ...over,
    };
    return rows.filter((r) => matchesMarketFilter(r.listings, r.mine, f, all))
      .length;
  };
  const listedOn = (id: string) =>
    rows.filter((r) => r.listings?.some((l) => l.market === id)).length;
  // "Not listed" can't have a price, so the price conditions don't apply.
  const onlyNone =
    local.states.length > 0 && local.states.every((s) => s === 'none');

  const checkbox = (
    key: string,
    checked: boolean,
    onToggle: () => void,
    label: ReactNode,
    n: number,
    disabled = false,
  ) => (
    <DropdownMenuCheckboxItem
      key={key}
      checked={checked}
      disabled={disabled}
      // Keep the menu open so several can be picked in one go.
      onSelect={(e) => e.preventDefault()}
      onCheckedChange={onToggle}
    >
      <span className="flex flex-1 items-center gap-2 truncate">{label}</span>
      <span className="ml-4 shrink-0 text-xs tabular-nums text-muted-foreground">
        {n}
      </span>
    </DropdownMenuCheckboxItem>
  );

  return (
    <div className="w-64">
      {markets.length > 1 && (
        <>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Markets
          </DropdownMenuLabel>
          {markets.map((m) =>
            checkbox(
              m.id,
              inPlay.includes(m.id),
              () => toggleMarket(m.id),
              <>
                <MarketLogo
                  market={m.id}
                  label={m.name}
                  className="size-4 p-[1.5px] text-muted-foreground"
                />
                {m.name}
              </>,
              listedOn(m.id),
            ),
          )}
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuLabel className="text-xs text-muted-foreground">
        Status
      </DropdownMenuLabel>
      {MARKET_STATE_CHOICES.map((s) =>
        checkbox(
          s,
          local.states.includes(s),
          () => toggle('states', s),
          <>
            {STATE_LABEL[s]}
            {STATE_HINT[s] && (
              <span className="text-xs text-muted-foreground">
                {STATE_HINT[s]}
              </span>
            )}
          </>,
          count({ states: [s] }),
        ),
      )}
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs text-muted-foreground">
        Price vs DomBot
      </DropdownMenuLabel>
      {PRICE_COMPARISONS.map((c) =>
        checkbox(
          c,
          local.comparisons.includes(c),
          () => toggle('comparisons', c),
          COMPARISON_LABEL[c],
          count({ comparisons: [c] }),
          onlyNone,
        ),
      )}
      <DropdownMenuSeparator />
      <RangeInputs
        label="market price"
        title="Market price"
        min={local.min}
        max={local.max}
        disabled={onlyNone}
        onChange={(min, max) => apply({ ...local, min, max })}
        currency={currency}
      />
    </div>
  );
}
