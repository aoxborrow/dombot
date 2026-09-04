import { Plus, Trash2 } from 'lucide-react';
import type { EmailForward } from '../../../shared/ipc';
import type { ForwardValidation } from '../../lib/forwarding-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ValidationList } from './ValidationList';

/** The blank rule "Add" appends. */
export const EMPTY_EMAIL_FORWARD: EmailForward = { alias: '', forwardTo: '' };

/**
 * A list editor for email forwarding rules: alias@domain → destination
 * address. Controlled, like UrlForwardingEditor; the caller validates.
 * `domainName` is shown after the alias field so the rule reads as an address.
 */
export function EmailForwardingEditor({
  rows,
  onChange,
  validation,
  domainName,
  disabled = false,
}: {
  rows: EmailForward[];
  onChange: (rows: EmailForward[]) => void;
  validation: ForwardValidation;
  /** Shown as the alias suffix; "{domain}" in bulk mode. */
  domainName: string;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<EmailForward>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col gap-3">
      {rows.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 text-xs text-muted-foreground">
          <span>Alias</span>
          <span>Forward to</span>
          <span />
        </div>
      )}
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
        >
          <div className="flex items-center gap-1">
            <Input
              value={r.alias}
              placeholder="hello"
              aria-label="Alias"
              disabled={disabled}
              onChange={(e) => update(i, { alias: e.target.value })}
              className="h-8 min-w-0 font-mono text-[13px]"
            />
            <span className="shrink-0 truncate font-mono text-[13px] text-muted-foreground">
              @{domainName}
            </span>
          </div>
          <Input
            value={r.forwardTo}
            placeholder="you@example.com"
            aria-label="Forward to"
            disabled={disabled}
            onChange={(e) => update(i, { forwardTo: e.target.value })}
            className="h-8 font-mono text-[13px]"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onClick={() => remove(i)}
            aria-label="Remove rule"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      ))}

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...rows, { ...EMPTY_EMAIL_FORWARD }])}
        >
          <Plus />
          Add rule
        </Button>
        <span className="text-xs text-muted-foreground">
          Use <span className="font-mono">@</span> or{' '}
          <span className="font-mono">*</span> as a catch-all where supported.
        </span>
      </div>

      <ValidationList validation={validation} />
    </div>
  );
}
