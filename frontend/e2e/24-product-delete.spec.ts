import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Product delete / disable (owner 2026-11-19, docs/product-delete.md): the "⋯" row menu replaces the pencil; a product
 * no document names is deleted with its own data (stock on hand is named in the confirmation); a sold product is
 * refused with the documents listed and "ปิดการใช้งาน" offered in the dialog; ใช้งาน / ปิดใช้งาน / ทั้งหมด filter;
 * a disabled product is not found in the POS.
 */
test.describe.configure({ mode: 'serial' });

const TAG = `PD${String(Date.now()).slice(-6)}`;
const NEVER = `กาวซิลิโคนกันรั่วซึม ชนิดใส 280 มล. ยังไม่เคยขาย ${TAG}`;
const SOLD = `ท่อพีวีซี ตราช้าง 1 นิ้ว ชั้น 8.5 ขายแล้ว ${TAG}`;
const SOLD_BARCODE = `885${String(Date.now()).slice(-10)}`;
const COLLAPSED_KEY = 'purim_sidebar_collapsed';
let token = '';
const made: { never?: { id: string }; sold?: { id: string } } = {};

test.beforeAll(async () => {
  token = await apiLogin(ADMIN);
  const sup = await api<{ id: string }>('POST', '/suppliers', token, { name: `ผู้จำหน่ายทดสอบลบสินค้า ${TAG}` });
  made.never = await api<{ id: string }>('POST', '/products', token, {
    name: NEVER, basePrice: 20, priceLevel1: 20, costPrice: 12, unit: 'ชิ้น', supplierEntries: [{ supplierId: sup.id, unitCost: 12 }],
  });
  await api('POST', '/inventory/adjust', token, { productId: made.never.id, type: 'SET', amount: 24, reason: 'ยอดยกมา' });
  made.sold = await api<{ id: string }>('POST', '/products', token, {
    name: SOLD, basePrice: 65, priceLevel1: 65, costPrice: 45, unit: 'เส้น', barcodes: [SOLD_BARCODE],
  });
  await api('POST', '/inventory/adjust', token, { productId: made.sold.id, type: 'SET', amount: 10, reason: 'ยอดยกมา' });
  const cur = await api<{ id?: string; shift?: { id: string } } | null>('GET', '/shifts/current', token).catch(() => null);
  const shiftId = cur?.id || cur?.shift?.id || (await api<{ shift: { id: string } }>('POST', '/shifts/open', token, { startingCash: 0, terminalId: `e2e-${TAG}` })).shift.id;
  await api('POST', '/orders/checkout', token, {
    clientOrderId: randomUUID(), shiftId, items: [{ productId: made.sold.id, quantity: 1, unitPrice: 65 }], payments: [{ method: 'CASH', amount: 65 }],
  });
});

async function login(page: Page, collapsed = false) {
  await page.addInitScript(([key, v]) => {
    try {
      if (!sessionStorage.getItem('e2e-sidebar-set')) {
        localStorage.setItem(key, v);
        sessionStorage.setItem('e2e-sidebar-set', '1');
      }
    } catch { /* ignore */ }
  }, [COLLAPSED_KEY, collapsed ? '1' : '0']);
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
}

async function openProducts(page: Page, search: string) {
  await page.goto('/products');
  await page.getByLabel(/^ค้นหาสินค้า/).fill(search);
}

const rowOf = (page: Page, name: string) => page.locator('[data-testid="product-row"]').filter({ hasText: name });

test('⋯ menu by keyboard: opens on Enter, arrows move, Escape returns to the button without opening the row; แก้ไข opens the form', async ({ page }) => {
  await login(page);
  await openProducts(page, TAG);
  const row = rowOf(page, NEVER);
  await expect(row).toBeVisible();
  const form = page.getByRole('dialog').filter({ hasText: 'แก้ไขสินค้า' });

  // ↓ from the search box focuses the first row; Tab goes on to its controls, then the ⋯ button
  const button = row.getByRole('button', { name: `จัดการสินค้า ${NEVER}` });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const items = await menu.getByRole('menuitem').allInnerTexts();
  expect(items.map((t) => t.trim())).toEqual(['แก้ไข', 'สต็อกการ์ด / ประวัติความเคลื่อนไหว', 'ปรับสต็อก', 'สร้างสินค้าคล้ายกัน', 'ปิดการใช้งาน', 'ลบสินค้า']);
  await expect(menu.getByRole('menuitem', { name: 'แก้ไข' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: /สต็อกการ์ด/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
  await expect(form).toBeHidden(); // the menu never triggers the row

  // แก้ไข from the menu, by keyboard
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitem', { name: 'แก้ไข' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(form).toBeVisible();
  await expect(form.getByLabel('ชื่อสินค้า *', { exact: true })).toHaveValue(NEVER);
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();

  // row Enter still opens the edit form
  await page.getByLabel(/^ค้นหาสินค้า/).press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(form).toBeVisible();
  await page.keyboard.press('Escape');

  // สร้างสินค้าคล้ายกัน: the add form, prefilled, no SKU
  await button.click();
  await page.getByRole('menuitem', { name: 'สร้างสินค้าคล้ายกัน' }).click();
  const add = page.getByRole('dialog').filter({ hasText: 'เพิ่มสินค้าใหม่' });
  await expect(add.getByLabel('ชื่อสินค้า *', { exact: true })).toHaveValue(`${NEVER} (สำเนา)`);
  await page.keyboard.press('Escape');
  await expect(add).toBeHidden();

  // สต็อกการ์ด opens the inventory page's stock card of this product
  await button.click();
  await page.getByRole('menuitem', { name: /สต็อกการ์ด/ }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole('dialog').filter({ hasText: `สต็อกการ์ด: ${NEVER}` })).toBeVisible();
});

test('delete a never-sold product with stock: the confirmation names the stock, then it is gone', async ({ page }) => {
  await login(page);
  await openProducts(page, TAG);
  const row = rowOf(page, NEVER);
  await row.getByRole('button', { name: `จัดการสินค้า ${NEVER}` }).click();
  await page.getByRole('menuitem', { name: 'ลบสินค้า' }).click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toContainText(`ลบสินค้า "${NEVER}"?`);
  await expect(dialog).toContainText('ยังมีสต็อก 24 ชิ้น มูลค่าทุน ฿288.00 จะถูกลบออกจากคลัง');
  await expect(dialog.getByRole('button', { name: 'ลบสินค้า' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row).toHaveCount(0);
  await expect(api('GET', `/products/${made.never!.id}`, token)).rejects.toThrow();
});

test('a sold product: refused with the bill named, ปิดการใช้งาน offered in the dialog; status filter; greyed row', async ({ page }) => {
  await login(page);
  await openProducts(page, TAG);
  const row = rowOf(page, SOLD);
  await row.getByRole('button', { name: `จัดการสินค้า ${SOLD}` }).click();
  await page.getByRole('menuitem', { name: 'ลบสินค้า' }).click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toContainText(`ลบ "${SOLD}" ไม่ได้`);
  await expect(dialog).toContainText('• บิลขาย 1 ใบ');
  await dialog.getByRole('button', { name: 'ปิดการใช้งาน' }).click();
  await expect(dialog).toBeHidden();
  // default filter = ใช้งาน: it leaves the list
  await expect(row).toHaveCount(0);
  const status = page.getByTestId('product-status-filter');
  await status.getByRole('button', { name: /ปิดใช้งาน/ }).click();
  await expect(rowOf(page, SOLD)).toHaveAttribute('data-inactive', 'true');
  await expect(rowOf(page, SOLD).getByTestId('product-inactive-chip')).toHaveText('ปิดใช้งาน');
  await status.getByRole('button', { name: 'ทั้งหมด' }).click();
  await expect(rowOf(page, SOLD)).toHaveAttribute('data-inactive', 'true');
  // the product is still in the server's data with its bill
  const p = await api<{ isActive: boolean }>('GET', `/products/${made.sold!.id}`, token);
  expect(p.isActive).toBe(false);
  // the menu now offers เปิดใช้งาน
  await rowOf(page, SOLD).getByRole('button', { name: `จัดการสินค้า ${SOLD}` }).click();
  await expect(page.getByRole('menuitem', { name: 'เปิดใช้งาน' })).toBeVisible();
  await page.keyboard.press('Escape');

  // no sideways scroll, 8 px spacing at the owner's sizes in both sidebar states
  for (const collapsed of [false, true]) {
    if (collapsed) await page.keyboard.press('Control+b');
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.waitForTimeout(200);
      expect(await horizontalOverflow(page), `${size.width}x${size.height} collapsed=${collapsed}`).toEqual([]);
      expect(await spacingIssues(page, '[data-testid="product-status-filter"]')).toEqual([]);
    }
  }
  await page.keyboard.press('Control+b');
  await page.setViewportSize(SIZES[0]);
});

test('a disabled product is not found in the POS search; enabled again it is', async ({ page }) => {
  await login(page);
  await page.goto('/pos');
  // no shift on this terminal: skip opening one (searching needs no shift)
  await page.getByRole('button', { name: 'ข้ามการเปิดกะ' }).click();
  const search = page.getByRole('textbox', { name: /ค้นหาสินค้า/ }).first();
  await search.fill(TAG);
  await expect(page.getByTestId('pos-product-card').filter({ hasText: SOLD })).toHaveCount(0);

  await api('POST', '/products/set-active', token, { ids: [made.sold!.id], isActive: true });
  // the POS catalogue catches up through the delta sync (focus / poll)
  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    return page.getByTestId('pos-product-card').filter({ hasText: SOLD }).count();
  }, { timeout: 30_000 }).toBe(1);

  await api('POST', '/products/set-active', token, { ids: [made.sold!.id], isActive: false });
  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    return page.getByTestId('pos-product-card').filter({ hasText: SOLD }).count();
  }, { timeout: 30_000 }).toBe(0);
});
