import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60000,
  // E2E runs on its own ports so it never collides with the real app on 42780.
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:42790',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev -w server',
      url: 'http://localhost:42791/health',
      reuseExistingServer: false,
      timeout: 120000,
      cwd: '..',
      env: {
        DATABASE_URL: '',
        MYSQL_DATABASE: 'hr_test',
        TEST_DB_NAME: 'hr_test',
        NODE_ENV: 'test',
        PORT: '42791',
        SERVE_STATIC: 'false',
      },
    },
    {
      command: 'npm run dev -w web',
      url: 'http://localhost:42790/login',
      reuseExistingServer: false,
      timeout: 180000,
      cwd: '..',
      env: {
        WEB_PORT: '42790',
        VITE_API_PORT: '42791',
      },
    },
  ],
});
