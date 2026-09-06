import { Plus, Trash2 } from 'lucide-react';
import type { DomainForward, UrlForwardInput } from '../../../shared/ipc';
import type { ForwardValidation } from '../../lib/forwarding-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ValidationList } from './ValidationList';

/** The blank rule "Add" appends. */
export const EMPTY_URL_FORWARD: UrlForwardInput = {
  host: '@',
  url: '',
  type: 'permanent',
};

/**
 * A list editor for URL forwarding rules: host → destination URL, with the
 * redirect style. Controlled — the caller owns `rows` and runs validation
 * (`validation`) so the same editor serves the per-row dialog and the bulk
 * dialog. Read-only `masked` rules the registrar reported are listed above
 * the editable rows since the API can't write them back.
 */
export function UrlForwardingEditor({
  rows,
  onChange,
  validation,
  masked = [],
  disabled = false,
  urlPlaceholder = 'https://example.com/',
}: {
  rows: UrlForwardInput[];
  onChange: (rows: UrlForwardInput[]) => void;
  validation: ForwardValidation;
  /** Existing masked (frame) forwards — shown read-only, dropped on save. */
  masked?: DomainForward[];
  disabled?: boolean;
  urlPlaceholder?: string;
}) {
  const update = (i: number, patch: Partial<UrlForwardInput>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col gap-3">
      {masked.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-50/60 px-3 py-2 text-xs dark:bg-amber-950/30">
          <p className="font-medium text-amber-800 dark:text-amber-300">
            Masked (frame) forwards can’t be edited here and will be removed on
            save:
          </p>
          <ul className="mt-1 font-mono text-amber-900/80 dark:text-amber-200/80">
            {masked.map((m) => (
              <li key={m.host}>
                {m.host} → {m.url}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-[6rem_minmax(0,1fr)_9.5rem_2rem] items-center gap-2 text-xs text-muted-foreground">
          <span>Host</span>
          <span>Destination URL</span>
          <span>Redirect</span>
          <span />
        </div>
      )}
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid grid-cols-[6rem_minmax(0,1fr)_9.5rem_2rem] items-center gap-2"
        >
          <Input
            value={r.host}
            placeholder="@"
            aria-label="Host"
            disabled={disabled}
            onChange={(e) => update(i, { host: e.target.value })}
            className="h-8 font-mono text-[13px]"
          />
          <Input
            value={r.url}
            placeholder={urlPlaceholder}
            aria-label="Destination URL"
            disabled={disabled}
            onChange={(e) => update(i, { url: e.target.value })}
            className="h-8 font-mono text-[13px]"
          />
          <Select
            value={r.type}
            disabled={disabled}
            onValueChange={(v) =>
              update(i, { type: v as UrlForwardInput['type'] })
            }
          >
            <SelectTrigger
              size="sm"
              aria-label="Redirect type"
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="permanent">301 permanent</SelectItem>
              <SelectItem value="temporary">302 temporary</SelectItem>
            </SelectContent>
          </Select>
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

      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...rows, { ...EMPTY_URL_FORWARD }])}
        >
          <Plus />
          Add rule
        </Button>
      </div>

      <ValidationList validation={validation} />
    </div>
  );
}
