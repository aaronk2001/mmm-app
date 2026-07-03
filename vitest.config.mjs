import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    setupFiles: ['./tests/setup.mjs'],
  },
});
