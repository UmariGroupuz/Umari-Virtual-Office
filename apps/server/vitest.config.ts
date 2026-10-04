import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'server',
    environment: 'node',
    pool: 'forks',
    // node:sqlite is experimental on Node 24.12; keep test output free of the ExperimentalWarning.
    execArgv: ['--disable-warning=ExperimentalWarning'],
    globals: false,
    passWithNoTests: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
