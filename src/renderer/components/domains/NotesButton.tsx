import { useState } from 'react';
import { HoverCard } from 'radix-ui';
import { StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../../store/app';
import {
  NOTES_MAX,
  NotesLimit,
  notesNearLimit,
  notesTextareaClass,
} from './NotesLimit';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverArrow,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';

/**
 * A name's note in a table cell: a sticky-note icon, yellow when there's a
 * note and faint when there isn't. Hovering shows the whole note; clicking
 * opens a small editor that saves the note alone (its purchase and sale stay
 * as they are). ⌘/Ctrl+Enter saves.
 */
export function NotesButton({
  domainName,
  notes,
}: {
  domainName: string;
  notes: string;
}) {
  const saveNotes = useAppStore((s) => s.saveNotes);
  const [editing, setEditing] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [draft, setDraft] = useState(notes);
  const [saving, setSaving] = useState(false);
  const has = notes.trim() !== '';

  const open = (next: boolean) => {
    if (next) setDraft(notes);
    setEditing(next);
    setHovering(false);
  };

  async function save() {
    setSaving(true);
    try {
      await saveNotes(domainName, draft.trim());
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

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
              className={cn(
                'inline-flex size-7 items-center justify-center rounded-md outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-accent/50',
                has
                  ? 'text-yellow-500 dark:text-yellow-400'
                  : 'text-muted-foreground/30 hover:text-muted-foreground',
              )}
            >
              <StickyNote
                className="size-4"
                fill={has ? 'currentColor' : 'none'}
                fillOpacity={has ? 0.2 : 0}
              />
            </button>
          </PopoverTrigger>
        </HoverCard.Trigger>
        <HoverCard.Portal>
          <HoverCard.Content
            side="top"
            sideOffset={6}
            collisionPadding={16}
            className="z-50 max-w-xs rounded-md border bg-popover px-3 py-2 text-sm whitespace-pre-wrap text-popover-foreground shadow-dropdown"
          >
            {notes}
          </HoverCard.Content>
        </HoverCard.Portal>
        <PopoverContent
          side="bottom"
          sideOffset={6}
          collisionPadding={16}
          className="flex w-80 flex-col gap-2 p-3"
          onOpenAutoFocus={(e) => {
            // Focus the textarea, with the caret at the end.
            e.preventDefault();
            const el = (e.currentTarget as HTMLElement).querySelector(
              'textarea',
            );
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
              onClick={() => setEditing(false)}
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
      </Popover>
    </HoverCard.Root>
  );
}
