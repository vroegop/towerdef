import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', 'tests/visual/__screenshots__'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // The sim/HUD code is deliberately dynamic in places; allow pragmatic escape hatches
      // rather than fighting the type system on a freshly-migrated codebase.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // The code leans on two idioms the default rule flags: short-circuit calls
      // (`handlers.onX && handlers.onX(...)`) and side-effect ternaries in the canvas drawing
      // hot paths (`i ? ctx.lineTo(...) : ctx.moveTo(...)`). Both are intentional.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },
  {
    files: ['tests/**/*.ts', 'tools/**/*.ts', '*.config.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
);
