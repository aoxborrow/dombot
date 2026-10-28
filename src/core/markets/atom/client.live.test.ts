import { beforeAll, describe, expect, it } from 'vitest';
import { AtomClient } from './client';
import { AtomError } from './errors';

// Atom's seller API, read-only (`npm run test:live`). Skips unless
// ATOM_API_TOKEN and ATOM_USER_ID are set. Never run yet: written before
// there was a key (docs/atom-api.md, "Unverified"). Each test also checks a
// guess the client makes, so a failure says which one was wrong.
//
// Appraisal isn't called here: it's capped at 10 a day per account.

const apiToken = process.env.ATOM_API_TOKEN;
const userId = process.env.ATOM_USER_ID;

describe.skipIf(!apiToken || !userId)('Atom client (live, read-only)', () => {
  // Built in beforeAll: a suite that skips still runs this body.
  let atom: AtomClient;
  beforeAll(() => {
    atom = new AtomClient({
      apiToken: apiToken ?? '',
      userId: userId ?? '',
      userAgent: 'DomBot-live-tests/1.0',
    });
  });

  it('rejects a wrong token with a body, not a status', async () => {
    const wrong = new AtomClient({
      apiToken: 'not-a-token',
      userId: userId ?? '',
      userAgent: 'DomBot-live-tests/1.0',
    });
    const error = await wrong.listListings({ limit: 1 }).catch((e) => e);
    expect(error).toBeInstanceOf(AtomError);
    expect(error.code).toBe('AUTH');
    expect(String(error.message)).not.toContain(apiToken);
  });

  it('lists a page of listings with names and statuses', async () => {
    const page = await atom.listListings({ limit: 5 });
    for (const l of page.items) {
      expect(l.name).toMatch(/\./);
      expect(typeof l.status).toBe('string');
    }
  });

  it('walks every listing without repeats', async () => {
    const { listings, complete } = await atom.allListings();
    expect(complete).toBe(true);
    expect(new Set(listings.map((l) => l.name)).size).toBe(listings.length);
  });

  it('reads one listing’s details', async () => {
    const [first] = (await atom.listListings({ limit: 1 })).items;
    if (!first) return;
    const details = await atom.getListing(first.name);
    expect(details?.name).toBe(first.name);
  });

  it('reads sales', async () => {
    for (const s of await atom.allSales()) {
      expect(s.name).toMatch(/\./);
      if (s.soldOn) expect(s.soldOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('reads one name’s analytics', async () => {
    const [first] = (await atom.listListings({ limit: 1 })).items;
    if (!first) return;
    const a = await atom.getAnalytics(first.name);
    expect(a.name).toBe(first.name);
  });

  it('reads categories, syndication and grading results', async () => {
    expect((await atom.listPrimaryCategories()).length).toBeGreaterThan(0);
    await atom.allSyndicationAuthorized();
    await atom.getGradingResults({ size: 5 });
  });
});
