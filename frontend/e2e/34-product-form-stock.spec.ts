import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * Owner 2026-11-25 (docs/product-form-bank-logos.md parts 2 + 3): the product form puts ชื่อสินค้า, ต้นทุน,
 * ราคา 1-5, บาร์โค้ด, รหัสสินค้า, จำนวนสต็อก on top (and in that Tab order, the name focused); Enter saves.
 * The stock field: create = opening stock movement; edit = adjustment "ปรับจากหน้าแก้ไขสินค้า" in the stock card;
 * a stock changed elsewhere meanwhile is not overwritten blindly.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-6);
const NAME = `ท่อพีวีซี สีฟ้า ชั้น 8.5 ขนาด 1/2 นิ้ว ยาว 4 เมตร-${TAG}`;
const BARCODE = `8859${TAG}55`;
let token = '';
let productId = '';

type Move = { type: string; quantityChange: number; reason: string; userName: string; previousStock: number; currentStock: number };
const moves = (id: string) => api<Move[]>('GET', `/inventory/movements?productId=${id}`, token);
const stockOf = async (id: string) => Number((await api<{ computedStock: number }>('GET', `/products/${id}/stock`, token)).computedStock);

async function openList(page: Page) {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await page.goto('/products');
}
async function openEdit(page: Page) {
  const search = page.getByLabel(/^ค้นหาสินค้า/);
  await search.fill(TAG);
  const row = page.locator('[data-row-nav]').filter({ hasText: NAME });
  await expect(row).toHaveCount(1);
  await row.focus();
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog').filter({ hasText: 'แก้ไขสินค้า' });
  await expect(form).toBeVisible();
  return form;
}

test.beforeAll(async () => {
  token = await apiLogin(ADMIN);
});

test('add form: the name has the focus, Tab order of the top fields, Enter saves with the opening stock', async ({ page }) => {
  await openList(page);
  await page.getByRole('button', { name: 'เพิ่มสินค้าใหม่' }).click();
  const form = page.getByRole('dialog').filter({ hasText: 'เพิ่มสินค้าใหม่' });
  await expect(form.getByLabel('ชื่อสินค้า *', { exact: true })).toBeFocused();
  await page.keyboard.type(NAME);
  const order: [string, string][] = [
    ['#product-form-cost', '38.5'],
    ['#product-form-price-1', '55'],
    ['#product-form-price-2', '52'],
    ['#product-form-price-3', '50'],
    ['#product-form-price-4', '48'],
    ['#product-form-price-5', '45'],
    ['#product-form-barcode', BARCODE],
    ['#product-sku', ''],
    ['#product-form-stock', '36'],
  ];
  for (const [sel, value] of order) {
    await page.keyboard.press('Tab');
    await expect(form.locator(sel)).toBeFocused();
    if (value) await page.keyboard.type(value);
  }
  // level names of the shop on the price labels
  await expect(form.locator('label[for="product-form-price-1"]')).toContainText('ราคาปลีก');
  await expect(form.getByTestId('product-stock-hint')).toContainText('ยอดยกมา');
  for (const size of SIZES) {
    await page.setViewportSize(size);
    expect(await horizontalOverflow(page), `${size.width}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.keyboard.press('Enter');
  await expect(form).toBeHidden();

  const list = await api<{ data: { id: string }[] }>('GET', `/products/page?page=1&limit=5&q=${encodeURIComponent(BARCODE)}`, token);
  productId = list.data[0].id;
  const saved = await api<{ name: string; costPrice: string; priceLevel5: string; sku: string }>('GET', `/products/${productId}`, token);
  expect(saved.name).toBe(NAME);
  expect(Number(saved.costPrice)).toBe(38.5);
  expect(Number(saved.priceLevel5)).toBe(45);
  expect(saved.sku).toMatch(/^200\d{10}$/); // blank = generated
  expect(await stockOf(productId)).toBe(36);
  const m = await moves(productId);
  expect(m).toHaveLength(1);
  expect(m[0]).toMatchObject({ type: 'ADJUST_ADD', quantityChange: 36, reason: 'สต็อกเริ่มต้น (เพิ่มสินค้าใหม่)' });
});

test('edit: the stock field shows the current stock; a change is a stock adjustment in the stock card', async ({ page }) => {
  await openList(page);
  const form = await openEdit(page);
  const stock = form.locator('#product-form-stock');
  await expect(stock).toHaveValue('36');
  await stock.fill('30');
  await expect(form.getByTestId('product-stock-hint')).toContainText('-6');
  // the barcode field's Enter (a scanner) moves on, it does not save
  await form.locator('#product-form-barcode').focus();
  await page.keyboard.press('Enter');
  await expect(form.locator('#product-sku')).toBeFocused();
  await expect(form).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(form).toBeHidden();
  expect(await stockOf(productId)).toBe(30);
  const m = await moves(productId);
  expect(m[0]).toMatchObject({ type: 'ADJUST_SUB', quantityChange: -6, previousStock: 36, currentStock: 30, reason: 'ปรับจากหน้าแก้ไขสินค้า' });
  expect(m[0].userName).toBeTruthy();

  // the stock card (⋯ -> สต็อกการ์ด) lists it
  await page.getByLabel(/^ค้นหาสินค้า/).fill(TAG);
  await page.locator('[data-row-nav]').filter({ hasText: NAME }).getByRole('button', { name: `จัดการสินค้า ${NAME}` }).click();
  await page.getByRole('menuitem', { name: /สต็อกการ์ด/ }).click();
  const card = page.getByRole('dialog').filter({ hasText: `สต็อกการ์ด: ${NAME}` });
  await expect(card).toBeVisible();
  await expect(card).toContainText('ปรับจากหน้าแก้ไขสินค้า');
});

test('edit: stock changed by someone else meanwhile -> asked, never overwritten blindly', async ({ page }) => {
  await openList(page);
  const form = await openEdit(page);
  const stock = form.locator('#product-form-stock');
  await expect(stock).toHaveValue('30');
  // a sale on another terminal while the form is open
  await api('POST', '/inventory/adjust', token, { productId, type: 'SUB', amount: 2, reason: 'ขายจากอีกเครื่อง' });
  await stock.fill('40');
  await page.keyboard.press('Enter');
  const ask = page.getByTestId('stock-changed-dialog');
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('ตอนนี้: 28');
  expect(await stockOf(productId)).toBe(28); // nothing saved yet
  // "ใช้ยอดปัจจุบัน": the field shows 28, the form stays open
  await ask.getByRole('button', { name: 'ใช้ยอดปัจจุบัน' }).click();
  await expect(stock).toHaveValue('28');
  await expect(form).toBeVisible();
  // type again and save: now applied
  await stock.fill('40');
  await page.keyboard.press('Enter');
  await expect(form).toBeHidden();
  expect(await stockOf(productId)).toBe(40);
});
