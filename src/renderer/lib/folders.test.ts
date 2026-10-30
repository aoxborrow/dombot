import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../../shared/domain-events';
import { importedRows } from '../../shared/imported-domains';
import type { Folder } from '../../shared/ipc';
import { HIDDEN_FOLDER_ID } from '../../shared/ipc';
import { ownershipByDomain } from '../../shared/ownership';
import { countFolders, folderBucket, NO_FOLDER } from './folders';

const folder = (id: string): Folder => ({
  id,
  name: id,
  description: '',
  color: 'gray',
});

const event = (
  id: string,
  domain: string,
  type: DomainEvent['type'],
): DomainEvent => ({
  id,
  domain,
  type,
  source: 'user',
  date: '2026-10-01',
  createdAt: 1,
  updatedAt: null,
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
  it('is the folder, Hidden, or None', () => {
    expect(folderBucket('f1', folders)).toBe('f1');
    expect(folderBucket(HIDDEN_FOLDER_ID, folders)).toBe(HIDDEN_FOLDER_ID);
    expect(folderBucket(undefined, folders)).toBe(NO_FOLDER);
  });
  it('treats a deleted folder as None', () => {
    expect(folderBucket('gone', folders)).toBe(NO_FOLDER);
  });
});

describe('countFolders', () => {
  const folders = [folder('f1'), folder('f2')];

  it('counts Archive names apart from Owned ones', () => {
    const ownership = ownershipByDomain([
      event('E1', 'sold.com', 'sold'),
      event('E2', 'dropped.com', 'dropped'),
    ]);
    const counts = countFolders(
      rows('a.com', 'b.com', 'sold.com', 'dropped.com', 'none.com'),
      ownership,
      {
        'a.com': 'f1',
        'b.com': 'f1',
        'sold.com': 'f1',
        'dropped.com': 'f2',
      },
      folders,
    );
    expect(counts.owned).toEqual({ f1: 2, [NO_FOLDER]: 1 });
    expect(counts.archive).toEqual({ f1: 1, f2: 1 });
  });

  it('leaves out an assignment for a name with no row', () => {
    const counts = countFolders(
      rows('a.com'),
      new Map(),
      { 'a.com': 'f1', 'gone.com': 'f1' },
      folders,
    );
    expect(counts.owned).toEqual({ f1: 1 });
    expect(counts.archive).toEqual({});
  });

  it('counts a name moved back to Owned as Owned', () => {
    const ownership = ownershipByDomain([
      event('E1', 'a.com', 'sold'),
      event('E2', 'a.com', 'added'),
    ]);
    const counts = countFolders(
      rows('a.com'),
      ownership,
      { 'a.com': 'f2' },
      folders,
    );
    expect(counts.owned).toEqual({ f2: 1 });
  });
});
