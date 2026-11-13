import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Request } from '@playwright/test';
import { ADMIN, FRONTEND_URL } from './env';
import { api, apiLogin, uiLogin } from './helpers';

/**
 * Mobile summary page (/m) on an iPhone-sized screen: the owner logs in from a phone and lands on
 * /m; sales = the back-office figures; stock search with pack breakdown and prices; bills with a
 * read-only detail; nothing on /m writes to the server; no sideways scrolling at 360 px.
 * Uses DRK-001 (imported by 03-product-import.spec.ts: 1 ลัง = 2 แพ็ค = 12 ขวด) and makes its own sale.
 */
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const SHOT_DIR = process.env.E2E_MOBILE_SHOTS || '';
const baht = (n: number) => '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: n % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 });

interface LookupRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  prices: (number | null)[];
  packs: { name: string; factor: number; prices: (number | null)[] }[];
  costPrice?: number;
}
interface Dashboard {
  sales: { netSales: number; completedCount: number };
}

let token = '';
let product: LookupRow;
let orderNumber = '';

async function shot(page: Page, name: string, fullPage = false) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage });
}

/** "88 ขวด = 7 ลัง 4 ขวด" for DRK-001 (ลัง = 12, แพ็ค = 6). */
function drkStockText(stock: number) {
  const cases = Math.floor(stock / 12);
  const packs = Math.floor((stock % 12) / 6);
  const bottles = stock % 6;
  const parts = [cases && `${cases} ลัง`, packs && `${packs} แพ็ค`, bottles && `${bottles} ขวด`].filter(Boolean);
  return stock >= 6 ? `${stock} ขวด = ${parts.join(' ')}` : `${stock} ขวด`;
}

test.beforeAll(async () => {
  token = await apiLogin(ADMIN);
  const found = await api<{ data: LookupRow[] }>('GET', '/products/lookup?q=DRK-001', token);
  product = found.data.find((p) => p.sku === 'DRK-001')!;
  if (!product) throw new Error('DRK-001 missing (run 03-product-import.spec.ts first)');
  // a sale today on an admin shift (left open: the "more" tab shows it)
  let shiftId = '';
  try {
    const opened = await api<{ shift: { id: string } }>('POST', '/shifts/open', token, { startingCash: 500, terminalId: 'e2e-mobile' });
    shiftId = opened.shift.id;
  } catch {
    const cur = await api<{ shift?: { id: string } } | null>('GET', '/shifts/current?terminalId=e2e-mobile', token);
    shiftId = cur?.shift?.id || '';
  }
  const price = Number(product.prices[0]);
  const order = await api<{ orderNumber: string }>('POST', '/orders/checkout', token, {
    clientOrderId: randomUUID(),
    shiftId,
    items: [{ productId: product.id, quantity: 2, unitPrice: price }],
    payments: [{ method: 'CASH', amount: price * 2 }],
  });
  orderNumber = order.orderNumber;
  product = (await api<{ data: LookupRow[] }>('GET', '/products/lookup?q=DRK-001', token)).data.find((p) => p.sku === 'DRK-001')!;
});

test('owner on a phone: sales, stock, bills, more; read-only; fits 360 px', async ({ page }) => {
  const writes: string[] = [];
  const onRequest = (r: Request) => {
    if (r.url().includes('/api/') && r.method() !== 'GET' && new URL(page.url()).pathname === '/m') writes.push(`${r.method()} ${r.url()}`);
  };

  // login on a phone -> /m (desktop keeps /pos: 01-04)
  const firstDash = page.waitForResponse((r) => r.url().includes('/api/reports/dashboard?range=today') && r.ok());
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/m$/);
  page.on('request', onRequest);
  const shown = (await (await firstDash).json()) as Dashboard;

  // sales: the same figures as the back office (dashboard + reports page) for today
  const backOffice = await api<Dashboard>('GET', '/reports/dashboard?range=today', token);
  const reports = await api<{ sales: { totalNetSales: number; totalOrders: number } }>('GET', '/reports/tabs?range=today&tab=sales', token);
  expect(shown.sales.netSales).toBe(backOffice.sales.netSales);
  expect(backOffice.sales.netSales).toBe(reports.sales.totalNetSales);
  expect(backOffice.sales.netSales).toBeGreaterThan(0);
  await expect(page.getByTestId('net-sales')).toHaveText(baht(backOffice.sales.netSales));
  await expect(page.getByTestId('bill-count')).toHaveText(backOffice.sales.completedCount.toLocaleString('th-TH'));
  await expect(page.getByTestId('top-products')).toContainText(product.name);
  await expect(page.getByTestId('sales-chart')).toBeVisible();
  await shot(page, '1-sales');
  await shot(page, '1-sales-full', true);

  // another period: one request for it, chip state follows
  const week = page.waitForResponse((r) => r.url().includes('/api/reports/dashboard?range=7days') && r.ok());
  await page.getByTestId('range-7days').click();
  const weekData = (await (await week).json()) as Dashboard;
  await expect(page.getByTestId('net-sales')).toHaveText(baht(weekData.sales.netSales));
  await expect(page.getByTestId('range-7days')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('range-today').click();
  await expect(page.getByTestId('net-sales')).toHaveText(baht(backOffice.sales.netSales));

  // stock / prices: search by code, pack breakdown, price levels per unit, cost for the admin
  await page.getByTestId('tab-stock').click();
  await page.getByTestId('stock-search').fill('DRK-001');
  const card = page.getByTestId('stock-card').filter({ hasText: product.name });
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('stock-text')).toHaveText(drkStockText(product.stock));
  expect(drkStockText(product.stock)).toContain('ลัง');
  for (const p of [product.prices[0], ...product.packs.map((u) => u.prices[0])]) {
    if (p !== null) await expect(card).toContainText(Number(p).toLocaleString('th-TH', { maximumFractionDigits: 2 }));
  }
  await expect(card).toContainText('แพ็ค');
  await expect(card).toContainText('= 12 ขวด');
  await expect(card.getByTestId('stock-cost')).toBeVisible();
  // Thai name search finds it too
  const thai = page.waitForResponse((r) => r.url().includes(`/api/products/lookup?q=${encodeURIComponent('น้ำดื่ม')}&`) && r.ok());
  await page.getByTestId('stock-search').fill('น้ำดื่ม');
  const thaiHits = (await (await thai).json()) as { meta: { total: number } };
  expect(thaiHits.meta.total).toBeLessThan(5);
  await expect(page.getByTestId('stock-card')).toHaveCount(thaiHits.meta.total);
  await expect(page.getByTestId('stock-card').filter({ hasText: 'DRK-001' })).toHaveCount(1);
  await shot(page, '2-stock');

  // bills: newest first, detail is read-only
  await page.getByTestId('tab-bills').click();
  const first = page.getByTestId('bill-row').first();
  await expect(first).toContainText(orderNumber);
  await shot(page, '3-bills');
  await page.getByTestId('bill-search').fill(orderNumber);
  await expect(page.getByTestId('bill-row')).toHaveCount(1);
  await page.getByTestId('bill-row').first().click();
  const detail = page.getByTestId('bill-detail');
  await expect(detail).toContainText(orderNumber);
  await expect(detail.getByTestId('bill-items')).toContainText(product.name);
  await expect(detail.getByTestId('bill-payments')).toContainText('เงินสด');
  await expect(detail.getByTestId('bill-status')).toHaveText('สำเร็จ');
  await expect(detail.getByRole('button', { name: /ยกเลิกบิล|คืนสินค้า|แก้ไข|พิมพ์/ })).toHaveCount(0);
  await shot(page, '4-bill-detail');
  await detail.getByRole('button', { name: 'กลับ' }).click();
  await expect(detail).toBeHidden();
  await expect(page).toHaveURL(/\/m$/);

  // more: open shift with expected cash, receivables, back office link
  await page.getByTestId('tab-more').click();
  await expect(page.getByTestId('open-shift').first()).toBeVisible();
  await expect(page.getByTestId('receivables')).toHaveText(/฿/);
  await expect(page.getByRole('link', { name: 'เปิดหน้าจัดการเต็ม' })).toHaveAttribute('href', '/dashboard');
  await shot(page, '5-more');

  // refresh button reloads the active tab
  const again = page.waitForResponse((r) => r.url().includes('/api/shifts/history') && r.ok());
  await page.getByTestId('mobile-refresh').click();
  await again;

  // 360 px: no sideways scrolling on any tab
  await page.setViewportSize({ width: 360, height: 740 });
  for (const tab of ['sales', 'stock', 'bills', 'more']) {
    await page.getByTestId(`tab-${tab}`).click();
    await page.waitForTimeout(300);
    const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.body.scrollWidth]);
    expect({ tab, widths }).toEqual({ tab, widths: [360, 360] });
  }

  // nothing on /m wrote to the server
  expect(writes).toEqual([]);
});

test('desktop browsers still land on the POS', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: FRONTEND_URL, viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await ctx.close();
});
