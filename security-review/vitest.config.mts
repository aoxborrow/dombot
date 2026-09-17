import { defineConfig } from 'vitest/config';

// Local audit regressions, kept separate from the normal application suite.
export default defineConfig({
  test: {
    include: ['security-review/reproductions.test.ts'],
    environment: 'node',
  },
});
