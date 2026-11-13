import path from 'node:path';
import { expect, test } from '@playwright/test';
import { capturePrint, renderSlip } from './render';
import { ADMIN } from './seed';

/**
 * Slip as a PICTURE (browser printing, and desktop apps older than 1.2.0 that print every job
 * through the Windows driver): a desktop bridge WITHOUT getAppVersion makes the web app send the
 * slip as one <img>. Needs a bill from print.audit.ts (PA_ORDER, default ORD-...0001).
 */
const OUT = process.env.PA_OUT || path.resolve('print-audit-out');

test('old desktop app gets the slip as a picture', async ({ page, browser }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: unknown[]; electronAPI: unknown };
    w.__prints = [];
    w.electronAPI = {
      isDesktop: true,
      printSilent: async (o: unknown) => {
        w.__prints.push(o);
        return { success: true };
      },
    };
  });
  await page.goto('/login');
  await page.locator('#username').fill(ADMIN.username);
  await page.locator('#password').fill(ADMIN.password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/pos/, { timeout: 30_000 });
  const order = process.env.PA_ORDER || (await page.evaluate(() => '')) || '';
  await page.goto('/orders');
  const first = order ? page.getByText(order).first() : page.getByText(/ORD-\d+/).first();
  await first.click();
  await page.getByRole('dialog').last().getByRole('button', { name: /พิมพ์สลิป 80mm/ }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: 'ตัวอย่างใบเสร็จรับเงิน' });
  const job = await capturePrint(page, () => dlg.getByRole('button', { name: /^พิมพ์ใบเสร็จ/ }).click());
  expect(job.html).toMatch(/<img src="data:image\/png;base64,/);
  expect(job.html).not.toContain('ยอดสุทธิ'); // no text left for the driver to replace
  await renderSlip(browser, job.html, OUT, 'picture-slip');
});
