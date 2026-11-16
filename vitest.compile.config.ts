import { defineConfig } from 'vitest/config';

/** Real toolchain compiles of the golden sketches (slow; run with `npm run test:compile`). */
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.compile.ts'],
    environment: 'node',
    testTimeout: 240_000,
    fileParallelism: false,
  },
});
