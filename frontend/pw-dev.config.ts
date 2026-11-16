import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '/home/user/Purim-POS/frontend/e2e',
  workers: 1, retries: 0, timeout: 120_000, expect: { timeout: 15_000 }, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4490', ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok', screenshot: 'only-on-failure' },
});
