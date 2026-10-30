import { Fragment } from 'react';
import { currencyOptions, isPinnedCurrency } from '../../../shared/money';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * A currency dropdown on its own (Settings, import defaults), showing the
 * code and name. Beside an amount, use MoneyInput's `onCurrencyChange`
 * instead, which puts the dropdown inside the field.
 */
export function CurrencyPicker({
  value,
  onChange,
  label = 'Currency',
  currencies,
}: {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  /** Narrower choices than the 30 DomBot converts. */
  currencies?: readonly string[];
}) {
  const options = currencyOptions(currencies, value);
  const selected = options.find((c) => c.code === value);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue>
          {selected ? `${selected.code} — ${selected.name}` : value}
        </SelectValue>
      </SelectTrigger>
      <CurrencyItems options={options} />
    </Select>
  );
}

/** The dropdown's list: the pinned currencies, a rule, then the rest. */
export function CurrencyItems({
  options,
  align = 'start',
}: {
  options: ReturnType<typeof currencyOptions>;
  align?: 'start' | 'end';
}) {
  return (
    <SelectContent position="popper" align={align} className="max-h-72">
      {options.map((c, i) => (
        <Fragment key={c.code}>
          {i > 0 &&
            isPinnedCurrency(options[i - 1].code) &&
            !isPinnedCurrency(c.code) && <SelectSeparator />}
          <SelectItem value={c.code}>
            <span className="w-9 shrink-0 font-medium">{c.code}</span>
            <span className="text-muted-foreground">{c.name}</span>
          </SelectItem>
        </Fragment>
      ))}
    </SelectContent>
  );
}
