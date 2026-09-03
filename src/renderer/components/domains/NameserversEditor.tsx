import { useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  onSave: (nameservers: string[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial.join('\n'));
  const parsed = useMemo(() => validateNameservers(text), [text]);
  const unchanged =
    parsed.errors.length === 0 && sameNameservers(parsed.nameservers, initial);
  const canSave = parsed.errors.length === 0 && !unchanged && !saving;

  const save = () => {
    if (canSave) onSave(parsed.nameservers);
  };

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
          <SelectContent>
            {presets.map((p) => (
              <SelectItem
                key={p.key}
                value={p.key}
                title={p.nameservers.join('\n')}
              >
                {p.label}
              </SelectItem>
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
            <li key={m} className="text-amber-600 dark:text-amber-400">
              {m}
            </li>
          ))}
        </ul>
      )}

      {note && (
        <p className="inline-flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {note}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={!canSave}>
          {saving ? 'Saving…' : saveLabel}
        </Button>
      </div>
    </div>
  );
}
