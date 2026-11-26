import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * Date-range pages open on TODAY, Asia/Bangkok (owner 2026-11-26, docs/round-shift-today-bundle-replace.md):
 * dashboard, every report tab, bills list, shift history, stock card, P&L, mobile bills. A fresh open is today
 * even after another range was chosen on the previous visit; the presets still work.
 */
test.describe.configure({ mode: 'serial' });

// Bangkok "today" (the browser runs in Asia/Bangkok, the expectation is computed independently here)
const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

async function noSideScroll(page: Page) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    expect(await horizontalOverflow(page), `${page.url()} ${size.width}x${size.height}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
}

test('back-office date ranges open on today; presets still change them', async ({ page }) => {
  test.setTimeout(150_000);
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });

  // dashboard
  const dash = page.waitForRequest((r) => r.url().includes('/api/reports/dashboard?range=today'));
  await page.goto('/dashboard');
  await dash;
  await expect(page.getByRole('button', { name: 'วันนี้', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '7 วันล่าสุด' }).click();
  await expect(page.getByRole('button', { name: '7 วันล่าสุด' })).toHaveAttribute('aria-pressed', 'true');
  await noSideScroll(page);

  // reports: every tab requests today; a range chosen before is not remembered on the next open
  for (const tab of ['sales', 'bestsellers', 'payments', 'customers', 'purchases']) {
    const req = page.waitForRequest((r) => r.url().includes('/api/reports/tabs') && r.url().includes(`tab=${tab}`) && r.url().includes('range=today'));
    await page.goto(`/reports/${tab}`);
    await req;
    await expect(page.getByRole('button', { name: 'วันนี้', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'เดือนนี้', exact: true }).click();
  await expect(page.getByRole('button', { name: 'เดือนนี้', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/reports/sales');
  await expect(page.getByRole('button', { name: 'วันนี้', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await noSideScroll(page);

  // bills list: today in both date boxes, presets
  const bills = page.waitForRequest((r) => r.url().includes('/api/orders?') && r.url().includes(`startDate=${today}`) && r.url().includes(`endDate=${today}`));
  await page.goto('/orders');
  await bills;
  await expect(page.getByLabel('ตั้งแต่วันที่')).toHaveValue(today);
  await expect(page.getByLabel('ถึงวันที่')).toHaveValue(today);
  const presets = page.getByTestId('orders-date-presets');
  await expect(presets.getByRole('button', { name: 'วันนี้' })).toHaveAttribute('aria-pressed', 'true');
  await presets.getByRole('button', { name: 'ทุกวันที่' }).click();
  await expect(page.getByLabel('ตั้งแต่วันที่')).toHaveValue('');
  await presets.getByRole('button', { name: '7 วัน' }).click();
  await expect(page.getByLabel('ถึงวันที่')).toHaveValue(today);
  await expect(presets.getByRole('button', { name: '7 วัน' })).toHaveAttribute('aria-pressed', 'true');
  await noSideScroll(page);

  // shift history
  await page.goto('/shifts');
  await expect(page.getByLabel('ช่วงวันที่')).toHaveValue('TODAY');
  await noSideScroll(page);

  // stock card
  await page.goto('/inventory');
  await page.getByRole('button', { name: /^ประวัติสต็อกการ์ด/ }).first().click();
  await expect(page.getByLabel('ช่วงเวลาความเคลื่อนไหว')).toHaveValue('today');
  await noSideScroll(page);

  // P&L
  await page.goto('/finance?view=pl');
  await expect(page.getByLabel('ตั้งแต่วันที่')).toHaveValue(today);
  await expect(page.getByLabel('ถึงวันที่')).toHaveValue(today);
  await page.getByRole('button', { name: 'เดือนนี้' }).click();
  await expect(page.getByLabel('ตั้งแต่วันที่')).toHaveValue(today.slice(0, 8) + '01');
  await noSideScroll(page);

  // mobile bills tab
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/m');
  await page.getByTestId('tab-bills').click();
  await expect(page.getByTestId('bill-date')).toHaveValue(today);
});
