import type { ComponentProps } from 'react';
import { currencyInfo } from '../../../shared/money';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { cn } from '@/lib/utils';

/**
 * An amount field with its currency's symbol in a box on the left ("$",
 * "€", "£"). A currency without a short symbol shows its code. The value is
 * the typed text, in the number format from Settings; callers parse it.
 * `whole` keeps only digits, for prices.
 */
export function MoneyInput({
  currency,
  whole = false,
  className,
  onChange,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & {
  currency: string;
  /** Whole amounts only (prices): digits, no decimal mark or grouping. */
  whole?: boolean;
}) {
  const symbol = currencyInfo(currency)?.symbol ?? currency;
  return (
    <InputGroup className={cn('min-w-0 overflow-hidden', className)}>
      <InputGroupAddon className="h-full min-w-9 justify-center border-r bg-muted/40 px-2.5 tabular-nums">
        {symbol.length > 3 ? currency.toUpperCase() : symbol}
      </InputGroupAddon>
      <InputGroupInput
        inputMode={whole ? 'numeric' : 'decimal'}
        className="w-full flex-1 px-3 tabular-nums"
        onChange={
          whole
            ? (e) => {
                // Whole amounts: drop cents (one or two digits after a final
                // "." or ","), then keep the digits, so a pasted "4,850.75"
                // or "4.850,75" reads as 4850.
                e.target.value = e.target.value
                  .replace(/[.,]\d{0,2}$/, '')
                  .replace(/\D/g, '');
                onChange?.(e);
              }
            : onChange
        }
        {...props}
      />
    </InputGroup>
  );
}
