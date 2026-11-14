import fs from 'node:fs';
import { expect, test, type Response } from '@playwright/test';
import { ADMIN } from './env';
import { uiLogin } from './helpers';

/**
 * Reports page: figures come from the server (GET /api/reports/tabs) for the tab on screen; the
 * browser no longer downloads all orders / claims / debts / shifts to add them up itself.
 */
const isTabs = (tab: string, range: string) => (r: Response) =>
  r.url().includes('/api/reports/tabs') && r.url().includes(`tab=${tab}`) && r.url().includes(`range=${range}`) && r.ok();
const baht = (n: number) => '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: n % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 });

test('reports show the server figures and export them', async ({ page }) => {
  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) apiCalls.push(new URL(r.url()).pathname + new URL(r.url()).search);
  });
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);

  // sales tab, all time: today's shop day (spec 02) is in it
  await page.goto('/reports/sales');
  const allSales = page.waitForResponse(isTabs('sales', 'all'));
  await page.getByRole('button', { name: 'ทั้งหมด', exact: true }).click();
  const sales = await (await allSales).json();
  expect(sales.sales.totalOrders).toBeGreaterThan(0);
  const net = page.getByText('ยอดขายสุทธิ (Net):', { exact: true }).locator('xpath=../..');
  await expect(net).toContainText(baht(sales.sales.totalNetSales));

  // CSV export of the server rows
  const download = page.waitForEvent('download');
  await page.getByTitle('ส่งออกไฟล์ CSV (UTF-8)').click();
  const file = test.info().outputPath('sales.csv');
  await (await download).saveAs(file);
  const csv = fs.readFileSync(file, 'utf8');
  expect(csv).toContain('ยอดขายสุทธิหลังคืนสินค้า (Net)');
  expect(csv.split('\n').length).toBeGreaterThan(sales.sales.dailyBreakdown.length);

  // payments tab: another request, only that tab
  const payments = page.waitForResponse(isTabs('payments', 'all'));
  await page.goto('/reports/payments');
  await page.getByRole('button', { name: 'ทั้งหมด', exact: true }).click();
  const pay = await (await payments).json();
  expect(pay.payments.shifts.totalShiftsCount).toBeGreaterThan(0);
  expect(pay.sales).toBeUndefined();

  // best sellers: one page from the server; the export asks for every page (limit=500)
  const best = page.waitForResponse((r) => isTabs('bestsellers', 'all')(r) && r.url().includes('page=1') && r.url().includes('limit=15'));
  await page.goto('/reports/bestsellers');
  await page.getByRole('button', { name: 'ทั้งหมด', exact: true }).click();
  const bs = await (await best).json();
  expect(bs.bestsellers.productCount).toBeGreaterThan(0);
  expect(bs.bestsellers.allProducts.length).toBe(Math.min(15, bs.bestsellers.total));
  const exportPage = page.waitForResponse((r) => isTabs('bestsellers', 'all')(r) && r.url().includes('limit=500'));
  const download2 = page.waitForEvent('download');
  await page.getByTitle('ส่งออกไฟล์ CSV (UTF-8)').click();
  await exportPage;
  const file2 = test.info().outputPath('bestsellers.csv');
  await (await download2).saveAs(file2);
  expect(fs.readFileSync(file2, 'utf8').trim().split('\n').length).toBe(bs.bestsellers.productCount + 1);

  // no bulk downloads for client-side aggregation any more
  const bulk = apiCalls.filter((u) => /\/api\/(orders|purchase-orders|claims|debts|customers)\?limit=|\/api\/shifts\/history|\/api\/reports\/analytics/.test(u));
  expect(bulk).toEqual([]);
});
