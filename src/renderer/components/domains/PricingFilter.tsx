import { startTransition, useEffect, useState } from 'react';
import { CashIcon } from '../icons/CashIcon';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { FilterField } from '../data-table/FilterBar';
import { RangeInputs, rangeSummary } from '../data-table/Toolbar';
import type { ListPrice } from '../../../shared/ipc';
import {
  ASKING_KINDS,
  hasAskingKind,
  type AmountRange,
  type AskingFilter,
  type AskingKind,
} from '../../../shared/list-prices';

// The Domains Pricing filter: which part of an asking price a name has (any
// of them), then ranges on the BIN price and minimum offer, which narrow it
// further. See matchesAsking in shared/list-prices.

/** The filter as typed: range bounds are digits, "" is unbounded. */
export interface PricingFilterValue {
  kinds: AskingKind[];
  binMin: string;
  binMax: string;
  offerMin: string;
  offerMax: string;
}

export const NO_PRICING_FILTER: PricingFilterValue = {
  kinds: [],
  binMin: '',
  binMax: '',
  offerMin: '',
  offerMax: '',
};

const KIND_LABEL: Record<AskingKind, string> = {
  forSale: 'For sale',
  bin: 'Has BIN price',
  minOffer: 'Has min offer',
  none: 'Not for sale',
};

const KIND_HINT: Partial<Record<AskingKind, string>> = {
  forSale: 'BIN price or min offer',
  none: 'Neither',
};

const range = (min: string, max: string): AmountRange => ({
  min: min === '' ? null : Number(min),
  max: max === '' ? null : Number(max),
});

/** The value as matchesAsking takes it. Ranges are in `currency`. */
export function toAskingFilter(
  value: PricingFilterValue,
  currency: string,
): AskingFilter {
  return {
    kinds: value.kinds,
    bin: range(value.binMin, value.binMax),
    minOffer: range(value.offerMin, value.offerMax),
    currency,
  };
}

export function isPricingFilterSet(value: PricingFilterValue): boolean {
  return (
    value.kinds.length > 0 ||
    [value.binMin, value.binMax, value.offerMin, value.offerMax].some(
      (v) => v !== '',
    )
  );
}

/** The chip's text, e.g. "Has BIN price · BIN $1,000–$5,000". */
function pricingSummary(
  value: PricingFilterValue,
  format: (n: number) => string,
): string | null {
  const parts: string[] = [];
  if (value.kinds.length > 2) parts.push(`${value.kinds.length} kinds`);
  else if (value.kinds.length > 0)
    parts.push(value.kinds.map((k) => KIND_LABEL[k]).join(', '));
  const bin = rangeSummary(value.binMin, value.binMax, format);
  if (bin) parts.push(`BIN ${bin}`);
  const offer = rangeSummary(value.offerMin, value.offerMax, format);
  if (offer) parts.push(`Min offer ${offer}`);
  return parts.length ? parts.join(' · ') : null;
}

export function pricingField({
  value,
  onChange,
  prices,
  currency,
  format,
}: {
  value: PricingFilterValue;
  onChange: (next: PricingFilterValue) => void;
  /** The asking price of each name the counts cover. */
  prices: (ListPrice | undefined)[];
  currency: string;
  format: (n: number) => string;
}): FilterField {
  return {
    kind: 'custom',
    key: 'price',
    label: 'Pricing',
    icon: CashIcon,
    summary: pricingSummary(value, format),
    onClear: () => onChange(NO_PRICING_FILTER),
    content: (
      <PricingMenu
        value={value}
        onChange={onChange}
        prices={prices}
        currency={currency}
      />
    ),
  };
}

const onlyNone = (kinds: AskingKind[]) =>
  kinds.length > 0 && kinds.every((k) => k === 'none');

function PricingMenu({
  value,
  onChange,
  prices,
  currency,
}: {
  value: PricingFilterValue;
  onChange: (next: PricingFilterValue) => void;
  prices: (ListPrice | undefined)[];
  currency: string;
}) {
  // The boxes answer from local state at once; the table follows in a
  // transition, as in a list filter's menu.
  const [kinds, setKinds] = useState(value.kinds);
  useEffect(() => setKinds(value.kinds), [value.kinds]);
  const toggle = (kind: AskingKind) => {
    const next = kinds.includes(kind)
      ? kinds.filter((k) => k !== kind)
      : [...kinds, kind];
    setKinds(next);
    // Only Not for sale turns the ranges off, so its bounds go too.
    startTransition(() =>
      onChange(
        onlyNone(next)
          ? { ...NO_PRICING_FILTER, kinds: next }
          : { ...value, kinds: next },
      ),
    );
  };
  // A range needs that amount, so with only Not for sale picked it can't
  // match anything.
  const rangesOff = onlyNone(kinds);
  return (
    <div className="w-64">
      {ASKING_KINDS.map((kind) => (
        <DropdownMenuCheckboxItem
          key={kind}
          checked={kinds.includes(kind)}
          // Keep the menu open so several can be picked in one go.
          onSelect={(e) => e.preventDefault()}
          onCheckedChange={() => toggle(kind)}
        >
          <span className="flex-1 truncate">
            {KIND_LABEL[kind]}
            {KIND_HINT[kind] && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {KIND_HINT[kind]}
              </span>
            )}
          </span>
          <span className="ml-4 shrink-0 text-xs tabular-nums text-muted-foreground">
            {prices.filter((p) => hasAskingKind(p, kind)).length}
          </span>
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator />
      <RangeInputs
        label="BIN price"
        title="BIN price"
        min={value.binMin}
        max={value.binMax}
        disabled={rangesOff}
        onChange={(binMin, binMax) => onChange({ ...value, binMin, binMax })}
        currency={currency}
      />
      <RangeInputs
        label="minimum offer"
        title="Min offer"
        min={value.offerMin}
        max={value.offerMax}
        disabled={rangesOff}
        onChange={(offerMin, offerMax) =>
          onChange({ ...value, offerMin, offerMax })
        }
        currency={currency}
      />
      <p className="px-2 pt-0.5 pb-1.5 text-xs text-muted-foreground">
        Ranges match prices in {currency}.
      </p>
    </div>
  );
}
