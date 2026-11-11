import { useEffect, useMemo, useState } from 'react';
import {
  REGISTRAR_DEFAULT_OP,
  sameNameservers,
  validateNameservers,
  type NameserverPreset,
  type NameserversOp,
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

/** The Presets entry that switches the editor to the registrar's default. */
const DEFAULT_KEY = 'registrar-default';

/**
 * The nameserver set editor: one host per line (paste-friendly — commas and
 * spaces split too), live validation, and a Presets picker of the portfolio's
 * common sets plus the user's recent saves. Shared by the per-row popover and
 * the bulk dialog; the caller owns the write.
 *
 * With `registrarDefault`, the picker also offers the registrar's own default
 * DNS: picking it swaps the hosts for a "registrar default" choice, saved as
 * a reset (the hosts aren't known up front: Gandi hands out a set per domain).
 *
 * Save is disabled while there are errors, while nothing changed from
 * `initial`, and while `saving`. ⌘/Ctrl+Enter saves.
 */
export function NameserversEditor({
  initial,
  presets,
  registrarDefault,
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
  /** Offer the registrar's default DNS: what it is, and why it can't be
   *  used here (null when it can). Omitted, it isn't offered. */
  registrarDefault?: { description: string; reason: string | null };
  /** An advisory line shown above the buttons (a registrar caveat). */
  note?: string;
  saving?: boolean;
  saveLabel?: string;
  /** Hide the Cancel/Save row (a host dialog supplies its own). */
  showActions?: boolean;
  /** Fires on every edit with the write it would make, or null while
   *  invalid. */
  onChange?: (op: NameserversOp | null) => void;
  onSave?: (op: NameserversOp) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial.join('\n'));
  const [useDefault, setUseDefault] = useState(false);
  const parsed = useMemo(() => validateNameservers(text), [text]);
  const unchanged =
    !useDefault &&
    parsed.errors.length === 0 &&
    sameNameservers(parsed.nameservers, initial);
  const valid = useDefault || parsed.errors.length === 0;
  const canSave = valid && !unchanged && !saving;

  const op: NameserversOp | null = useDefault
    ? REGISTRAR_DEFAULT_OP
    : parsed.errors.length === 0 && parsed.nameservers.length > 0
      ? { kind: 'nameservers', nameservers: parsed.nameservers }
      : null;

  const save = () => {
    if (canSave && op) onSave?.(op);
  };

  useEffect(() => {
    onChange?.(op);
    // Report only when the parse result or the mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, useDefault]);

  const offerDefault = registrarDefault !== undefined;

  return (
    <div className="flex flex-col gap-3">
      {useDefault && registrarDefault ? (
        <div className="flex min-h-24 flex-col items-start gap-1 rounded-md border bg-muted/40 px-3 py-2.5">
          <span className="text-sm font-medium">Registrar default DNS</span>
          <span className="text-xs text-muted-foreground">
            {registrarDefault.description}
          </span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => setUseDefault(false)}
            disabled={saving}
          >
            Enter nameservers instead
          </Button>
        </div>
      ) : (
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
      )}

      {(presets.length > 0 || offerDefault) && (
        <Select
          value=""
          onValueChange={(key) => {
            if (key === DEFAULT_KEY) {
              setUseDefault(true);
              return;
            }
            const preset = presets.find((p) => p.key === key);
            if (preset) {
              setUseDefault(false);
              setText(preset.nameservers.join('\n'));
            }
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
            {registrarDefault && (
              <>
                <SelectItem
                  value={DEFAULT_KEY}
                  disabled={registrarDefault.reason !== null}
                  className="items-start pr-2"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-medium">
                      Registrar default DNS
                    </span>
                    <span className="text-xs whitespace-normal text-muted-foreground">
                      {registrarDefault.reason ?? registrarDefault.description}
                    </span>
                  </span>
                </SelectItem>
                {presets.length > 0 && <SelectSeparator />}
              </>
            )}
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

      {!useDefault &&
        (parsed.errors.length > 0 || parsed.warnings.length > 0) && (
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

      {!unchanged && (useDefault || parsed.nameservers.length > 0) && (
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
