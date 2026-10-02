import { useState } from 'react';
import { HoverCard } from 'radix-ui';
import { toast } from 'sonner';
import { useAppStore } from '../../store/app';
import {
  NOTES_MAX,
  NotesLimit,
  notesNearLimit,
  notesTextareaClass,
} from './NotesLimit';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverArrow,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { StickyNoteIcon } from '../icons/StickyNoteIcon';

/**
 * A name's note, beside the row's "⋯" menu: a sticky-note icon, bright when
 * there's a note. Without one it stays hidden until the row is hovered (or
 * the editor is open), to keep the table quiet. Hovering shows the whole
 * note; clicking opens a small editor that saves the note alone (its purchase
 * and sale stay as they are). The row menu's "Notes…" opens the same editor
 * through `editing`. ⌘/Ctrl+Enter saves.
 */
export function NotesButton({
  domainName,
  notes,
  editing,
  onEditingChange,
}: {
  domainName: string;
  notes: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const saveNotes = useAppStore((s) => s.saveNotes);
  const [hovering, setHovering] = useState(false);
  const [draft, setDraft] = useState(notes);
  const [saving, setSaving] = useState(false);
  const has = notes.trim() !== '';

  // Start each edit from the saved note, however the editor was opened.
  const [wasEditing, setWasEditing] = useState(editing);
  if (editing !== wasEditing) {
    setWasEditing(editing);
    if (editing) setDraft(notes);
  }

  const open = (next: boolean) => {
    onEditingChange(next);
    setHovering(false);
  };

  async function save() {
    setSaving(true);
    try {
      await saveNotes(domainName, draft.trim());
      onEditingChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  const editor = () => (
    <PopoverContent
      side="bottom"
      sideOffset={6}
      collisionPadding={16}
      className="flex w-80 flex-col gap-2 p-3"
      // The row menu hands focus back to its trigger as it closes, just
      // after this opens; don't let that count as leaving the editor.
      onFocusOutside={(e) => e.preventDefault()}
      onOpenAutoFocus={(e) => {
        // Focus the textarea, with the caret at the end.
        e.preventDefault();
        const el = (e.currentTarget as HTMLElement).querySelector('textarea');
        el?.focus();
        el?.setSelectionRange(el.value.length, el.value.length);
      }}
    >
      <PopoverArrow />
      <p className="text-sm font-medium">Notes</p>
      <Textarea
        className={notesTextareaClass}
        value={draft}
        maxLength={NOTES_MAX}
        placeholder="Anything about this name"
        aria-label={`Notes for ${domainName}`}
        aria-describedby={
          notesNearLimit(draft.length) ? 'notes-popover-limit' : undefined
        }
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <NotesLimit notes={draft} id="notes-popover-limit" />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={saving}
          onClick={() => onEditingChange(false)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={saving || draft.trim() === notes.trim()}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
    </PopoverContent>
  );

  return (
    <HoverCard.Root
      open={has && hovering && !editing}
      onOpenChange={setHovering}
      openDelay={200}
      closeDelay={100}
    >
      <Popover open={editing} onOpenChange={open}>
        <HoverCard.Trigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${has ? 'Edit' : 'Add'} notes for ${domainName}`}
              title={has ? undefined : 'Add notes'}
              // Sized like the "⋯" beside it (a little narrower than a square
              // so the two sit snug). Without a note it shows only on row
              // hover, keyboard focus, or while its editor is open.
              className={cn(
                '-my-2 inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 compact:h-7 compact:w-6 dark:hover:bg-accent/50',
                has
                  ? 'text-foreground/55 hover:text-foreground dark:text-foreground/70 dark:hover:text-foreground'
                  : 'text-foreground/40 opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100',
              )}
            >
              <StickyNoteIcon className="size-4" />
            </button>
          </PopoverTrigger>
        </HoverCard.Trigger>
        <HoverCard.Portal>
          {/* A light shadow: the menus' heavy drop shadow would spill down
              over the icon just below and dim it. */}
          <HoverCard.Content
            side="top"
            sideOffset={6}
            collisionPadding={16}
            className="z-50 max-w-xs rounded-md border bg-popover px-3 py-2 text-sm whitespace-pre-wrap text-popover-foreground shadow-md"
          >
            {notes}
          </HoverCard.Content>
        </HoverCard.Portal>
        {editor()}
      </Popover>
    </HoverCard.Root>
  );
}
