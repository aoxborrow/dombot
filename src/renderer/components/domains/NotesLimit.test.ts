import { describe, expect, it } from 'vitest';
import { NOTES_MAX, notesLimitText } from './NotesLimit';

describe('notesLimitText', () => {
  it('stays quiet until fewer than 500 characters remain', () => {
    expect(notesLimitText(0)).toBeNull();
    expect(notesLimitText(NOTES_MAX - 500)).toBeNull();
    expect(notesLimitText(NOTES_MAX - 499)).toBe('499 left');
  });

  it('names the cap once the box is full', () => {
    expect(notesLimitText(NOTES_MAX)).toBe('4,000 character limit');
    expect(notesLimitText(NOTES_MAX + 20)).toBe('4,000 character limit');
  });
});
