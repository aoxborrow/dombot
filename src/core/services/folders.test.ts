import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { createFolder, getFolders, reorderFolders } from './folders';

beforeEach(async () => {
  await flushWrites();
  configureStore(new MemoryDocStore());
  await hydrateStores();
});

const names = () => getFolders().folders.map((f) => f.name);

describe('reorderFolders', () => {
  it('puts the folders in the given order', () => {
    const [a, b, c] = ['A', 'B', 'C'].map((name) =>
      createFolder({ name, description: '', color: 'blue' }),
    );
    reorderFolders([c.id, a.id, b.id]);
    expect(names()).toEqual(['C', 'A', 'B']);
  });

  it('keeps unlisted folders after, in order, and ignores unknown ids', () => {
    const [a, , c] = ['A', 'B', 'C', 'D'].map((name) =>
      createFolder({ name, description: '', color: 'blue' }),
    );
    reorderFolders(['nope', c.id, a.id]);
    expect(names()).toEqual(['C', 'A', 'B', 'D']);
  });
});
