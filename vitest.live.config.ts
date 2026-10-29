import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Live tests against real third-party APIs (`*.live.test.ts`), run with
// `npm run test:live`. Kept out of `npm test` and CI: they need real
// credentials and some write to a real account. Credentials come from the
// nearest .env up the tree (a worktree has none of its own); a test whose
// credentials are missing skips itself.
for (let dir = process.cwd(); ; dir = dirname(dir)) {
  const file = join(dir, '.env');
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
  if (dir === dirname(dir)) break;
}

export default defineConfig({
  test: {
    include: ['src/**/*.live.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // One account's rate limit is shared, so run files one at a time.
    fileParallelism: false,
  },
});
