import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/**',
      'out/**',
      'build/**',
      'coverage/**',
      'public/**/*.js',
      'public/**/*.map',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.mts', '*.mts'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-empty': 'off',
      'no-undef': 'off',
    },
  },
];
