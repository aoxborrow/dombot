import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import {
  getManualArchives,
  manualArchiveOf,
  setManualArchive,
} from './manual-archive';

beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
});

describe('manual archive marks', () => {
  it('marks names dropped or archived, and clears them', async () => {
    setManualArchive(['A.com', 'b.com'], 'dropped');
    setManualArchive(['b.com'], 'archived');
    await flushWrites();
    expect(getManualArchives()).toEqual({
      'a.com': 'dropped',
      'b.com': 'archived',
    });
    expect(manualArchiveOf('A.com')).toBe('dropped');

    setManualArchive(['a.com'], null);
    await flushWrites();
    expect(manualArchiveOf('a.com')).toBeNull();
    expect(getManualArchives()).toEqual({ 'b.com': 'archived' });
  });
});
