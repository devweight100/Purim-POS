import { defineConfig, devices } from '@playwright/test';

/**
 * Print audit harness (not part of `npm run test:e2e`).
 *
 * Runs against servers that are already up, on a database you can throw away:
 *   PA_FRONTEND=http://127.0.0.1:4431 PA_BACKEND=http://127.0.0.1:4331 PA_OUT=/tmp/print-audit \
 *     npx playwright test -c scripts/print-audit/playwright.config.ts
 *
 * Every document is opened in the app with a stubbed desktop bridge (window.electronAPI.printSilent),
 * so the harness gets the exact HTML the shop's desktop app would print, and renders it the way
 * the printer does (see render.ts). Images land in PA_OUT.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.audit\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: process.env.PA_FRONTEND || 'http://127.0.0.1:4431',
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 768 },
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
