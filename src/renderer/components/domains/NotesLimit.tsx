/** Same cap as the purchase service and the API schema. */
export const NOTES_MAX = 4000;

/**
 * Long notes scroll inside the box. The shared textarea grows with its text,
 * which pushes Save off the modal.
 */
export const notesTextareaClass = 'max-h-40 resize-none overflow-y-auto';

/** Stay quiet until the note is this close to the cap. */
const SHOW_WITHIN = 500;

/** Text under the notes box, or nothing while plenty of room remains. */
export function notesLimitText(length: number): string | null {
  const left = NOTES_MAX - length;
  if (left >= SHOW_WITHIN) return null;
  if (left <= 0) return '4,000 character limit';
  return `${left} left`;
}

export function notesNearLimit(length: number): boolean {
  return notesLimitText(length) !== null;
}

export function NotesLimit({ notes, id }: { notes: string; id: string }) {
  const text = notesLimitText(notes.length);
  if (!text) return null;
  return (
    <p id={id} className="text-xs text-muted-foreground">
      {text}
    </p>
  );
}
