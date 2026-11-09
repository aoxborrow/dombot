import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ProxySettings } from '../../../shared/ipc';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { SETTINGS_LINK } from './SettingsCard';

// The per-account switch for the fixed IP proxy, on registrar and market cards.

export function ProxyToggle({
  id,
  provider,
  proxy,
  enabled,
  disabled,
  onChange,
}: {
  id: string;
  provider: { displayName: string };
  proxy: ProxySettings['proxy'];
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const proxyLink = (
    <Link to="/settings?tab=proxy" className={SETTINGS_LINK}>
      configured proxy
    </Link>
  );

  const copyEgressIp = async () => {
    if (!proxy) return;
    try {
      await navigator.clipboard.writeText(proxy.egressIp);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable: the address is still selectable by hand.
    }
  };

  return (
    <div className="mt-5 border-t pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Switch
          id={id}
          checked={enabled}
          onCheckedChange={onChange}
          // Always allow switching it off; switching it on needs a proxy.
          disabled={disabled || (!proxy && !enabled)}
        />
        <FieldLabel htmlFor={id}>Use fixed IP proxy</FieldLabel>
        {proxy && enabled && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded border border-border/60 bg-muted/30 py-0.5 pr-0.5 pl-2">
            <input
              readOnly
              value={proxy.egressIp}
              size={Math.max(proxy.egressIp.length, 7)}
              aria-label="Outgoing IP address"
              onFocus={(e) => e.currentTarget.select()}
              // It sits inside the credentials form; Enter here must not submit.
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault();
              }}
              className="bg-transparent font-mono text-xs text-foreground outline-none"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void copyEgressIp()}
              aria-label="Copy outgoing IP address"
              className={cn(
                'size-5 shrink-0 text-muted-foreground hover:text-foreground',
                copied && 'text-brand hover:text-brand',
              )}
            >
              {copied ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
            </Button>
          </div>
        )}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        {!proxy ? (
          <>
            Set up a{' '}
            <Link to="/settings?tab=proxy" className={SETTINGS_LINK}>
              proxy
            </Link>{' '}
            to use this.
          </>
        ) : enabled ? (
          <>
            This account&apos;s requests go through your proxy, so{' '}
            {provider.displayName} sees them arrive from a fixed address.
            Whitelist this IP address in the {provider.displayName} API
            settings.
          </>
        ) : (
          <>Send this account&apos;s requests through your {proxyLink}.</>
        )}
      </p>
    </div>
  );
}
