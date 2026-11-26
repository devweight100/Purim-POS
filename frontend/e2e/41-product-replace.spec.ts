import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Delete a used product with a replacement (owner 2026-11-26, docs/round-shift-today-bundle-replace.md): the delete
 * dialog of a sold product refuses while stock is not 0 (button to the stock adjustment), lets the user pick a
 * replacement by typing (keyboard), shows what moves and the barcode option, and deletes; the old bill keeps the
 * original name / code / price, the barcode finds the replacement, a held line with the old id sells as the replacement.
 */
test.describe.configure({ mode: 'serial' });
test.use({ deviceScaleFactor: 2 });

const OUT = process.env.E2E_SCREENSHOT_DIR || '';
const TAG = `RP${String(Date.now()).slice(-6)}`;
const OLD = `สายไฟ VAF 2x1.5 ตราช้าง ม้วน 100 เมตร รุ่นเก่าเลิกผลิต ${TAG}`;
const NEW = `สายไฟ VAF 2x1.5 ตราช้าง ม้วน 100 เมตร รุ่นใหม่ ${TAG}`;
const BARCODE = `885${String(Date.now()).slice(-10)}`;
let token = '';
const ids: Record<string, string> = {};
let shiftId = '';
let orderId = '';

async function shots(page: Page, name: string) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    expect(await horizontalOverflow(page), `${name} ${size.width}x${size.height}`).toEqual([]);
    expect(await spacingIssues(page, '[data-testid="replace-product-dialog"]'), `${name} ${size.width}x${size.height}`).toEqual([]);
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: `${OUT}/after-${name}-${size.width}x${size.height}.png` });
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
}

test.beforeAll(async () => {
  token = await apiLogin(ADMIN);
  const mk = (name: string, extra: Record<string, unknown> = {}) =>
    api<{ id: string }>('POST', '/products', token, { name, basePrice: 1290, priceLevel1: 1290, priceLevel2: 1250, priceLevel3: 1220, priceLevel4: 1200, priceLevel5: 1180, costPrice: 950, unit: 'ม้วน', ...extra });
  ids.old = (await mk(OLD, { sku: `OLD-${TAG}`, barcodes: [BARCODE] })).id;
  ids.neo = (await mk(NEW, { sku: `NEW-${TAG}` })).id;
  await api('POST', '/inventory/adjust', token, { productId: ids.old, type: 'ADD', amount: 6, reason: 'ยอดยกมา' });
  shiftId = (await api<{ shift: { id: string } }>('POST', '/shifts/open', token, { startingCash: 0, terminalId: `pw-${TAG}` })).shift.id;
  orderId = (await api<{ id: string }>('POST', '/orders/checkout', token, {
    clientOrderId: randomUUID(), shiftId, items: [{ productId: ids.old, quantity: 2, unitPrice: 1250 }], payments: [{ method: 'CASH', amount: 2500 }],
  })).id;
});

test.afterAll(async () => {
  const sum = await api<{ expectedCash: number }>('GET', `/shifts/${shiftId}/summary`, token).catch(() => null);
  if (sum) await api('POST', `/shifts/${shiftId}/close`, token, { actualCash: sum.expectedCash }).catch(() => undefined);
});

async function openDelete(page: Page) {
  await page.goto('/products');
  await page.getByLabel(/^ค้นหาสินค้า/).fill(TAG);
  const row = page.locator('[data-testid="product-row"]').filter({ hasText: OLD });
  await row.getByRole('button', { name: `จัดการสินค้า ${OLD}` }).click();
  await page.getByRole('menuitem', { name: 'ลบสินค้า' }).click();
  const dlg = page.getByTestId('replace-product-dialog');
  await expect(dlg).toBeVisible();
  return dlg;
}

test('sold product: stock must be 0 first; pick a replacement by keyboard; history moves, the bill keeps its name', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });

  // stock 4 left: refused, with the way to the stock adjustment
  let dlg = await openDelete(page);
  await expect(dlg.getByTestId('replace-stock-problem')).toContainText('ยังมีสต็อก 4');
  await expect(dlg.getByTestId('replace-confirm')).toBeDisabled();
  await shots(page, 'replace-stock-not-zero');
  await dlg.getByRole('button', { name: /ไปปรับสต็อกเป็น 0/ }).click();
  await expect(page).toHaveURL(/\/inventory/);
  await expect(page.getByRole('dialog').filter({ hasText: OLD })).toBeVisible(); // the adjustment of this product
  await page.keyboard.press('Escape');
  await api('POST', '/inventory/adjust', token, { productId: ids.old, type: 'SET', amount: 0, reason: 'ปรับก่อนลบ' });

  // stock 0: type the replacement, Enter picks it, the counts show, the confirm button gets the focus
  dlg = await openDelete(page);
  await expect(dlg.getByTestId('replace-stock-problem')).toHaveCount(0);
  const picker = dlg.getByRole('combobox', { name: 'ค้นหาสินค้าทดแทน' });
  await expect(picker).toBeFocused();
  await picker.fill(`รุ่นเก่าเลิกผลิต ${TAG}`);
  await expect(dlg.getByTestId('product-pick-option').filter({ hasText: OLD })).toHaveAttribute('aria-disabled', 'true');
  await picker.fill(`รุ่นใหม่ ${TAG}`);
  await expect(dlg.getByTestId('product-pick-option')).toHaveCount(1);
  await picker.press('Enter');
  await expect(dlg.getByTestId('replace-counts')).toContainText('บิลขาย 1 ใบ');
  await expect(dlg.getByTestId('replace-counts')).toContainText('ความเคลื่อนไหวสต็อก');
  await expect(dlg.getByTestId('replace-move-barcodes')).toBeChecked();
  await expect(dlg.getByTestId('replace-confirm')).toBeFocused();
  await shots(page, 'replace-ready');
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'ประวัติย้ายไปที่' })).toBeVisible();
  await expect(page.locator('[data-testid="product-row"]').filter({ hasText: OLD })).toHaveCount(0);

  // the old bill: original name / code / price; the barcode now finds the replacement
  const bill = await api<{ items: { unitPrice: string | number; product: { id: string; name: string; sku: string } }[]; totalAmount: string | number }>('GET', `/orders/${orderId}`, token);
  expect(bill.items[0].product).toMatchObject({ id: ids.neo, name: OLD, sku: `OLD-${TAG}` });
  expect(Number(bill.items[0].unitPrice)).toBe(1250);
  expect(Number(bill.totalAmount)).toBe(2500);
  expect((await api<{ id: string }>('GET', `/products/barcode/${BARCODE}`, token)).id).toBe(ids.neo);
  // the bills page shows the original name too
  await page.goto('/orders');
  await page.getByPlaceholder(/ค้นหาตามเลขออเดอร์/).fill(TAG);
  await page.getByRole('row').filter({ hasText: '฿2,500.00' }).first().click();
  await expect(page.getByRole('dialog').getByText(OLD).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // a held bill / offline sale with the old id sells as the replacement
  await api('POST', '/inventory/adjust', token, { productId: ids.neo, type: 'ADD', amount: 3, reason: 'รับเข้า' });
  const late = await api<{ items: { productId: string }[] }>('POST', '/orders/checkout', token, {
    clientOrderId: randomUUID(), shiftId, items: [{ productId: ids.old, quantity: 1, unitPrice: 1290 }], payments: [{ method: 'CASH', amount: 1290 }],
  });
  expect(late.items[0].productId).toBe(ids.neo);
});
