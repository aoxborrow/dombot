import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { toUnicode } from '../../../shared/domain-name';
import type { Domain, DomainOp, RegistrarMeta } from '../../../shared/ipc';
import { opUnsupportedReason } from '../../lib/domain-ops';
import { useAppStore } from '../../store/app';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SaleStepButton } from './SaleStepButton';

const AUTH_CODE: DomainOp = { kind: 'authCode' };

/**
 * Where a sale's auth code has to be pasted from, when DomBot can't get it
 * itself: the registrar's name where its API doesn't give codes out, or ''
 * when no one account of yours holds the name. Null when DomBot gets it.
 */
export function pastedAuthCodeFrom(
  domain: Domain | null | undefined,
  registrars: RegistrarMeta[] | null,
): string | null {
  if (!domain) return '';
  if (opUnsupportedReason(registrars, domain.registrar, AUTH_CODE) === null) {
    return null;
  }
  return (
    registrars?.find((r) => r.name === domain.registrar)?.displayName ??
    domain.registrar
  );
}

/**
 * Send auth code, for a market sale waiting on it: DomBot gets the code from
 * the registrar that holds the name and sends it to the market. Where it
 * can't (`pasteFrom` set), or the fetch fails, a box takes the code pasted in
 * instead, as short as the row's other steps. It waits, disabled with the
 * reason, while an earlier step (Unlock) is still to do. What went wrong
 * shows as a toast, leaving the row its height.
 */
export function SaleAuthCode({
  accountId,
  saleId,
  name,
  pasteFrom = null,
  waitingOn = null,
  className,
}: {
  accountId: string;
  saleId: string;
  name: string;
  /** Set when the code is pasted in: where from (see `pastedAuthCodeFrom`). */
  pasteFrom?: string | null;
  /** Why it can't go yet: the step before it, still to do. */
  waitingOn?: string | null;
  className?: string;
}) {
  const loadMarkets = useAppStore((s) => s.loadMarkets);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [failed, setFailed] = useState(false);
  // Once DomBot couldn't get the code itself: paste it instead.
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const send = async (authCode?: string) => {
    setState('sending');
    setFailed(false);
    try {
      await window.api.setMarketSaleAuthCode(accountId, saleId, authCode);
      setState('sent');
      setTyping(false);
      void loadMarkets();
    } catch (err) {
      const message = (
        err instanceof Error ? err.message : String(err)
      ).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
      toast.error(
        message,
        authCode
          ? undefined
          : { description: 'Paste it in to send it to the market.' },
      );
      setFailed(true);
      setState('idle');
      setTyping(true);
    }
  };
  if (state === 'sent' || (!typing && pasteFrom === null)) {
    return (
      <SaleStepButton
        className={className}
        disabled={state !== 'idle' || waitingOn !== null}
        onClick={() => void send()}
        title={
          state === 'sent'
            ? 'The market has the transfer auth code'
            : (waitingOn ??
              'Get the code from the registrar that holds the name and send it to the market')
        }
      >
        {state === 'sending'
          ? 'Sending…'
          : state === 'sent'
            ? 'Auth code sent'
            : 'Send auth code'}
      </SaleStepButton>
    );
  }
  const busy = state === 'sending';
  return (
    <form
      className={cn('flex shrink-0 items-center gap-1.5', className)}
      title={
        waitingOn ??
        `Paste the auth code${pasteFrom ? ` from ${pasteFrom}` : ''} to send it to the market`
      }
      onSubmit={(e) => {
        e.preventDefault();
        // Send stays on with the box empty, so the box reads as the step;
        // empty, it only puts you in the box.
        if (code.trim()) void send(code);
        else input.current?.focus();
      }}
    >
      <Input
        ref={input}
        className="-my-1 h-6 w-32 px-2 py-0 text-xs md:text-xs"
        value={code}
        placeholder="Paste auth code"
        aria-label={`Auth code for ${toUnicode(name)}`}
        aria-invalid={failed || undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={busy || waitingOn !== null}
        onChange={(e) => {
          setCode(e.target.value);
          setFailed(false);
        }}
      />
      <SaleStepButton type="submit" disabled={busy || waitingOn !== null}>
        {busy ? 'Sending…' : 'Send'}
      </SaleStepButton>
    </form>
  );
}
