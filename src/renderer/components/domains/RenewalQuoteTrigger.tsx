import { useRef, useState } from 'react';
import type { DomainTarget, RegistrarRenewalQuote } from '../../../shared/ipc';
import { formatMoneyNumber, type NumberFormatId } from '../../../shared/money';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

/** Checks only when the estimate is opened, leaving the saved figure intact. */
export function RenewalQuoteTrigger({
  target,
  estimate,
  title,
  numberFormat,
}: {
  target: DomainTarget;
  estimate: string;
  title: string;
  numberFormat: NumberFormatId;
}) {
  const [quote, setQuote] = useState<RegistrarRenewalQuote | null>();
  const pending = useRef(false);

  async function checkQuote(open: boolean) {
    if (!open || pending.current) return;
    pending.current = true;
    setQuote(undefined);
    try {
      setQuote(await window.api.getRegistrarRenewalQuote(target));
    } catch {
      setQuote(null);
    } finally {
      pending.current = false;
    }
  }

  return (
    <Popover onOpenChange={checkQuote}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-sm text-left font-medium tabular-nums underline decoration-dotted underline-offset-2 hover:text-primary focus-visible:outline-2"
          title={`Check current registrar quote. ${title}`}
          aria-label={`Check current renewal quote for ${target.domainName}. Estimate ${estimate}`}
        >
          {estimate}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={`Renewal quote for ${target.domainName}`}
        className="w-64 text-sm"
      >
        <p className="font-medium">Registrar renewal quote</p>
        <div role="status" className="mt-1">
          {quote === undefined ? (
            <p>Checking registrar…</p>
          ) : quote ? (
            <>
              <p className="font-semibold tabular-nums">
                {formatMoneyNumber(
                  quote.renewal,
                  quote.currency,
                  '',
                  numberFormat,
                )}{' '}
                per year
              </p>
              <p className="text-xs text-muted-foreground">
                Checked {new Date(quote.checkedAt).toLocaleString()}
              </p>
            </>
          ) : (
            <p>No current quote available for this domain.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
