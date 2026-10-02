import { useState } from 'react';
import { toAscii, toUnicode } from '../../../shared/domain-name';
import { useAppStore } from '../../store/app';
import { ActionDialog } from '../actions/ActionDialog';
import {
  NOTES_MAX,
  NotesLimit,
  notesNearLimit,
  notesTextareaClass,
} from './NotesLimit';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';

type Mode = 'append' | 'replace';

/**
 * Notes for several names at once. Names keep their own notes, so the text is
 * added to the end of each one's note by default; Replace writes the same note
 * to all of them instead, and Replace with an empty box clears them. The
 * choice only shows when some of the names already have a note.
 */
export function BulkNotesDialog({
  domainNames: given,
  onDone,
  onClose,
}: {
  domainNames: string[];
  onDone?: () => void;
  onClose: () => void;
}) {
  const purchases = useAppStore((s) => s.purchases);
  const saveNotes = useAppStore((s) => s.saveNotes);
  const [mode, setMode] = useState<Mode>('append');
  const [text, setText] = useState('');
  // A name held by two accounts shares one note.
  const domainNames = [...new Set(given.map((n) => toAscii(n)))];

  const noteOf = (name: string) =>
    purchases[toAscii(name)]?.notes?.trim() ?? '';
  const withNotes = domainNames.filter((n) => noteOf(n) !== '').length;
  const draft = text.trim();
  const replacing = mode === 'replace' || withNotes === 0;
  const clearing = replacing && draft === '';

  async function confirm() {
    for (const name of domainNames) {
      const existing = noteOf(name);
      const next =
        replacing || !existing
          ? draft
          : `${existing}\n${draft}`.slice(0, NOTES_MAX);
      if (next !== existing) await saveNotes(name, next);
    }
    onDone?.();
  }

  return (
    <ActionDialog
      title="Notes"
      names={domainNames.map((n) => toUnicode(n))}
      actionLabel={clearing ? 'Clear notes' : 'Save'}
      destructive={clearing}
      // Nothing to add, or nothing to clear.
      disabled={(!replacing && draft === '') || (clearing && withNotes === 0)}
      onConfirm={confirm}
      onClose={onClose}
    >
      {withNotes > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            <span className="tabular-nums text-foreground">{withNotes}</span> of{' '}
            <span className="tabular-nums text-foreground">
              {domainNames.length}
            </span>{' '}
            already have notes
          </p>
          <div
            role="radiogroup"
            aria-label="How to save"
            className="inline-flex w-fit rounded-md border p-0.5"
          >
            {(
              [
                ['append', 'Add to notes'],
                ['replace', 'Replace notes'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  'rounded-[5px] px-3 py-1 text-sm transition-colors',
                  mode === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Textarea
          className={notesTextareaClass}
          value={text}
          maxLength={NOTES_MAX}
          autoFocus
          placeholder={
            replacing
              ? withNotes > 0
                ? 'Leave empty to clear their notes'
                : 'Anything about these names'
              : 'Added on a new line after each note'
          }
          aria-label="Notes"
          aria-describedby={
            notesNearLimit(text.length) ? 'bulk-notes-limit' : undefined
          }
          onChange={(e) => setText(e.target.value)}
        />
        <NotesLimit notes={text} id="bulk-notes-limit" />
      </div>
    </ActionDialog>
  );
}
