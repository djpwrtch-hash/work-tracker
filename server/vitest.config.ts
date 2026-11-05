import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 60000,
    hookTimeout: 60000,
    globalSetup: ['./src/test/global-setup.ts'],
    setupFiles: ['./src/test/setup-env.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**', 'dist/**'],
      thresholds: {
        lines: 35,
        functions: 30,
        statements: 35,
        branches: 40,
      },
    },
  },
});
