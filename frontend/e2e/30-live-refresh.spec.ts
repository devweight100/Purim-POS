import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, scan, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Owner 2026-11-24 (docs/pos-keys-refresh.md): "I edited data in the back office but the POS had already loaded the
 * products, so the till didn't get the change." Two browsers: the POS open, the back office editing. Every change must
 * reach the open POS within LIVE_MS without a reload; lines already in the cart follow a price change with a notice
 * (not while the payment dialog is open); F5 = รีเฟรชข้อมูล keeps the cart / held bills; F2 / F4 stay POS keys.
 */
test.describe.configure({ mode: 'serial' });

const LIVE_MS = 8_000;
const TAG = String(Date.now()).slice(-5);
const SHOTS = process.env.E2E_SHOT_DIR || '';
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const P = {
  dish: { name: `น้ำยาล้างจานสูตรมะนาวเข้มข้นพิเศษ ขวดใหญ่ 800 มล.-${TAG}`, barcode: `8852${TAG}0001`, pack: `8852${TAG}0006` },
  glue: { name: `กาวร้อนอเนกประสงค์ตราช้างหลอดเล็ก-${TAG}`, barcode: `8852${TAG}0002` },
};
const MEMBER = { name: `ร้านวัสดุก่อสร้างเจริญรุ่งเรือง-${TAG}`, phone: `082${TAG}01` };
let admin = '';
const ids: Record<string, string> = {};

/** The back office (admin, second browser): edits go through its own login, like the product / customer pages. */
async function backOffice(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await page.getByTestId('start-backoffice').click();
  await page.waitForURL((u) => u.pathname !== '/start');
  return { ctx, page };
}
/** API call made from the back-office browser with its own token. */
async function edit(page: Page, method: string, url: string, body?: unknown) {
  const res = await page.evaluate(async ({ method, url, body }) => {
    const token = JSON.parse(localStorage.getItem('auth-storage') || '{}').state?.token;
    const r = await fetch(`/api${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: r.ok, status: r.status, text: (await r.text()).slice(0, 200) };
  }, { method, url, body });
  expect(res.ok, `${method} ${url}: ${res.status} ${res.text}`).toBe(true);
}

async function ensureShift(page: Page) {
  const shiftDlg = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  await shiftDlg.or(page.getByRole('button', { name: 'ปิดกะ', exact: true })).first().waitFor();
  if (await shiftDlg.isVisible()) {
    await shiftDlg.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true }).fill('500');
    await shiftDlg.getByRole('button', { name: 'ตกลง' }).click();
    await expect(shiftDlg).toBeHidden();
  }
}

/** The POS (cashier) with an empty cart, catalogue loaded; a marker on window tells whether the page was reloaded. */
async function posPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  await uiLogin(page, CASHIER.username, CASHIER.password);
  await expect(page).toHaveURL(/\/pos/);
  await ensureShift(page);
  await page.evaluate(() => localStorage.removeItem('purim-pos-cart'));
  const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/products/sync' && r.ok());
  await page.reload();
  await loaded;
  await ensureShift(page);
  await expect(page.getByTestId('pos-last-sync')).not.toHaveText('-');
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
  return { ctx, page };
}
const notReloaded = (page: Page) => page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true);

const search = (page: Page) => page.locator('input[aria-label^="ค้นหาสินค้า"]');
const card = (page: Page, text: string) => page.locator('[data-testid="pos-product-card"]').filter({ hasText: text });
type Line = { name: string; unitName: string; price: number; notice?: string };
const lines = (page: Page): Promise<Line[]> => page.evaluate(() => {
  const raw = localStorage.getItem('purim-pos-cart');
  const items = raw ? JSON.parse(raw).state.items : [];
  return items.map((i: { name: string; unitName: string; customPrice: number | null; originalPrice: number; priceNotice?: string }) => ({
    name: i.name, unitName: i.unitName, price: i.customPrice ?? i.originalPrice, notice: i.priceNotice,
  }));
});
const priceOf = async (page: Page, name: string) => (await lines(page)).find((l) => l.name.startsWith(name.slice(0, 20)))?.price;

test.beforeAll(async () => {
  await apiLogin(CASHIER);
  admin = await apiLogin(ADMIN);
  const dish = await api<{ id: string }>('POST', '/products', admin, {
    name: P.dish.name, barcodes: [P.dish.barcode], unit: 'ขวด', basePrice: 20, priceLevel1: 20, priceLevel2: 18, priceLevel3: 16, priceLevel4: 15, priceLevel5: 14, costPrice: 8,
    manufacturerName: 'บริษัท ผลิตภัณฑ์ทำความสะอาด จำกัด',
    packagingUnits: [{ name: 'แพ็ค', qtyPerPrev: 6, barcode: P.dish.pack, priceLevel1: 110, priceLevel2: 100 }],
  });
  ids.dish = dish.id;
  ids.glue = (await api<{ id: string }>('POST', '/products', admin, { name: P.glue.name, barcodes: [P.glue.barcode], unit: 'หลอด', basePrice: 50, priceLevel1: 50, priceLevel2: 45, costPrice: 20 })).id;
  for (const id of [ids.dish, ids.glue]) await api('POST', '/inventory/adjust', admin, { productId: id, type: 'ADD', amount: 300, reason: 'ปรับยอดเริ่มต้น' });
  ids.member = (await api<{ id: string }>('POST', '/customers', admin, { name: MEMBER.name, phone: MEMBER.phone, priceLevel: 1 })).id;
});

test('back-office edits reach the open POS within seconds, without a reload', async ({ browser }) => {
  const pos = await posPage(browser);
  const bo = await backOffice(browser);
  const { page } = pos;
  try {
    await search(page).fill(`-${TAG}`);
    await expect(card(page, P.dish.name.slice(0, 20))).toHaveAttribute('aria-label', /฿20\.00/);

    // ราคา 1
    await edit(bo.page, 'PATCH', `/products/${ids.dish}`, { basePrice: 23, priceLevel1: 23 });
    await expect(card(page, P.dish.name.slice(0, 20))).toHaveAttribute('aria-label', /฿23\.00/, { timeout: LIVE_MS });
    // pack price
    await edit(bo.page, 'PATCH', `/products/${ids.dish}`, { packagingUnits: [{ name: 'แพ็ค', qtyPerPrev: 6, barcode: P.dish.pack, priceLevel1: 125, priceLevel2: 100 }] });
    await expect(card(page, P.dish.name.slice(0, 20))).toContainText('฿125.00', { timeout: LIVE_MS });
    // name
    const renamed = `น้ำยาล้างจานสูตรใหม่ กลิ่นมะกรูด 800 มล.-${TAG}`;
    await edit(bo.page, 'PATCH', `/products/${ids.dish}`, { name: renamed });
    await expect(card(page, 'สูตรใหม่ กลิ่นมะกรูด')).toBeVisible({ timeout: LIVE_MS });
    // a barcode added: scanning it sells the product
    const newCode = `8852${TAG}0099`;
    await edit(bo.page, 'PATCH', `/products/${ids.dish}`, { barcodes: [P.dish.barcode, newCode] });
    await expect.poll(async () => {
      await scan(page, newCode);
      await page.waitForTimeout(300);
      return (await lines(page)).length;
    }, { timeout: LIVE_MS, intervals: [1000] }).toBeGreaterThan(0);
    expect((await lines(page))[0].name).toBe(renamed);
    await page.keyboard.press('Control+e');
    // inactive: leaves the grid; active again: back
    await search(page).fill(`-${TAG}`);
    await edit(bo.page, 'PATCH', `/products/${ids.glue}`, { isActive: false });
    await expect(card(page, P.glue.name.slice(0, 20))).toHaveCount(0, { timeout: LIVE_MS });
    await edit(bo.page, 'PATCH', `/products/${ids.glue}`, { isActive: true });
    await expect(card(page, P.glue.name.slice(0, 20))).toHaveCount(1, { timeout: LIVE_MS });
    // a new product
    const fresh = `ปูนกาวซีเมนต์สำเร็จรูป ถุง 20 กก.-${TAG}`;
    await edit(bo.page, 'POST', '/products', { name: fresh, barcodes: [`8852${TAG}0007`], unit: 'ถุง', basePrice: 185, priceLevel1: 185 });
    await expect(card(page, fresh.slice(0, 20))).toHaveAttribute('aria-label', /฿185\.00/, { timeout: LIVE_MS });
    // member price level: the open bill follows it
    await search(page).fill('');
    await scan(page, P.glue.barcode);
    await page.keyboard.press('Control+m');
    const dlg = page.getByRole('dialog').filter({ hasText: 'เลือกลูกค้า' });
    await dlg.getByPlaceholder(/ค้นหาชื่อ/).fill(MEMBER.phone);
    await dlg.getByText(MEMBER.name).first().click();
    await expect(dlg).toBeHidden();
    await expect.poll(() => priceOf(page, P.glue.name)).toBe(50);
    await edit(bo.page, 'PATCH', `/customers/${ids.member}`, { priceLevel: 2 });
    await expect.poll(() => priceOf(page, P.glue.name), { timeout: LIVE_MS }).toBe(45);
    expect(await notReloaded(page)).toBe(true);
    await edit(bo.page, 'PATCH', `/customers/${ids.member}`, { priceLevel: 1 });
  } finally {
    await pos.ctx.close();
    await bo.ctx.close();
  }
});

test('a cart line follows a price change with a notice; not while the payment dialog is open', async ({ browser }) => {
  const pos = await posPage(browser);
  const bo = await backOffice(browser);
  const { page } = pos;
  try {
    await edit(bo.page, 'PATCH', `/products/${ids.dish}`, { basePrice: 20, priceLevel1: 20 });
    await scan(page, P.dish.barcode);
    await scan(page, P.glue.barcode);
    await expect.poll(() => priceOf(page, P.glue.name)).toBe(50);
    await expect.poll(async () => (await lines(page)).find((l) => l.unitName === 'ขวด')?.price).toBe(20);
    // manual price (F4) on the glue: never re-priced
    await page.getByText(P.glue.name).first().click();
    await page.keyboard.press('F4');
    const priceDlg = page.getByRole('dialog').filter({ hasText: 'แก้ไขราคาขาย' });
    await expect(priceDlg).toBeVisible();
    await page.keyboard.type('48');
    await page.keyboard.press('Enter');
    await expect.poll(() => priceOf(page, P.glue.name)).toBe(48);

    await edit(bo.page, 'PATCH', `/products/${ids.dish}`, { basePrice: 25, priceLevel1: 25 });
    await edit(bo.page, 'PATCH', `/products/${ids.glue}`, { basePrice: 55, priceLevel1: 55 });
    const notice = page.getByTestId('pos-line-price-notice');
    await expect(notice).toHaveText('ราคาอัปเดต ฿20.00 → ฿25.00', { timeout: LIVE_MS });
    await expect(notice).toHaveCount(1);
    expect(await priceOf(page, P.glue.name)).toBe(48);
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'ราคาอัปเดต:' })).toBeVisible();
    await shot(page, 'pos-price-updated-notice');

    // payment dialog open: the bill does not change under it; it follows once the dialog closes
    await page.keyboard.press('F12');
    const pay = page.getByRole('dialog').filter({ hasText: 'ชำระ' }).first();
    await expect(pay).toBeVisible();
    await expect(pay).toContainText('฿73.00');
    await edit(bo.page, 'PATCH', `/products/${ids.dish}`, { basePrice: 27, priceLevel1: 27 });
    await page.waitForTimeout(4000);
    await expect(pay).toContainText('฿73.00');
    expect((await lines(page)).find((l) => l.unitName === 'ขวด')?.price).toBe(25);
    await page.keyboard.press('Escape');
    await expect(pay).toBeHidden();
    await expect(notice).toHaveText('ราคาอัปเดต ฿25.00 → ฿27.00', { timeout: LIVE_MS });
    expect(await notReloaded(page)).toBe(true);
  } finally {
    await edit(bo.page, 'PATCH', `/products/${ids.dish}`, { basePrice: 20, priceLevel1: 20 });
    await edit(bo.page, 'PATCH', `/products/${ids.glue}`, { basePrice: 50, priceLevel1: 50 });
    await pos.ctx.close();
    await bo.ctx.close();
  }
});

test('F5 รีเฟรชข้อมูล: full resync keeps the cart and held bills, shows the time; offline keeps the cache', async ({ browser }) => {
  const pos = await posPage(browser);
  const { page, ctx } = pos;
  try {
    const btn = page.getByTestId('pos-refresh');
    await expect(btn).toContainText('F5');
    await shot(page, 'pos-f5-hint-last-sync');
    // a held bill + a bill in progress
    await scan(page, P.glue.barcode);
    await expect.poll(async () => (await lines(page)).length).toBe(1);
    await page.keyboard.press('F10');
    await expect.poll(async () => (await lines(page)).length).toBe(0);
    await scan(page, P.dish.barcode);
    await expect.poll(async () => (await lines(page)).length).toBe(1);
    const before = await page.getByTestId('pos-last-sync').textContent();
    await page.waitForTimeout(1100);

    const full = page.waitForResponse((r) => { const u = new URL(r.url()); return u.pathname === '/api/products/sync' && !u.searchParams.get('since') && r.ok(); });
    const customers = page.waitForResponse((r) => { const u = new URL(r.url()); return u.pathname === '/api/customers/sync' && !u.searchParams.get('since') && r.ok(); });
    const settings = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/settings' && r.ok());
    await page.keyboard.press('F5');
    await Promise.all([full, customers, settings]);
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: /รีเฟรชข้อมูลแล้ว \d\d:\d\d:\d\d/ });
    await expect(toast).toBeVisible();
    await expect(page.getByTestId('pos-last-sync')).not.toHaveText(before || '');
    expect(await notReloaded(page)).toBe(true);
    expect((await lines(page)).map((l) => l.name)).toEqual([P.dish.name]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('purim-pos-cart') || '{}').state.heldBills.length)).toBe(1);

    // offline: says so, nothing replaced
    await ctx.setOffline(true);
    await page.keyboard.press('F5');
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'ออฟไลน์อยู่' })).toBeVisible();
    await ctx.setOffline(false);
    expect((await lines(page)).map((l) => l.name)).toEqual([P.dish.name]);
    await search(page).fill(`-${TAG}`);
    await expect(card(page, P.glue.name.slice(0, 20))).toHaveCount(1);
    expect(await notReloaded(page)).toBe(true);

    // F5 while a dialog is open still refreshes (never reloads the POS)
    await page.keyboard.press('Control+m');
    await expect(page.getByRole('dialog').filter({ hasText: 'เลือกลูกค้า' })).toBeVisible();
    const again = page.waitForResponse((r) => { const u = new URL(r.url()); return u.pathname === '/api/products/sync' && !u.searchParams.get('since') && r.ok(); });
    await page.keyboard.press('F5');
    await again;
    expect(await notReloaded(page)).toBe(true);
  } finally {
    await ctx.close();
  }
});

test('F2 / F4 on a cart line open the POS dialogs (web), F5 hint fits the 3 sizes in both layouts', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  try {
    await scan(page, P.dish.barcode);
    await expect.poll(async () => (await lines(page)).length).toBe(1);
    await page.keyboard.press('F2');
    const qty = page.getByRole('dialog').filter({ hasText: 'ระบุจำนวน' });
    await expect(qty).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(qty).toBeHidden();
    await page.keyboard.press('F4');
    const price = page.getByRole('dialog').filter({ hasText: 'แก้ไขราคาขาย' });
    await expect(price).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(price).toBeHidden();
    expect(new URL(page.url()).pathname).toBe('/pos');

    for (const mode of ['touch_screen', 'list_view']) {
      await page.locator('select[title="สลับรูปแบบหน้าจอขาย"], select').filter({ has: page.locator(`option[value="${mode}"]`) }).first().selectOption(mode);
      await expect(page.getByTestId('pos-refresh')).toBeVisible();
      for (const size of SIZES) {
        await page.setViewportSize(size);
        expect(await horizontalOverflow(page), `${mode} ${size.width}x${size.height}`).toEqual([]);
      }
      await page.setViewportSize(SIZES[0]);
      if (mode === 'touch_screen') expect(await spacingIssues(page, '[data-testid="pos-top-bar"]')).toEqual([]);
      else await shot(page, 'pos-list-f5-hint');
    }
    await page.locator('select').filter({ has: page.locator('option[value="touch_screen"]') }).first().selectOption('touch_screen');
  } finally {
    await ctx.close();
  }
});
