import { describe, expect, it } from 'vitest';
import { importedRows } from '../../shared/imported-domains';
import type { Domain, Folder } from '../../shared/ipc';
import { countFolders, folderBucket, NO_FOLDER } from './folders';

const folder = (id: string): Folder => ({
  id,
  name: id,
  description: '',
  color: 'gray',
});

const rows = (...names: string[]) =>
  importedRows(
    Object.fromEntries(
      names.map((n) => [
        n,
        {
          registrar: null,
          registrarLabel: null,
          createdDate: null,
          expirationDate: null,
          autoRenew: null,
          addedAt: 1,
          updatedAt: null,
        },
      ]),
    ),
    [],
  );

describe('folderBucket', () => {
  const folders = [folder('f1')];
  it('is the folder or None', () => {
    expect(folderBucket('f1', folders)).toBe('f1');
    expect(folderBucket(undefined, folders)).toBe(NO_FOLDER);
  });
  it('treats a deleted folder as None', () => {
    expect(folderBucket('gone', folders)).toBe(NO_FOLDER);
  });
});

describe('countFolders', () => {
  const folders = [folder('f1'), folder('f2')];
  const archivedOf = (names: string[]) => (d: Domain) =>
    names.includes(d.domainName);

  it('counts Archive names apart from Owned ones', () => {
    const counts = countFolders(
      rows('a.com', 'b.com', 'sold.com', 'expired.com', 'none.com'),
      archivedOf(['sold.com', 'expired.com']),
      {
        'a.com': 'f1',
        'b.com': 'f1',
        'sold.com': 'f1',
        'expired.com': 'f2',
      },
      folders,
    );
    expect(counts.owned).toEqual({ f1: 2, [NO_FOLDER]: 1 });
    expect(counts.archive).toEqual({ f1: 1, f2: 1 });
  });

  it('leaves out an assignment for a name with no row', () => {
    const counts = countFolders(
      rows('a.com'),
      () => false,
      { 'a.com': 'f1', 'gone.com': 'f1' },
      folders,
    );
    expect(counts.owned).toEqual({ f1: 1 });
    expect(counts.archive).toEqual({});
  });
});
