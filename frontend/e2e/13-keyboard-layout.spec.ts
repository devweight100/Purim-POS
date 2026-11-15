import { expect, test, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, cartItems, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Tester report v1.5.3, round 2 (docs/bugfix-v1.5.3.md): owner requirements checked on every main page -
 * no horizontal scroll at 1366x768 / 1920x1080 / 1093x614, buttons >= 8 px apart and >= 16 px from the edge,
 * keyboard first (BUG-07, 08, 09, 11 and the keyboard audit).
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
const LONG = `สินค้าทดสอบชื่อยาวมากสำหรับตรวจความกว้างของตาราง วัสดุก่อสร้างและอุปกรณ์ช่าง ${TAG}`;
let adminToken = '';
let productId = '';

const PAGES = [
  '/orders', '/customers', '/debts', '/claims', '/shifts',
  '/products', '/inventory', '/categories', '/claim-inventory',
  '/purchase-orders', '/payables', '/supplier-returns', '/suppliers',
  '/dashboard', '/reports/sales', '/reports/bestsellers', '/reports/inventory', '/reports/payments', '/reports/customers', '/reports/purchases', '/m',
  '/finance', '/accounts', '/approvals',
  '/settings', '/users', '/monitor',
];

async function openShiftByKeyboard(page: Page) {
  const dlg = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  await dlg.or(page.getByRole('button', { name: 'ปิดกะ', exact: true })).first().waitFor();
  if (await dlg.isVisible()) {
    await dlg.getByLabel('จำนวน แบงค์ 500 ฿').focus();
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await expect(dlg).toBeHidden();
  }
}

test.beforeAll(async () => {
  await apiLogin(CASHIER);
  adminToken = await apiLogin(ADMIN);
  const cat = await api<{ id: string }>('POST', '/categories', adminToken, { name: `หมวดหมู่ชื่อยาวสำหรับทดสอบความกว้างของปุ่มหมวดหมู่ ${TAG}` });
  const p = await api<{ id: string }>('POST', '/products', adminToken, {
    name: LONG, sku: `KB-${TAG}`, unit: 'ชิ้น', categoryId: cat.id, costPrice: 40,
    basePrice: 100, priceLevel1: 100, priceLevel2: 98, priceLevel3: 96, priceLevel4: 94, priceLevel5: 92,
  });
  productId = p.id;
});

test('no horizontal scroll and button spacing on every main page at 1366x768, 1920x1080 and 1093x614', async ({ page }) => {
  test.setTimeout(300_000);
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  const problems: string[] = [];
  for (const path of ['/pos', ...PAGES]) {
    await page.setViewportSize(SIZES[0]);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.waitForTimeout(250);
      for (const o of await horizontalOverflow(page)) problems.push(`${path} ${size.width}x${size.height} overflow: ${o}`);
      for (const s of await spacingIssues(page)) problems.push(`${path} ${size.width}x${size.height} spacing: ${s}`);
    }
  }
  expect(problems).toEqual([]);
});

test('BUG-07/08: products table fits, rows open the edit form by click or arrows + Enter', async ({ page }) => {
  await page.setViewportSize(SIZES[2]);
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/products');
  const search = page.getByLabel(/^ค้นหาสินค้า/);
  await search.fill(String(TAG));
  const row = page.locator('[data-row-nav]').filter({ hasText: LONG });
  await expect(row).toBeVisible();
  // the edit button is on screen without scrolling sideways
  const edit = row.getByRole('button', { name: `แก้ไข ${LONG}` });
  const box = (await edit.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(SIZES[2].width);
  expect(await horizontalOverflow(page)).toEqual([]);

  // keyboard: ↓ from the search box, Enter opens the form
  await search.press('ArrowDown');
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog').filter({ hasText: 'แก้ไขสินค้า' });
  await expect(form.getByLabel('ชื่อสินค้า *')).toHaveValue(LONG);
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();

  // mouse: a click on the row (not on a button) opens it too
  await row.locator('td').nth(2).click();
  await expect(form).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();

  // price levels 2-5: hidden by default, shown on request, still no sideways scroll
  await expect(row.getByTestId('product-prices-2-5')).toHaveCount(0);
  await page.getByText('แสดงราคา 2–5').click();
  await expect(row.getByTestId('product-prices-2-5')).toContainText('92');
  expect(await horizontalOverflow(page)).toEqual([]);
  await page.getByText('แสดงราคา 2–5').click();
});

test('BUG-08: the same row pattern on another table (orders: ↓ + Enter opens the bill)', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/orders');
  const rows = page.locator('[data-row-nav]');
  await expect(rows.first()).toBeVisible();
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').filter({ hasText: 'รายละเอียดออเดอร์' })).toBeVisible();
});

test('BUG-11: category and supplier made from the product form, selected, form input kept', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/products');
  await page.getByRole('button', { name: 'เพิ่มสินค้าใหม่' }).click();
  const form = page.getByRole('dialog').filter({ hasText: 'เพิ่มสินค้าใหม่' });
  const name = `สินค้าฟอร์ม ${TAG}`;
  await form.getByLabel('ชื่อสินค้า *').fill(name);

  await form.getByRole('button', { name: '+ สร้างหมวดหมู่' }).click();
  const quick = page.getByRole('dialog').filter({ hasText: 'สร้างหมวดหมู่ใหม่' });
  await expect(quick.getByLabel('ชื่อหมวดหมู่ *')).toBeFocused();
  await page.keyboard.type(`หมวดใหม่ ${TAG}`);
  await page.keyboard.press('Enter');
  await expect(quick).toBeHidden();
  await expect(page.locator('#product-form-category option:checked')).toContainText(`หมวดใหม่ ${TAG}`);
  await expect(form.getByLabel('ชื่อสินค้า *')).toHaveValue(name);

  // Escape closes only the small dialog
  await form.getByRole('button', { name: '+ เพิ่มผู้จำหน่าย' }).click();
  const qs = page.getByRole('dialog').filter({ hasText: 'เพิ่มผู้จำหน่ายใหม่' });
  await expect(qs).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(qs).toBeHidden();
  await expect(form).toBeVisible();

  await form.getByRole('button', { name: '+ เพิ่มผู้จำหน่าย' }).click();
  await page.keyboard.type(`ผู้จำหน่ายใหม่ ${TAG}`);
  await page.keyboard.press('Enter');
  await expect(qs).toBeHidden();
  await expect(form.getByLabel('ผู้จำหน่าย 1').locator('option:checked')).toHaveText(`ผู้จำหน่ายใหม่ ${TAG}`);

  await form.getByLabel('ชื่อสินค้า *').focus();
  await page.keyboard.press('Control+Enter');
  await expect(form).toBeHidden();
  const found = (await api<{ data: { id: string; name: string; categoryId: string | null }[] }>('GET', `/products/page?page=1&limit=5&q=${encodeURIComponent(name)}`, adminToken)).data.find((p) => p.name === name);
  expect(found?.categoryId).toBeTruthy();
  const full = await api<{ supplierEntries?: { supplierId: string }[]; suppliers?: { supplierId?: string; name?: string }[] }>('GET', `/products/${found!.id}`, adminToken);
  expect((full.supplierEntries ?? full.suppliers ?? []).length).toBe(1);
});

test('POS by keyboard (1093x614): spacing (BUG-09), search + arrows + Enter adds a product, F-keys, Escape closes one window', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: SIZES[2], locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  await uiLogin(page, CASHIER.username, CASHIER.password);
  await expect(page).toHaveURL(/\/pos/);

  // open-shift count: tiles >= 8 px apart (BUG-09), typed by keyboard
  const shiftDlg = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  await shiftDlg.or(page.getByRole('button', { name: 'ปิดกะ', exact: true })).first().waitFor();
  if (await shiftDlg.isVisible()) {
    const tiles = await page.getByTestId('money-grid').locator(':scope > div').evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom })));
    for (let i = 1; i < tiles.length; i++) {
      const a = tiles[i - 1], b = tiles[i];
      if (Math.abs(a.t - b.t) < 2) expect(b.l - a.r).toBeGreaterThanOrEqual(8);
    }
  }
  await openShiftByKeyboard(page);

  // top bar and bottom action bar: gaps >= 8 px, >= 16 px from the window edge
  expect(await spacingIssues(page, '[data-testid="pos-top-bar"]')).toEqual([]);
  expect(await spacingIssues(page, '[data-testid="pos-action-bar"]')).toEqual([]);
  const pay = (await page.getByTestId('pos-action-bar').getByRole('button', { name: 'ชำระเงิน' }).boundingBox())!;
  expect(SIZES[2].width - (pay.x + pay.width)).toBeGreaterThanOrEqual(16);
  expect(await horizontalOverflow(page)).toEqual([]);

  // a product outside the first 32 tiles: search, ↓ to the cards, Enter adds it
  await page.evaluate(() => localStorage.removeItem('purim-pos-cart'));
  const search = page.getByLabel(/^ค้นหาสินค้า/);
  await search.fill(LONG);
  const card = page.getByTestId('pos-product-card').filter({ hasText: LONG });
  await expect(card).toBeVisible();
  await search.press('ArrowDown');
  await expect(page.getByTestId('pos-product-card').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await cartItems(page)).find((i) => i.name === LONG)?.quantity ?? 0).toBe(1);

  // F-keys shown on the screen
  await page.keyboard.press('F2');
  const qty = page.getByRole('dialog').filter({ hasText: 'ระบุจำนวน:' });
  await expect(qty).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(qty).toBeHidden();
  await page.keyboard.press('F4');
  const price = page.getByRole('dialog').filter({ hasText: 'แก้ไขราคาขาย:' });
  await expect(price).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(price).toBeHidden();
  await page.keyboard.press('F9');
  const drawer = page.getByRole('dialog').filter({ hasText: 'เปิดลิ้นชัก / จัดการเงินสด' });
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await page.keyboard.press('F12');
  const payment = page.getByRole('dialog').filter({ hasText: 'เลือกช่องทางการชำระเงิน' });
  await expect(payment).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(payment).toBeHidden();
  await page.keyboard.press('F10'); // hold the bill
  await expect.poll(async () => (await cartItems(page)).length).toBe(0);
  await page.keyboard.press('F10'); // empty cart: held bills
  const held = page.getByRole('dialog').filter({ hasText: 'รายการบิลที่พักไว้' });
  await expect(held).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(held).toBeHidden();

  // a dialog opened over another (sibling windows): Escape closes only the top one
  await page.getByRole('button', { name: 'สิทธิ์เคลม' }).click();
  const stock = page.getByRole('dialog').filter({ hasText: 'คลังสินค้าลูกค้า & สิทธิ์เคลม' });
  await expect(stock).toBeVisible();
  await stock.getByRole('button', { name: 'เลือกลูกค้าอื่น' }).click();
  await expect(stock).toBeHidden(); // under the customer picker (inert)
  await page.keyboard.press('Escape');
  await expect(stock).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await ctx.close();
});

test('back-office sidebar: groups open / close with the keyboard and their links are reachable by Tab', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/dashboard');
  const group = page.getByRole('button', { name: 'สินค้า & คลังสินค้า' });
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await group.focus();
  await page.keyboard.press('Enter');
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('link', { name: 'หมวดหมู่สินค้า' })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    if (await page.getByRole('link', { name: 'หมวดหมู่สินค้า' }).evaluate((el) => el === document.activeElement)) break;
  }
  await expect(page.getByRole('link', { name: 'หมวดหมู่สินค้า' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/categories/);
});

test.afterAll(async () => {
  if (productId) await api('DELETE', `/products/${productId}`, adminToken).catch(() => undefined);
});
