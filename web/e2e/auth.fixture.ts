import { test as base, expect, type Page } from '@playwright/test';

export const DIRECTOR = { email: 'e2e-director@example.com', password: 'E2ePassword123!' };

/** Logs in through the real form (no storageState fixture) and waits for the dashboard. */
export async function loginAsDirector(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('admin@example.com').fill(DIRECTOR.email);
  await page.getByPlaceholder('••••••••').fill(DIRECTOR.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 20000 });
}

/** Reusable `directorPage`: already logged in. Keeps specs short. */
export const test = base.extend<{ directorPage: Page }>({
  directorPage: async ({ page }, use) => {
    await loginAsDirector(page);
    await use(page);
  },
});

export { expect };
