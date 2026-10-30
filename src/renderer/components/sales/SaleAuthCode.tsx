import { useState } from 'react';
import { toUnicode } from '../../../shared/domain-name';
import { useAppStore } from '../../store/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Send auth code, for a market sale waiting on it: DomBot gets the code from
 * the registrar that holds the name and sends it to the market. When it
 * can't, the code can be pasted in and sent instead.
 */
export function SaleAuthCode({
  accountId,
  saleId,
  name,
  className,
}: {
  accountId: string;
  saleId: string;
  name: string;
  className?: string;
}) {
  const loadMarkets = useAppStore((s) => s.loadMarkets);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  // Shown once DomBot couldn't get the code itself: type it instead.
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState('');
  const send = async (authCode?: string) => {
    setState('sending');
    setError(null);
    try {
      await window.api.setMarketSaleAuthCode(accountId, saleId, authCode);
      setState('sent');
      setTyping(false);
      void loadMarkets();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('idle');
      setTyping(true);
    }
  };
  return (
    <div className={cn('flex flex-col items-end gap-1.5', className)}>
      {!typing && (
        <Button
          size="sm"
          variant="outline"
          // Short enough to sit in a table row without making it taller.
          className="-my-1 h-6 shrink-0 px-2 text-xs"
          disabled={state !== 'idle'}
          onClick={() => void send()}
          title="Get the code from the registrar that holds the name and send it to the market"
        >
          {state === 'sending'
            ? 'Sending…'
            : state === 'sent'
              ? 'Sent'
              : 'Send auth code'}
        </Button>
      )}
      {error && (
        <p
          role="alert"
          className="max-w-72 text-right text-xs text-destructive"
        >
          {error}
        </p>
      )}
      {typing && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) void send(code);
          }}
        >
          <Input
            className="h-7 w-40"
            value={code}
            placeholder="Auth code"
            aria-label={`Auth code for ${toUnicode(name)}`}
            autoComplete="off"
            spellCheck={false}
            disabled={state === 'sending'}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            className="h-7"
            disabled={state === 'sending' || !code.trim()}
          >
            {state === 'sending' ? 'Sending…' : 'Send'}
          </Button>
        </form>
      )}
    </div>
  );
}
