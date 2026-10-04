import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    globals: false,
    passWithNoTests: false,
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
