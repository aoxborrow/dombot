import { Label } from '@/components/ui/label';
import { MoneyInput } from '../domains/MoneyInput';

/** One name's amount in a bulk dialog. */
export interface NameAmountRow {
  key: string;
  /** The name as shown. */
  name: string;
  /** A muted line under the name, e.g. its registration date. */
  detail?: string;
  /** The typed amount, in the number format from Settings. */
  amount: string;
  currency: string;
  /** Still being filled in (a fee lookup). */
  loading?: boolean;
  /** Why the amount is blank, shown under the name instead of `detail`. */
  note?: string;
}

/**
 * The bulk Record sale and Record registration dialogs' list: a row per name
 * with its own amount, like the one-name dialogs' amount field. Scrolls past
 * a dozen or so names. With `onCurrency`, each row's currency is a dropdown
 * in its field; without it, the rows share the dialog's currency.
 */
export function NameAmounts({
  id,
  label,
  rows,
  placeholder,
  onAmount,
  onCurrency,
}: {
  id: string;
  label: string;
  rows: NameAmountRow[];
  /** What a blank amount means, e.g. "Later". */
  placeholder?: string;
  onAmount: (key: string, amount: string) => void;
  onCurrency?: (key: string, currency: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label id={id}>{label}</Label>
      <div
        role="group"
        aria-labelledby={id}
        className="max-h-64 divide-y overflow-y-auto rounded-md border"
      >
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-sm">{row.name}</div>
              {(row.note || row.detail) && (
                <div className="text-xs text-muted-foreground">
                  {row.note ?? row.detail}
                </div>
              )}
            </div>
            <MoneyInput
              aria-label={`${label}: ${row.name}`}
              className="w-44 shrink-0"
              currency={row.currency}
              onCurrencyChange={
                onCurrency ? (code) => onCurrency(row.key, code) : undefined
              }
              value={row.amount}
              disabled={row.loading}
              placeholder={row.loading ? 'Looking up…' : placeholder}
              onChange={(e) => onAmount(row.key, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
