import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_FOLDER_ID,
  DROPPED_FOLDER_ID,
  SOLD_FOLDER_ID,
} from '../../shared/ipc';
import { planFolderMove } from './folder-move';

describe('planFolderMove', () => {
  it('applies a normal folder immediately and ignores a name already there', () => {
    expect(planFolderMove(['f1'], 'f1', [], null)).toEqual({ action: 'noop' });
    expect(planFolderMove([null], 'f1', ['a.com'], 'Clients')).toEqual({
      action: 'apply',
    });
  });

  it('sends Sold to the sale dialog', () => {
    expect(planFolderMove([null], SOLD_FOLDER_ID, ['a.com'], null)).toEqual({
      action: 'sold',
    });
  });

  it('asks before Archive, Dropped, or a return to Owned', () => {
    expect(
      planFolderMove([null], ARCHIVE_FOLDER_ID, ['a.com'], null).action,
    ).toBe('confirm');
    const dropped = planFolderMove(
      [null, null],
      DROPPED_FOLDER_ID,
      ['a.com', 'b.com'],
      null,
    );
    expect(dropped.action).toBe('confirm');
    if (dropped.action === 'confirm') {
      expect(dropped.actionLabel).toBe('Move to Dropped');
    }
    const back = planFolderMove(
      [SOLD_FOLDER_ID],
      'clients',
      ['a.com'],
      'Clients',
    );
    expect(back).toMatchObject({
      action: 'confirm',
      actionLabel: 'Show in Owned',
    });
    if (back.action === 'confirm') {
      expect(back.description).toContain('in Clients');
      expect(back.description).toContain('stay saved');
    }
  });
});
