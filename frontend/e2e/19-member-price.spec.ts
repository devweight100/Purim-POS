import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Owner 2026-11-18 (v1.5.7): "I linked a LINE customer to a member and set the member's price to ราคา 2, but the shop
 * still shows the customer ราคา 1." The shop page was already open on the phone when the link was approved.
 * The server always answered with the member's level; the page kept what it loaded when it opened (who the visitor
 * is, the cart prices) until a full reload. docs/bugfix-member-price.md.
 *
 * Each flow keeps ONE page open on the phone (no reload) while staff approve / change the level, then checks the
 * level-2 prices on the next navigation, in the cart bar, the cart, the placed order and after a reload.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
const CEMENT = `ปูนราคาสมาชิก ${TAG}`;
const SAND = `ทรายไม่มีราคาส่ง ${TAG}`;
const M1 = { name: `สมาชิกราคาส่ง ${TAG}`, phone: `081${TAG}11`.slice(0, 10) };
const M2 = { name: `สมาชิกเปลี่ยนระดับ ${TAG}`, phone: `082${TAG}22`.slice(0, 10) };
let adminToken = '';

async function shopSession(dev: string) {
  return (await api<{ token: string; expiresAt: string }>('POST', '/public/shop/session', undefined, { dev: { id: `${dev}${TAG}`, name: `ลูกค้า ${dev}` } }));
}

/** A phone (390x844) whose shop page uses the given test-profile session. */
async function phoneWith(browser: Browser, s: { token: string; expiresAt: string }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  await ctx.addInitScript((v) => {
    if (!localStorage.getItem('purim-shop-session')) localStorage.setItem('purim-shop-session', v);
  }, JSON.stringify(s));
  return ctx.newPage();
}

async function mobileOk(page: Page) {
  expect(await horizontalOverflow(page)).toEqual([]);
  const strip = page.getByTestId('shop-member-level');
  if (await strip.count()) expect(await strip.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(18);
}

/** client-side navigation to the search results (no reload) */
async function searchFromHome(page: Page) {
  await page.locator('header a[href="/shop"]').click();
  await expect(page).toHaveURL(/\/shop$/);
  await page.getByLabel('ค้นหาสินค้า').fill(TAG);
  await page.getByRole('button', { name: 'ค้นหา' }).click();
  await expect(page.getByTestId('shop-product').filter({ hasText: CEMENT })).toBeVisible();
}

test.beforeAll(async () => {
  adminToken = await apiLogin(ADMIN);
  const cement = await api<{ id: string }>('POST', '/products', adminToken, {
    name: CEMENT, unit: 'ถุง', basePrice: 200, priceLevel1: 200, priceLevel2: 180, costPrice: 120,
    packagingUnits: [{ name: 'แพค', qtyPerPrev: 10, priceLevel1: 1900, priceLevel2: 1700 }],
  });
  const sand = await api<{ id: string }>('POST', '/products', adminToken, { name: SAND, unit: 'ถุง', basePrice: 50, priceLevel1: 50, costPrice: 30 });
  for (const id of [cement.id, sand.id]) await api('POST', '/inventory/adjust', adminToken, { productId: id, type: 'ADD', amount: 100, reason: 'ปรับยอดเริ่มต้น' });
  await api('PUT', '/online-shop/config', adminToken, { enabled: true });
  await api('POST', '/customers', adminToken, { name: M1.name, phone: M1.phone, priceLevel: 2 });
  await api('POST', '/customers', adminToken, { name: M2.name, phone: M2.phone, priceLevel: 1 });
});

test('approved while the shop is open: link page, prices, cart bar, cart, order at ราคาส่ง without a reload', async ({ browser, page: staff }) => {
  const s = await shopSession('mp1');
  const phone = await phoneWith(browser, s);

  // guest: retail prices; one bag in the cart
  await phone.goto(`/shop/products?q=${TAG}`);
  const cement = phone.getByTestId('shop-product').filter({ hasText: CEMENT });
  await expect(cement).toContainText('฿200');
  await expect(phone.getByTestId('shop-member-level')).toHaveCount(0);
  await cement.getByRole('button', { name: 'ใส่ตะกร้า' }).click();
  await expect(phone.getByTestId('shop-cart-bar')).toContainText('฿200');

  // link request from the shop
  await phone.goto('/shop/link');
  await phone.getByLabel('เบอร์โทรของคุณ').fill(M1.phone);
  await phone.getByRole('button', { name: 'ส่งคำขอ' }).click();
  await expect(phone.getByText('ส่งคำขอแล้ว')).toBeVisible();

  // staff approve in the back office, choosing the existing member whose level is 2 (shown on the button row)
  await uiLogin(staff, ADMIN.username, ADMIN.password);
  await expect(staff).toHaveURL(/\/pos/);
  await staff.goto('/online-orders?tab=links');
  const req = staff.getByTestId('link-request').filter({ hasText: M1.phone });
  await expect(req).toContainText('ระดับราคา 2');
  for (const size of SIZES) {
    await staff.setViewportSize(size);
    expect(await horizontalOverflow(staff)).toEqual([]);
    expect(await spacingIssues(staff, '[data-testid="link-request"]')).toEqual([]);
  }
  await staff.setViewportSize({ width: 1366, height: 768 });
  await req.getByRole('button', { name: new RegExp(`ผูกกับ ${M1.name}`) }).focus();
  await staff.keyboard.press('Enter');
  await expect(staff.getByText(`ผูก LINE กับ ${M1.name} แล้ว`)).toBeVisible();

  // the phone, still on the link page, learns it by itself (no reload, no tap)
  await expect(phone.getByText('บัญชีนี้เป็นสมาชิกแล้ว')).toBeVisible({ timeout: 25_000 });
  await expect(phone.getByTestId('shop-member-level')).toHaveText(/ราคาสำหรับสมาชิก: ราคาส่ง/);
  // the cart bar shows the member price of what is already in the cart
  await expect(phone.getByTestId('shop-cart-bar')).toContainText('฿180');
  await mobileOk(phone);

  // next navigation: level-2 prices; a product without ราคา 2 says it is the retail price
  await searchFromHome(phone);
  await expect(cement).toContainText('฿180');
  await cement.getByRole('radio', { name: /แพค/ }).click();
  await expect(cement).toContainText('฿1,700');
  const sand = phone.getByTestId('shop-product').filter({ hasText: SAND });
  await expect(sand).toContainText('฿50');
  await expect(sand.getByTestId('shop-retail-note')).toContainText('ยังไม่มีราคาส่ง');
  await expect(cement.getByTestId('shop-retail-note')).toHaveCount(0);
  await mobileOk(phone);

  // cart + order at level 2
  await phone.getByTestId('shop-cart-bar').click();
  await expect(phone.getByTestId('shop-cart-line')).toContainText('฿180');
  await expect(phone.getByTestId('shop-cart-subtotal')).toHaveText('฿180');
  await phone.getByRole('link', { name: 'สั่งซื้อ' }).click();
  await phone.getByText('รับเองที่ร้าน', { exact: true }).click();
  await phone.getByRole('button', { name: /ยืนยันสั่งซื้อ/ }).click();
  await expect(phone).toHaveURL(/\/shop\/orders\/[0-9a-f-]{36}/);
  const orderId = phone.url().split('/').pop()!.split('?')[0];
  const order = await api<{ items: { unitPrice: number }[]; subtotal: number }>('GET', `/public/shop/orders/${orderId}`, s.token);
  expect(order.items.map((i) => i.unitPrice)).toEqual([180]);
  expect(order.subtotal).toBe(180);

  // after a reload too
  await phone.goto(`/shop/products?q=${TAG}`);
  await expect(phone.getByTestId('shop-member-level')).toHaveText(/ราคาสำหรับสมาชิก: ราคาส่ง/);
  await expect(cement).toContainText('฿180');
  await phone.context().close();
});

test('member linked at ราคาปลีก, then the level is changed on the customers page: the open shop follows', async ({ browser, page: staff }) => {
  const s = await shopSession('mp2');
  const phone = await phoneWith(browser, s);
  await phone.goto(`/shop/products?q=${TAG}`);
  const cement = phone.getByTestId('shop-product').filter({ hasText: CEMENT });
  await expect(cement).toContainText('฿200');
  await cement.getByRole('button', { name: 'ใส่ตะกร้า' }).click();

  await api('POST', '/public/shop/link', s.token, { phone: M2.phone });
  const reqs = await api<{ id: string; phone: string }[]>('GET', '/online-shop/link-requests?status=PENDING', adminToken);
  const req = reqs.find((r) => r.phone === M2.phone)!;
  const m2 = (await api<{ data: { id: string; name: string }[] }>('GET', `/customers?page=1&limit=5&search=${encodeURIComponent(M2.name)}`, adminToken)).data[0];
  await api('POST', `/online-shop/link-requests/${req.id}/decide`, adminToken, { approve: true, customerId: m2.id });

  // linked at level 1: the open page shows the member (no reload) with ราคาปลีก
  await searchFromHome(phone);
  await expect(phone.getByTestId('shop-member-level')).toHaveText(/ราคาสำหรับสมาชิก: ราคาปลีก/);
  await expect(cement).toContainText('฿200');

  // staff change the level on the customers page (credit tab), the note explains the fallback
  await uiLogin(staff, ADMIN.username, ADMIN.password);
  await expect(staff).toHaveURL(/\/pos/);
  await staff.goto('/customers');
  await staff.getByPlaceholder(/ค้นหา/).first().fill(M2.name);
  const row = staff.locator('tbody tr', { hasText: M2.name });
  await expect(row).toHaveCount(1);
  await row.getByTitle('แก้ไขข้อมูลสมาชิก').click();
  await staff.getByRole('button', { name: /3\. เครดิต & ระดับราคา/ }).click();
  await staff.getByRole('button', { name: /ระดับ 2/ }).click();
  const note = staff.getByTestId('customer-level-note');
  await expect(note).toContainText('ใช้ราคาปลีก');
  await expect(note).toContainText(/ยังไม่มีราคาระดับ 2: \d/);
  for (const size of SIZES) {
    await staff.setViewportSize(size);
    expect(await horizontalOverflow(staff)).toEqual([]);
  }
  await staff.setViewportSize({ width: 1366, height: 768 });
  await staff.getByRole('button', { name: /บันทึกข้อมูลสมาชิก/ }).click();
  await expect(staff.getByText(/แก้ไขข้อมูลสมาชิก ".*" เรียบร้อยแล้ว/)).toBeVisible();

  // the phone: next navigation shows level 2 everywhere (strip, products, cart bar), still no reload
  await searchFromHome(phone);
  await expect(phone.getByTestId('shop-member-level')).toHaveText(/ราคาสำหรับสมาชิก: ราคาส่ง/);
  await expect(cement).toContainText('฿180');
  await expect(phone.getByTestId('shop-cart-bar')).toContainText('฿180');
  await mobileOk(phone);

  // the page brought back to the front (LINE reopened) also refreshes
  await api('PATCH', `/customers/${m2.id}`, adminToken, { name: M2.name, priceLevel: 1 });
  await phone.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(phone.getByTestId('shop-member-level')).toHaveText(/ราคาสำหรับสมาชิก: ราคาปลีก/);
  await expect(phone.getByTestId('shop-cart-bar')).toContainText('฿200');
  await phone.context().close();
});
