import { beforeAll, describe, expect, it } from 'vitest';
import { createAtomAdapter } from './atom';

// The adapter against the real API, read-only (`npm run test:live`). Skips
// unless ATOM_API_TOKEN and ATOM_USER_ID are set. Never run yet
// (docs/atom-api.md, "Unverified").

const credentials = {
  apiToken: process.env.ATOM_API_TOKEN,
  userId: process.env.ATOM_USER_ID,
};
const configured = Object.values(credentials).every(Boolean);

describe.skipIf(!configured)('Atom adapter (live)', () => {
  // Built in beforeAll: a suite that skips still runs this body.
  let atom: ReturnType<typeof createAtomAdapter>;
  beforeAll(() => {
    atom = createAtomAdapter('live-test', credentials, {
      userAgent: 'DomBot-live-tests/1.0',
    });
  });

  it('tests the connection', async () => {
    const result = await atom.test();
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('maps every listing into the shared shape, with known statuses', async () => {
    const { listings } = await atom.allListings();
    for (const l of listings) {
      expect(l.market).toBe('atom');
      expect(l.currency).toBe('USD');
      expect(l.tier).not.toBeNull();
      // An unknown status means Atom uses a word statusFromAtom doesn't know.
      expect([l.name, l.status]).not.toEqual([l.name, 'unknown']);
    }
  });

  it('maps sales', async () => {
    for (const s of await atom.allSales()) {
      expect(s.market).toBe('atom');
      expect(s.status).not.toBe('unknown');
    }
  });
});
