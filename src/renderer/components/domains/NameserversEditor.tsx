import { useEffect, useMemo, useState } from 'react';
import {
  sameNameservers,
  validateNameservers,
  type NameserverPreset,
} from '../../lib/nameserver-input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InlineWarning } from '../InlineWarning';

/** Shown once the set differs from the current one, whatever the new set is. */
export const NAMESERVER_WARNING =
  'Changing nameservers moves the DNS: any website or email stops working unless the new nameservers serve it.';

/**
 * The nameserver set editor: one host per line (paste-friendly — commas and
 * spaces split too), live validation, and a Presets picker of the portfolio's
 * common sets plus the user's recent saves. Shared by the per-row popover and
 * the bulk dialog; the caller owns the write.
 *
 * Save is disabled while there are errors, while nothing changed from
 * `initial`, and while `saving`. ⌘/Ctrl+Enter saves.
 */
export function NameserversEditor({
  initial,
  presets,
  note,
  saving = false,
  saveLabel = 'Save',
  showActions = true,
  onChange,
  onSave,
  onCancel,
}: {
  /** The current set, pre-filled. Empty for "unknown". */
  initial: string[];
  presets: NameserverPreset[];
  /** An advisory line shown above the buttons (a registrar caveat). */
  note?: string;
  saving?: boolean;
  saveLabel?: string;
  /** Hide the Cancel/Save row (a host dialog supplies its own). */
  showActions?: boolean;
  /** Fires on every edit with the parsed set, or null while invalid. */
  onChange?: (nameservers: string[] | null) => void;
  onSave?: (nameservers: string[]) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial.join('\n'));
  const parsed = useMemo(() => validateNameservers(text), [text]);
  const unchanged =
    parsed.errors.length === 0 && sameNameservers(parsed.nameservers, initial);
  const canSave = parsed.errors.length === 0 && !unchanged && !saving;

  const save = () => {
    if (canSave) onSave?.(parsed.nameservers);
  };

  useEffect(() => {
    onChange?.(
      parsed.errors.length === 0 && parsed.nameservers.length > 0
        ? parsed.nameservers
        : null,
    );
    // Report only when the parse result changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
        placeholder={'ns1.example.net\nns2.example.net'}
        rows={4}
        spellCheck={false}
        autoFocus
        disabled={saving}
        aria-invalid={parsed.errors.length > 0}
        className="min-h-24 resize-y font-mono text-[13px] leading-relaxed"
      />

      {presets.length > 0 && (
        <Select
          value=""
          onValueChange={(key) => {
            const preset = presets.find((p) => p.key === key);
            if (preset) setText(preset.nameservers.join('\n'));
          }}
          disabled={saving}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder="Presets…" />
          </SelectTrigger>
          {/* Popper, like the currency picker: a long list scrolls in place
              under the trigger instead of running off the window. */}
          <SelectContent
            position="popper"
            align="start"
            className="max-h-72 w-(--radix-select-trigger-width)"
          >
            {/* Each preset lists its actual hosts — several providers (e.g.
                Cloudflare) hand out different host pairs per account, so the
                provider name alone would look like duplicates. The markets'
                own sets come first, under a heading of their own. */}
            {presets.some((p) => p.market) && (
              <>
                <SelectGroup>
                  <SelectLabel>Markets</SelectLabel>
                  {presets
                    .filter((p) => p.market)
                    .map((p) => (
                      <PresetItem key={p.key} preset={p} />
                    ))}
                </SelectGroup>
                {presets.some((p) => !p.market) && <SelectSeparator />}
              </>
            )}
            {presets
              .filter((p) => !p.market)
              .map((p) => (
                <PresetItem key={p.key} preset={p} />
              ))}
          </SelectContent>
        </Select>
      )}

      {(parsed.errors.length > 0 || parsed.warnings.length > 0) && (
        <ul className="flex flex-col gap-0.5 text-xs">
          {parsed.errors.map((m) => (
            <li key={m} className="text-destructive">
              {m}
            </li>
          ))}
          {parsed.warnings.map((m) => (
            <li key={m} className="text-amber-500 dark:text-amber-400">
              {m}
            </li>
          ))}
        </ul>
      )}

      {!unchanged && parsed.nameservers.length > 0 && (
        <InlineWarning>{NAMESERVER_WARNING}</InlineWarning>
      )}

      {note && <InlineWarning>{note}</InlineWarning>}

      {showActions && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={save}
            disabled={!canSave}
          >
            {saving ? 'Saving…' : saveLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

function PresetItem({ preset }: { preset: NameserverPreset }) {
  return (
    // No room kept for a checkmark: a preset is never the selected value.
    <SelectItem value={preset.key} className="items-start pr-2">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{preset.label}</span>
        {/* Wraps between hosts: a third host (Afternic's NS3) goes to a
            line of its own, and only a host wider than the list breaks
            inside itself. */}
        <span className="flex min-w-0 flex-wrap gap-x-1.5 font-mono text-[12px]">
          {preset.nameservers.map((host, i) => (
            <span key={host} className="min-w-0 [overflow-wrap:anywhere]">
              {host}
              {i < preset.nameservers.length - 1 && ','}
            </span>
          ))}
        </span>
      </span>
    </SelectItem>
  );
}
