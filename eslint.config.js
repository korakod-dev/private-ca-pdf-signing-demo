// ESLint flat config.
// Besides the usual TS/React/a11y rules it enforces three architecture rules from the plan:
//   1. UI boundary   : UI folders may not import mocks/engine/fixtures (UI must not know it talks to a mock).
//   2. Engine purity : src/engine must be deterministic (no wall clock, randomness or browser globals).
//   3. Upload safety : uploaded files are never read (no FileReader, no File.arrayBuffer/text/stream in pages).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Globals that must not appear in the pure engine.
const ENGINE_BANNED_GLOBALS = ['window', 'localStorage', 'fetch', 'crypto', 'document'].map((name) => ({
  name,
  message: 'src/engine must stay pure: no browser globals. Inject dependencies instead.',
}));

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'node_modules', 'cypress/videos', 'cypress/screenshots', 'public/mockServiceWorker.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Upload safety (global part): never use FileReader anywhere in the app.
      'no-restricted-globals': [
        'error',
        { name: 'FileReader', message: 'Uploaded files are never read (spec section 5).' },
      ],
    },
  },
  // React (hooks + a11y) for UI code.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  // Node-side tooling.
  {
    files: ['*.config.{js,ts}', 'scripts/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  // 1. UI boundary.
  {
    files: ['src/{app,pages,components,store,terminal}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Matches .../mocks, .../engine, .../fixtures (and anything below), but not src/contracts/fixtures.
              regex: '^(?!.*/contracts/)(.*/)?(mocks|engine|fixtures)(/.*)?$',
              message: 'UI code must not import src/mocks, src/engine or src/fixtures. Use src/api and src/contracts.',
            },
          ],
        },
      ],
    },
  },
  // 2. Engine purity.
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...ENGINE_BANNED_GLOBALS, { name: 'FileReader', message: 'Not allowed.' }],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Engine is pure: take time from the injected Clock.' },
        { object: 'Math', property: 'random', message: 'Engine is pure: derive ids deterministically.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Engine is pure: new Date() without arguments reads the wall clock.',
        },
      ],
    },
  },
  // 3. Upload safety (pages): never read file contents.
  {
    files: ['src/pages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name=/^(arrayBuffer|stream|text)$/]",
          message: 'Uploaded files are never read (spec section 5). Do not call File.arrayBuffer/stream/text.',
        },
      ],
    },
  },
);
