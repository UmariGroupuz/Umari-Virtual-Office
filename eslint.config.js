// ESLint 9 flat config for the whole monorepo (TASK-001; boundaries: API_CONTRACTS §5 and §10.1, ADR-025).
import { builtinModules } from 'node:module';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];
const JS_FILES = ['**/*.{js,mjs,cjs}'];

/** Shell modules of apps/web that the Phaser office must not import (API_CONTRACTS §10.1). */
const SHELL_MODULES = [
  'store',
  'api',
  'socket',
  'components',
  'layout',
  'agents',
  'activity',
  'simulator',
  'dashboard',
];

/** Directory depths below src/office/ that get their own boundary block (0 = files directly in office/). */
const OFFICE_DEPTHS = [0, 1, 2, 3, 4, 5];
const OFFICE_BOUNDARY_MESSAGE = `src/office/** may not import shell modules (${SHELL_MODULES.join(', ')}) — use OfficeCanvas props (ADR-025).`;

const NODE_BUILTINS = [
  ...new Set(builtinModules.filter((m) => !m.startsWith('_')).map((m) => m.replace(/^node:/, ''))),
];

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    '**/.vite/',
    'data/',
    'docs/',
    'tasks/',
    'logs/',
  ]),

  // Base rules for every file.
  js.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },

  // TypeScript: type-aware rules via the project service (each workspace tsconfig.json).
  {
    files: TS_FILES,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Plain JS files (eslint.config.js, scripts/*.mjs) are not part of any tsconfig: no type-aware rules.
  {
    files: JS_FILES,
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },

  // Node environments: server, shared, every workspace's config files, scripts.
  {
    files: [
      'apps/server/**/*.ts',
      'packages/shared/**/*.ts',
      '**/vite.config.ts',
      '**/vitest.config.ts',
      'scripts/**',
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  // @vo/shared is platform-neutral (API_CONTRACTS §5, ADR-002): no Node, DOM or framework imports.
  {
    files: ['packages/shared/src/**/*.ts', 'packages/shared/test/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...NODE_BUILTINS.map((name) => ({
              name,
              message: '@vo/shared must be platform-neutral: no Node built-ins.',
            })),
          ],
          patterns: [
            {
              group: ['node:*'],
              message: '@vo/shared must be platform-neutral: no node:* imports.',
            },
            {
              group: [
                'express',
                'express/*',
                'react',
                'react/*',
                'react-dom',
                'react-dom/*',
                'phaser',
                'phaser/*',
                'socket.io',
                'socket.io/*',
                'socket.io-*',
                '@vo/server',
                '@vo/server/*',
                '@vo/web',
                '@vo/web/*',
              ],
              message:
                '@vo/shared may not import express, react, phaser, socket.io* or the apps (only zod).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'localStorage', 'sessionStorage'].map((name) => ({
          name,
          message: '@vo/shared must not use DOM globals (ADR-002).',
        })),
        ...['process', 'Buffer', '__dirname', '__filename', 'require', 'module', 'global'].map(
          (name) => ({ name, message: '@vo/shared must not use Node globals (ADR-002).' }),
        ),
      ],
    },
  },

  // apps/web: browser globals, React hooks, React Refresh, no raw HTML injection.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/vite.config.ts', 'apps/web/vitest.config.ts'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            'dangerouslySetInnerHTML is banned: render producer text as plain text (REQ-163).',
        },
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message:
            'dangerouslySetInnerHTML is banned: render producer text as plain text (REQ-163).',
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['apps/web/src/**/*.test.tsx'],
    extends: [reactRefresh.configs.vite],
  },

  // Shell (apps/web outside src/office): no phaser; from office/ only the OfficeCanvas seam (lazy).
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/office/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['phaser', 'phaser/*'],
              message: 'Only apps/web/src/office/** may import phaser (ADR-025).',
            },
            {
              regex: '(^|/)office/(?!OfficeCanvas(\\.tsx)?$)',
              message: 'Outside src/office/** import only office/OfficeCanvas (ADR-025).',
            },
          ],
        },
      ],
    },
  },

  // Office (apps/web/src/office/**): phaser allowed; no imports of shell modules. One block per directory
  // depth so that `../X` is only flagged when it really leaves office/ (e.g. `office/objects/A.ts` may import
  // `../layout` = office/layout, while `office/A.ts` may not import `../layout` = src/layout).
  ...OFFICE_DEPTHS.map((depth) => ({
    files: [`apps/web/src/office/${'*/'.repeat(depth)}*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: `^(\\.\\./){${depth + 1}}(${SHELL_MODULES.join('|')})(/|$)`,
              message: OFFICE_BOUNDARY_MESSAGE,
            },
            {
              regex: `^(\\.\\./){${depth + 2},}(.*/)?src/(${SHELL_MODULES.join('|')})(/|$)`,
              message: OFFICE_BOUNDARY_MESSAGE,
            },
          ],
        },
      ],
    },
  })),

  // Tests: supertest/Testing Library values are untyped (`any`); assertions check their shape (CR-15).
  {
    files: ['**/*.test.{ts,tsx}', 'apps/server/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Must be last: turn off stylistic rules that conflict with Prettier.
  prettier,
]);
