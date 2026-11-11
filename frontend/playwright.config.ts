import { defineConfig, devices } from '@playwright/test';
import { FRONTEND_URL } from './e2e/env';

/**
 * End-to-end tests of the main shop flows (`npm run test:e2e`).
 * The global setup prepares a fresh test database (DATABASE_URL, name must contain "test"),
 * starts the built backend and `next start`, and stops them afterwards. See e2e/env.ts for ports.
 * The specs share one database and run in file order, one at a time.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: FRONTEND_URL,
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 768 },
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    acceptDownloads: true,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
