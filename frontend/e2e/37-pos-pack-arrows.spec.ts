import { expect, test, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, cartItems, uiLogin } from './helpers';

/**
 * Owner 2026-11-25: in the POS search, arrows to an item with several packs (e.g. "ถังทราย 9211" + ลัง), Enter
 * put the FIRST search result in the cart. Root cause (list layout): the highlighted row index was never reset
 * when the search text changed, so the next search started on an old row and the arrows landed on another item
 * (often the first, by wrap-around); the default-unit pill of every row looked exactly like the chosen one.
 * Also an exact code match won over an arrow choice. Card layout: the packs of a card were not reachable by arrows.
 * Rule now: Enter adds exactly the highlighted product + unit once the arrows were used; without arrows as before.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
const A = `ถังทราย ดับเพลิง ${TAG}`; // single unit, first result
const B = `ถังทราย สีแดง 9211${TAG}`; // + ลัง (6), in the middle
const C = `ถังทราย ฝาปิด ${TAG}`; // + แพ็ค (2), last
const A_CODE = `9211${TAG}`; // A's barcode is also part of B's name

const lines = async (page: Page) => (await cartItems(page) as unknown as Array<{ name: string; unitName: string; quantity: number }>).map((i) => `${i.name} | ${i.unitName} | ${i.quantity}`);

async function ensureShift(page: Page) {
  const shiftDlg = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  await shiftDlg.or(page.getByRole('button', { name: 'ปิดกะ', exact: true })).first().waitFor();
  if (await shiftDlg.isVisible()) {
    await shiftDlg.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true }).fill('500');
    await shiftDlg.getByRole('button', { name: 'ตกลง' }).click();
    await expect(shiftDlg).toBeHidden();
  }
}

async function openPos(page: Page, mode: 'list_view' | 'touch_screen') {
  await page.addInitScript((m) => localStorage.setItem('pos_screen_mode', m), mode);
  await uiLogin(page, CASHIER.username, CASHIER.password);
  await expect(page).toHaveURL(/\/pos/);
  await ensureShift(page);
  await page.evaluate(() => localStorage.removeItem('purim-pos-cart'));
  await page.reload();
  await ensureShift(page);
}

/** keys one by one, at a person's pace */
async function keys(page: Page, ...list: string[]) {
  for (const k of list) {
    await page.keyboard.press(k);
    await page.waitForTimeout(60);
  }
}

test.beforeAll(async () => {
  await apiLogin(CASHIER);
  const t = await apiLogin(ADMIN);
  const defs = [
    { name: A, barcodes: [A_CODE] },
    { name: B, packagingUnits: [{ name: 'ลัง', qtyPerPrev: 6, priceLevel1: 540 }] },
    { name: C, packagingUnits: [{ name: 'แพ็ค', qtyPerPrev: 2, priceLevel1: 190 }] },
  ];
  for (const d of defs) {
    const p = await api<{ id: string }>('POST', '/products', t, { unit: 'ถัง', basePrice: 100, priceLevel1: 100, costPrice: 50, ...d });
    await api('POST', '/inventory/adjust', t, { productId: p.id, type: 'ADD', amount: 100, reason: 'ปรับยอดเริ่มต้น' });
  }
});

test('list layout: arrows to the ลัง of the 2nd result + Enter adds exactly that, also on the next search; without arrows as before', async ({ page }) => {
  await openPos(page, 'list_view');
  const search = page.getByPlaceholder('ชื่อ / ซีเรียล / บาร์โค้ด');
  const rows = page.getByTestId('pos-search-row');
  const current = page.locator('[data-testid="pos-search-row"][data-current="true"]');
  const chosen = current.locator('[data-testid="pos-search-unit"][aria-pressed="true"]');

  await search.click();
  await page.keyboard.type('ถังทราย', { delay: 30 });
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText(A); // B is not the first result
  await keys(page, 'ArrowDown', 'ArrowRight');
  await expect(current).toContainText(B);
  await expect(chosen).toContainText('ลัง');
  // only the highlighted row has the strong pill
  await expect(page.locator('[data-testid="pos-search-unit"][aria-pressed="true"]')).toHaveCount(1);
  await keys(page, 'ArrowRight'); // past the last unit: stays on ลัง
  await expect(chosen).toContainText('ลัง');
  await keys(page, 'Enter');
  await expect.poll(() => lines(page)).toEqual([`${B} | ลัง | 1`]);

  // the very next search starts on row 1 again (it used to keep row 2, so ↓ landed on another item)
  await search.click();
  await page.keyboard.type('ถังทราย', { delay: 30 });
  await expect(current).toContainText(A);
  await keys(page, 'ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'Enter');
  await expect.poll(() => lines(page)).toEqual([`${B} | ลัง | 2`]);

  // text that is also an exact code (A's barcode): the arrow choice wins ...
  await search.click();
  await page.keyboard.type(A_CODE, { delay: 30 });
  await expect(rows).toHaveCount(2);
  await keys(page, 'ArrowDown', 'ArrowRight', 'Enter');
  await expect.poll(() => lines(page)).toEqual([`${B} | ลัง | 3`]);
  // ... and without arrows Enter is the scan of that code, as before
  await search.click();
  await page.keyboard.type(A_CODE, { delay: 30 });
  await keys(page, 'Enter');
  await expect.poll(() => lines(page)).toEqual([`${B} | ลัง | 3`, `${A} | ถัง | 1`]);
  // no arrows, plain text: the first result, as before
  await search.click();
  await page.keyboard.type('ถังทราย', { delay: 30 });
  await keys(page, 'Enter');
  await expect.poll(() => lines(page)).toEqual([`${B} | ลัง | 3`, `${A} | ถัง | 2`]);
});

test('card layout: ←/→ go through the packs of a card (highlighted), then to the next card; Enter adds the highlighted pack', async ({ page }) => {
  await openPos(page, 'touch_screen');
  const search = page.getByLabel(/^ค้นหาสินค้า/);
  const cards = page.locator('[data-pos-grid] [data-testid="pos-product-card"]');
  const card = (name: string) => cards.filter({ hasText: name });
  const active = (name: string) => card(name).locator('[data-testid="pos-card-unit"][aria-pressed="true"]');

  await search.click();
  await page.keyboard.type('ถังทราย', { delay: 30 });
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText(A);
  await keys(page, 'ArrowDown');
  await expect(card(A)).toBeFocused();
  await keys(page, 'ArrowRight');
  await expect(card(B)).toBeFocused();
  await expect(active(B)).toContainText('ถัง');
  await keys(page, 'ArrowRight'); // the ลัง of B, the focus stays on B
  await expect(card(B)).toBeFocused();
  await expect(active(B)).toContainText('ลัง');
  await expect(card(B)).toHaveAttribute('aria-label', /ลัง/);
  await keys(page, 'Enter');
  await expect.poll(() => lines(page)).toEqual([`${B} | ลัง | 1`]);

  // → past the last pack moves on to C (B goes back to its default unit); ← comes back to B, then A
  await keys(page, 'ArrowRight');
  await expect(card(C)).toBeFocused();
  await expect(active(B)).toContainText('ถัง');
  await keys(page, 'ArrowRight');
  await expect(active(C)).toContainText('แพ็ค');
  await keys(page, 'ArrowLeft', 'ArrowLeft');
  await expect(card(B)).toBeFocused();
  await keys(page, 'ArrowLeft');
  await expect(card(A)).toBeFocused();

  // no arrows: Enter in the search box adds the first result, as before
  await search.click();
  await search.fill('');
  await page.keyboard.type('ถังทราย', { delay: 30 });
  await keys(page, 'Enter');
  await expect.poll(() => lines(page)).toEqual([`${B} | ลัง | 1`, `${A} | ถัง | 1`]);
});
