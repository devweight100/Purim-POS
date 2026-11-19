import { expect, test, type Browser, type BrowserContext, type Page, type Request } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, scan, uiLogin } from './helpers';

/**
 * Task 8 (perf round 2): the POS catalogue / customer list / offline copy are kept only where they are needed.
 * - a back-office-only browser (never sold here) releases them when it leaves the POS: no catalogue or customer
 *   requests on the products page for 60 s;
 * - the POS still loads, scans and sells; selling here makes the browser a selling device, which keeps the data warm
 *   on back-office screens and sells offline;
 * - back office -> POS -> back office works on a back-office device.
 */
test.describe.configure({ mode: 'serial' });

const TAG = Date.now().toString(36).slice(-5);
const ITEM = { name: `ข้อมูลหน้าขาย ${TAG}`, barcode: `77${Date.now().toString().slice(-10)}`, price: 35 };
let token = '';
let productId = '';

/** catalogue / customer-list downloads (full or delta) */
const isPosData = (r: Request) => /\/api\/(products\/sync|customers\/sync)(\?|$)|\/api\/products(\?|$)/.test(r.url());

async function newBrowserPage(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  return { ctx, page };
}

/** In-app navigation (sidebar links use the same router; no full page load). */
async function goInApp(page: Page, path: string) {
  await page.evaluate((p) => (window as unknown as { next: { router: { push: (p: string) => void } } }).next.router.push(p), path);
  await expect(page).toHaveURL(new RegExp(path.replace('/', '\\/') + '(\\?|$)'));
}

async function openShiftIfAsked(page: Page) {
  const dlg = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  if (await dlg.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
    await dlg.getByLabel('ยอดเงินรวมในลิ้นชัก').fill('500');
    await dlg.getByRole('button', { name: 'ตกลง' }).click();
    await expect(dlg).toBeHidden();
  }
}

async function payCash(page: Page, expectText: string) {
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  const pay = page.getByRole('dialog');
  await expect(pay).toContainText(`฿${ITEM.price}`);
  await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
  await pay.getByRole('button', { name: '฿100', exact: true }).click();
  await pay.getByRole('button', { name: 'ยืนยันรับเงินสด' }).click();
  await expect(pay).toContainText(expectText);
  await page.getByRole('button', { name: 'ปิดหน้าต่าง (เริ่มออเดอร์ใหม่)' }).click({ timeout: 3000 }).catch(() => undefined);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** bills (newest 100) that sold the test product */
const ordersOfItem = async () =>
  (await api<{ data: { items: { productId: string }[] }[] }>('GET', '/orders?limit=100', token)).data.filter((o) => o.items.some((i) => i.productId === productId)).length;

test.beforeAll(async () => {
  token = await apiLogin(ADMIN);
  const p = await api<{ id: string }>('POST', '/products', token, { name: ITEM.name, basePrice: ITEM.price, priceLevel1: ITEM.price, unit: 'ชิ้น', barcodes: [ITEM.barcode] });
  productId = p.id;
  await api('POST', '/inventory/adjust', token, { productId: p.id, type: 'SET', amount: 50, reason: 'ยอดยกมา' });
  const cur = await api<{ id?: string; isOpen?: boolean } | null>('GET', '/shifts/current', token).catch(() => null);
  if (!cur?.id) await api('POST', '/shifts/open', token, { startingCash: 0, terminalId: `e2e-posdata-${TAG}` });
});

test('back-office-only browser: leaving the POS stops catalogue / customer downloads (60 s on the products page)', async ({ browser }) => {
  test.setTimeout(150_000);
  const { ctx, page } = await newBrowserPage(browser);
  // the POS itself still loads both lists
  await expect(page.getByText(ITEM.name).first()).toBeVisible({ timeout: 30_000 });
  await goInApp(page, '/products');
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  await page.waitForTimeout(2500); // the release runs 1.5 s after the screen changed
  const seen: string[] = [];
  page.on('request', (r) => { if (isPosData(r)) seen.push(r.url()); });
  await page.waitForTimeout(60_000);
  expect(seen).toEqual([]);
  // the products page itself works (server paging)
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  // the device setting shows "automatic: not selling"
  await goInApp(page, '/settings?tab=devices');
  const card = page.getByTestId('selling-device-card');
  await expect(card).toContainText('สถานะตอนนี้: งานหลังร้าน');
  await expect(card.getByRole('radio', { name: /อัตโนมัติ \(ตอนนี้: ไม่ใช้ขาย\)/ })).toBeChecked();
  await ctx.close();
});

test('back office -> POS -> back office on a back-office device: POS loads and scans, leaving releases again', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctx, page } = await newBrowserPage(browser);
  await goInApp(page, '/products');
  await page.waitForTimeout(2500);
  const seen: string[] = [];
  page.on('request', (r) => { if (isPosData(r)) seen.push(r.url()); });
  // to the POS: the catalogue is loaded again (full), scanning works
  await goInApp(page, '/pos');
  await expect(page.getByText(ITEM.name).first()).toBeVisible({ timeout: 30_000 });
  expect(seen.some((u) => /\/products\/sync$/.test(u))).toBe(true);
  await scan(page, ITEM.barcode);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('purim-pos-cart') || '{"state":{"items":[]}}').state.items.length)).toBe(1);
  // back to the back office: nothing more is downloaded
  await goInApp(page, '/dashboard');
  await page.waitForTimeout(2500);
  seen.length = 0;
  await page.waitForTimeout(20_000);
  expect(seen).toEqual([]);
  // empty the cart again (no sale on this device)
  await page.evaluate(() => localStorage.removeItem('purim-pos-cart'));
  await ctx.close();
});

test('selling device: POS sells by scanning; back-office screens keep the data warm; offline selling still works', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await newBrowserPage(browser);
  await openShiftIfAsked(page);
  await expect(page.getByText(ITEM.name).first()).toBeVisible({ timeout: 30_000 });
  const before = await ordersOfItem();
  await scan(page, ITEM.barcode);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('purim-pos-cart') || '{"state":{"items":[]}}').state.items.length)).toBe(1);
  await payCash(page, 'ชำระเงินสำเร็จ!');
  await expect.poll(ordersOfItem).toBe(before + 1);

  // a bill was completed here: selling device (automatic) -> the catalogue keeps syncing on a back-office screen
  await goInApp(page, '/products');
  const seen: string[] = [];
  page.on('request', (r) => { if (isPosData(r)) seen.push(r.url()); });
  await expect.poll(() => seen.filter((u) => /products\/sync\?since=/.test(u)).length, { timeout: 25_000 }).toBeGreaterThan(0);
  await goInApp(page, '/settings?tab=devices');
  await expect(page.getByTestId('selling-device-card')).toContainText('สถานะตอนนี้: ใช้ขายหน้าร้าน');

  // back to the POS: the products are there at once (kept in memory), then sell with the server unreachable
  await goInApp(page, '/pos');
  await expect(page.getByText(ITEM.name).first()).toBeVisible({ timeout: 3000 });
  await ctx.setOffline(true);
  await scan(page, ITEM.barcode);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('purim-pos-cart') || '{"state":{"items":[]}}').state.items.length)).toBe(1);
  await payCash(page, 'รอส่งฐานข้อมูล');
  expect(await ordersOfItem()).toBe(before + 1);
  // back online: the outbox sends the bill
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(ordersOfItem, { timeout: 30_000 }).toBe(before + 2);
  await ctx.close();
});
