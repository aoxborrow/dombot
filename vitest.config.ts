import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// Unit-test config for pure-logic modules. Tests import { describe, it, expect }
// from 'vitest' explicitly (globals stay off) so ESLint and tsc need no extra
// ambient types. The '@/' alias mirrors vite.renderer.config.mts.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.mjs'],
    // Live API tests need credentials: `npm run test:live` (vitest.live.config.ts).
    exclude: [...configDefaults.exclude, 'src/**/*.live.test.ts'],
    environment: 'node',
  },
});
