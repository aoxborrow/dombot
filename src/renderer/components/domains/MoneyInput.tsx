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
 */
export function MoneyInput({
  currency,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & { currency: string }) {
  const symbol = currencyInfo(currency)?.symbol ?? currency;
  return (
    <InputGroup className={cn('min-w-0 overflow-hidden', className)}>
      <InputGroupAddon className="h-full min-w-9 justify-center border-r bg-muted/40 px-2.5 tabular-nums">
        {symbol.length > 3 ? currency.toUpperCase() : symbol}
      </InputGroupAddon>
      <InputGroupInput
        inputMode="decimal"
        className="w-full flex-1 px-3 tabular-nums"
        {...props}
      />
    </InputGroup>
  );
}
