import { defineConfig } from 'vite';
import path from 'node:path';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      // Dev-time source alias: consume @aoxborrow/registrar-client straight from
      // its TypeScript source in the sibling repo, skipping the build step. Its
      // own runtime deps (e.g. fast-xml-parser) resolve from that package's
      // node_modules since the aliased file lives there. Swap this for the
      // published npm package once the library stabilizes.
      '@aoxborrow/registrar-client': path.resolve(
        process.cwd(),
        '../registrar-client/src/index.ts',
      ),
    },
  },
});
