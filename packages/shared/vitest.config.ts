import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'shared',
    environment: 'node',
    globals: false,
    passWithNoTests: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
