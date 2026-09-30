import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    setupFiles: ['./tests/setup.mjs'],
    // esbuild parse checks over whole section trees exceed 5s on loaded CI runners.
    testTimeout: 30000,
  },
});
