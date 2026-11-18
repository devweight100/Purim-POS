import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, BACKEND_URL, CASHIER } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * Owner request 2026-11-18 (สินค้า > รายการสินค้า & ราคา):
 * - the name column is narrower and shows only the name and the barcodes (no product code); "N ขนาดบรรจุ" stays;
 *   round 4: no photo / icon and no barcodes either; category a narrow column; quantity + unit on one line;
 *   no sideways scroll at 1366x768, 1920x1080, 1093x614; searching by the product code still finds the product;
 * - the product code (SKU) is the permanent system ID: generated on create, read only in the edit form
 *   ("รหัสสินค้า (ระบบ)" + copy), never changed by a save.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-6);
const LONG = `ท่อพีวีซี ชั้น 8.5 ขนาด 1 นิ้ว ยาว 4 เมตร สีฟ้า ตราช้าง สำหรับงานประปาภายในและภายนอกอาคาร ${TAG}`;
const SHORT = `ข้อต่อตรง ${TAG}`;
const BARCODES = [1, 2, 3, 4, 5].map((i) => `88577${TAG}${i}`);
const SHOTS = process.env.E2E_SHOT_DIR || '';

let adminToken = '';
const made: { long?: { id: string; sku: string }; short?: { id: string; sku: string } } = {};

test.beforeAll(async () => {
  await apiLogin(CASHIER);
  adminToken = await apiLogin(ADMIN);
  const cat = await api<{ id: string }>('POST', '/categories', adminToken, { name: `ประปา ${TAG}` });
  made.long = await api<{ id: string; sku: string }>('POST', '/products', adminToken, {
    name: LONG, sku: 'TYPED-BY-USER', unit: 'เส้น', categoryId: cat.id, costPrice: 1234.5,
    basePrice: 1599, priceLevel1: 1599, priceLevel2: 1550, priceLevel3: 1500, priceLevel4: 1450, priceLevel5: 1400,
    barcodes: BARCODES, packagingUnits: [{ name: 'มัด', qtyPerPrev: 10, barcode: `88578${TAG}0`, priceLevel1: 15000 }],
  });
  made.short = await api<{ id: string; sku: string }>('POST', '/products', adminToken, {
    name: SHORT, unit: 'ตัว', categoryId: cat.id, costPrice: 8, basePrice: 15, priceLevel1: 15, barcodes: [`88579${TAG}1`],
  });
  await api('POST', '/inventory/adjust', adminToken, { productId: made.long.id, type: 'SET', amount: 35, reason: 'ปรับยอดเริ่มต้น' });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
});

async function openProducts(page: Page, q: string) {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/products');
  await page.getByLabel(/^ค้นหาสินค้า/).fill(q);
}

test('create generates the code (EAN-13 "200…"); a typed code is ignored', async () => {
  for (const p of [made.long!, made.short!]) expect(p.sku).toMatch(/^200\d{10}$/);
  expect(made.long!.sku).not.toBe('TYPED-BY-USER');
});

test('table: name only (no photo, no barcodes, no code), pack link, narrow category, quantity + unit aligned, no sideways scroll at 3 sizes in both sidebar states', async ({ page }) => {
  await openProducts(page, TAG);
  const rows = page.locator('[data-row-nav]');
  const long = rows.filter({ hasText: LONG });
  await expect(long).toBeVisible();
  await expect(rows).toHaveCount(2);
  const table = page.locator('table').first();
  await expect(page.getByRole('columnheader', { name: /^ชื่อสินค้า/ })).toBeVisible();
  for (const collapsed of [false, true]) {
    if (collapsed) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Control+b');
      await expect(page.getByRole('button', { name: /ขยายแถบเมนู/ }).first()).toBeVisible();
    }
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.waitForTimeout(250);
      const where = { size, collapsed };
      expect({ ...where, overflow: await horizontalOverflow(page) }).toEqual({ ...where, overflow: [] });
      // round 4 (owner): no photo / icon, no barcodes, no product code anywhere in the table
      const text = (await table.innerText()).replace(/\s+/g, ' ');
      for (const code of [made.long!.sku, made.short!.sku, ...BARCODES, `88578${TAG}0`, `88579${TAG}1`]) expect({ ...where, code, shown: text.includes(code) }).toEqual({ ...where, code, shown: false });
      await expect(table.locator('img')).toHaveCount(0);
      await expect(long.getByTestId('product-barcodes')).toHaveCount(0);
      await expect(long.getByTestId('product-pack-link')).toHaveText('1 ขนาดบรรจุ');
      // category: a narrow column (truncated chip with tooltip) when the table is 1366 px or wider, a chip otherwise
      const cat = long.getByTestId(size.width >= 1366 ? 'product-category' : 'product-category-chip');
      await expect(cat).toHaveAttribute('title', `ประปา ${TAG}`);
      if (size.width >= 1366) {
        const head = page.getByRole('columnheader', { name: 'หมวดหมู่' });
        expect((await head.boundingBox())!.width).toBeLessThanOrEqual(130);
      }
      // quantity and unit on one line, units of both rows start at the same x (a straight column)
      const qty = long.getByTestId('product-stock');
      const badge = (await qty.locator('div.grid > span').first().boundingBox())!;
      const unit = (await qty.getByTestId('product-unit').boundingBox())!;
      expect(Math.abs((unit.y + unit.height / 2) - (badge.y + badge.height / 2))).toBeLessThan(4);
      expect(unit.x).toBeGreaterThanOrEqual(badge.x + badge.width - 1);
      const otherUnit = (await rows.filter({ hasText: SHORT }).getByTestId('product-unit').boundingBox())!;
      expect(Math.abs(otherUnit.x - unit.x)).toBeLessThan(1);
      await expect(qty.getByTestId('product-unit')).toHaveText('เส้น');
      // the long name wraps / clamps inside its cell and has the full name as tooltip
      await expect(long.getByTitle(LONG, { exact: true })).toBeVisible();
      const nameCell = long.locator('td').nth(2);
      const cellBox = (await nameCell.boundingBox())!;
      const nameBox = (await long.getByTitle(LONG, { exact: true }).boundingBox())!;
      expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(cellBox.x + cellBox.width + 1);
      const tableBox = (await table.boundingBox())!;
      expect(cellBox.width).toBeLessThan(tableBox.width * 0.5);
      const edit = long.getByRole('button', { name: `แก้ไข ${LONG}` });
      const editBox = (await edit.boundingBox())!;
      expect(editBox.x + editBox.width).toBeLessThanOrEqual(size.width);
      if (SHOTS && size.width === 1366) await page.screenshot({ path: path.join(SHOTS, `products-table${collapsed ? '-collapsed' : ''}.png`) });
    }
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+b');
  await expect(page.getByRole('button', { name: /ย่อแถบเมนู/ }).first()).toBeVisible();
  await page.setViewportSize(SIZES[0]);

  // price levels are their own columns (round 3): 1-5 at 1366x768 / 1920x1080, at least 1-3 at 1093x614
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    const shown = size.width === 1093 ? [1, 2, 3] : [1, 2, 3, 4, 5];
    for (const n of shown) await expect(long.getByTestId(`product-price-${n}`)).toBeVisible();
    await expect(long.getByTestId('product-price-3')).toContainText('1,500');
    if (size.width !== 1093) await expect(long.getByTestId('product-price-5')).toContainText('1,400');
  }
  await page.setViewportSize(SIZES[0]);

  // chevron expands the pack row; the checkbox selects without opening the form
  await long.getByRole('button', { name: `แสดงขนาดบรรจุ ${LONG}` }).click();
  const packRow = page.locator('tr', { hasText: '× 10 เส้น' });
  await expect(packRow).toBeVisible();
  await expect(packRow.getByTestId('product-unit')).toHaveText('มัด');
  // the "1 ขนาดบรรจุ" link folds it again (and does not open the edit form)
  await long.getByTestId('product-pack-link').click();
  await expect(packRow).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await long.getByRole('checkbox').click({ force: true }); // custom checkbox: the visible box sits over the sr-only input
  await expect(page.getByText('เลือกสินค้าแล้ว 1 รายการ')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // sort header still works (name asc / desc puts the other product first)
  const firstName = async () => (await rows.first().innerText()).includes(SHORT) ? 'short' : 'long';
  const before = await firstName();
  await page.getByRole('columnheader', { name: /ชื่อสินค้า/ }).getByRole('button').click();
  await page.getByRole('columnheader', { name: /ชื่อสินค้า/ }).getByRole('button').click();
  await expect.poll(firstName).not.toBe(before);

  // search by the product code (full and part) finds the product even though the code is not shown
  const search = page.getByLabel(/^ค้นหาสินค้า/);
  await search.fill(made.short!.sku);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(SHORT);
  await search.fill(made.long!.sku.slice(0, 11));
  await expect(rows.filter({ hasText: LONG })).toHaveCount(1);
  // ... and by barcode (any of them, and a pack barcode), though barcodes are not shown either
  for (const code of [BARCODES[4], `88579${TAG}1`]) {
    await search.fill(code);
    await expect(rows).toHaveCount(1);
  }
  await expect(rows.first()).toContainText(SHORT);
  await search.fill(BARCODES[0]);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(LONG);
});

test('edit form: "รหัสสินค้า (ระบบ)" read only with copy, skipped by Tab, unchanged after save', async ({ page }) => {
  await openProducts(page, TAG);
  const search = page.getByLabel(/^ค้นหาสินค้า/);
  const row = page.locator('[data-row-nav]').filter({ hasText: SHORT });
  await expect(row).toBeVisible();
  await expect(page.locator('[data-row-nav]')).toHaveCount(2);
  const shortFirst = (await page.locator('[data-row-nav]').first().innerText()).includes(SHORT);
  // keyboard: ↓ then Enter opens the edit form (row pattern unchanged)
  await search.press('ArrowDown');
  if (!shortFirst) await page.keyboard.press('ArrowDown');
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog').filter({ hasText: 'แก้ไขสินค้า' });
  await expect(form.getByLabel('ชื่อสินค้า *')).toHaveValue(SHORT);

  const sku = form.getByLabel('รหัสสินค้า (ระบบ)');
  await expect(sku).toHaveValue(made.short!.sku);
  await expect(sku).toHaveAttribute('readonly', '');
  await expect(sku).not.toBeEditable();
  await expect(sku).toHaveAttribute('tabindex', '-1');
  expect(await sku.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)');
  // typing into it changes nothing
  await sku.click();
  await page.keyboard.type('999');
  await expect(sku).toHaveValue(made.short!.sku);
  // Tab from the low-stock field goes to the copy button, never into the code field
  await form.locator('label:has-text("จำนวนสต๊อกเตือนใกล้หมด") + input').focus();
  await page.keyboard.press('Tab');
  await expect(sku).not.toBeFocused();
  await expect(form.getByRole('button', { name: 'คัดลอกรหัสสินค้า' })).toBeFocused();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await form.getByRole('button', { name: 'คัดลอกรหัสสินค้า' }).click();
  await expect(page.getByText(`คัดลอกรหัสสินค้า ${made.short!.sku} แล้ว`)).toBeVisible();
  if (SHOTS) await form.locator('section', { hasText: 'รายละเอียดสินค้า' }).first().screenshot({ path: path.join(SHOTS, 'product-sku-readonly.png') });

  // save an edit: the code stays
  await form.getByLabel('ชื่อสินค้า *').fill(`${SHORT} (แก้)`);
  await form.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
  await expect(form).toBeHidden();
  const saved = await api<{ name: string; sku: string }>('GET', `/products/${made.short!.id}`, adminToken);
  expect(saved).toMatchObject({ name: `${SHORT} (แก้)`, sku: made.short!.sku });
});

test('add form: no code to type ("ระบบสร้างให้อัตโนมัติเมื่อบันทึก"); the saved product gets a generated code', async ({ page }) => {
  await openProducts(page, TAG);
  await page.getByRole('button', { name: 'เพิ่มสินค้าใหม่' }).click();
  const form = page.getByRole('dialog').filter({ hasText: 'เพิ่มสินค้าใหม่' });
  await expect(form.getByTestId('product-sku-auto')).toHaveText('ระบบสร้างให้อัตโนมัติเมื่อบันทึก');
  await expect(form.getByLabel('รหัสสินค้า (ระบบ)')).toHaveCount(0); // a div, not a field
  await expect(form.locator('[data-testid="product-sku-readonly"]')).toHaveCount(0);
  const name = `ข้องอ 90 องศา ${TAG}`;
  await form.getByLabel('ชื่อสินค้า *', { exact: true }).fill(name);
  await form.getByLabel('ราคา 1', { exact: true }).fill('12');
  await form.getByRole('button', { name: 'บันทึกสินค้า' }).click();
  await expect(form).toBeHidden();
  const list = await api<{ data: { name: string; sku: string }[] }>('GET', `/products/page?page=1&limit=5&q=${encodeURIComponent(name)}`, adminToken);
  expect(list.data).toHaveLength(1);
  expect(list.data[0].sku).toMatch(/^200\d{10}$/);
  // a code change through the API is refused
  const r = await fetch(`${BACKEND_URL}/api/products/${made.long!.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ sku: 'NEW-CODE' }),
  });
  expect(r.status).toBe(400);
  expect((await api<{ sku: string }>('GET', `/products/${made.long!.id}`, adminToken)).sku).toBe(made.long!.sku);
});
