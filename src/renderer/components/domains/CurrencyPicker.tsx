import { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { searchCurrencies, type CurrencyInfo } from '../../../shared/money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Searchable ISO currency list. Typing matches the code or an English name
 * ("US", "yen", "yuan"). With no query the list starts at USD, EUR, GBP,
 * CNY, and JPY.
 */
export function CurrencyPicker({
  value,
  onChange,
  label = 'Currency',
  compact = false,
}: {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  /** Show the code alone ("USD"), for a narrow spot beside amounts. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const matches = useMemo(() => searchCurrencies(query).slice(0, 40), [query]);
  const selected = searchCurrencies('').find((c) => c.code === value);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            'justify-between font-normal',
            compact ? 'w-full gap-2 sm:w-24' : 'w-full',
          )}
          title={selected ? `${selected.code} — ${selected.name}` : undefined}
        >
          <span className="truncate">
            {selected && !compact
              ? `${selected.code} — ${selected.name}`
              : value}
          </span>
          {/* The select's chevron, so it reads as a dropdown like one. */}
          <ChevronDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <Input
          autoFocus
          value={query}
          placeholder="Search by code or name"
          aria-label={`Search ${label.toLowerCase()}`}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="mt-2 max-h-64 overflow-y-auto">
          {matches.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              No currencies match.
            </p>
          ) : (
            matches.map((c) => (
              <CurrencyRow
                key={c.code}
                currency={c}
                selected={c.code === value}
                onPick={() => {
                  onChange(c.code);
                  setOpen(false);
                  setQuery('');
                }}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CurrencyRow({
  currency,
  selected,
  onPick,
}: {
  currency: CurrencyInfo;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent',
        selected && 'bg-accent',
      )}
      onClick={onPick}
    >
      <Check
        className={cn(
          'size-3.5 shrink-0',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      />
      <span className="w-10 shrink-0 font-medium">{currency.code}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {currency.name}
      </span>
      <span className="shrink-0 text-muted-foreground">{currency.symbol}</span>
    </button>
  );
}
