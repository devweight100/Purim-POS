import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, uiLogin } from './helpers';

/**
 * The shop owner's tester report on v1.5.3 (docs/bugfix-v1.5.3.md), replayed like the tester did it:
 * a new supplier "บริษัททดสอบ จำกัด", a product "น้ำดื่มทดสอบ" (price 20, supplier cost 12, reference cost 12)
 * made through the product form, stock 0 -> 24 through the inventory "ปรับยอด" dialog, then the cashier sells 2
 * on the POS. Each test is one bug; they share the product (serial).
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
const SUPPLIER = `บริษัททดสอบ จำกัด ${TAG}`;
const NAME = `น้ำดื่มทดสอบ 600 มล. ${TAG}`;
const PRICE = 20;
const COST = 12;

let adminToken = '';
const state: { productId?: string } = {};

interface ProductRow {
  id: string;
  name: string;
  stock?: number | string;
  computedStock?: number | string;
  costPrice?: number | string | null;
}
const productByName = async () =>
  (await api<{ data: ProductRow[] }>('GET', `/products/page?page=1&limit=5&q=${encodeURIComponent(NAME)}`, adminToken)).data.find(
    (p) => p.name === NAME,
  );
const stockOf = async () => Number((await productByName())?.stock ?? NaN);

/** POS tile of the test product */
const tile = (page: Page) => page.getByTestId('pos-product-card').filter({ hasText: NAME }).first();

async function openShiftIfAsked(page: Page) {
  const dlg = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  await dlg.or(page.getByRole('button', { name: 'ปิดกะ' })).first().waitFor();
  if (await dlg.isVisible()) {
    await dlg.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true }).fill('700');
    await dlg.getByRole('button', { name: 'ตกลง' }).click();
    await expect(dlg).toBeHidden();
  }
}

async function cashierPage(browser: Browser, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  await uiLogin(page, CASHIER.username, CASHIER.password);
  await expect(page).toHaveURL(/\/pos/);
  await openShiftIfAsked(page);
  return { ctx, page };
}

test.beforeAll(async () => {
  await apiLogin(CASHIER);
  adminToken = await apiLogin(ADMIN);
  await api('POST', '/suppliers', adminToken, { name: SUPPLIER });
});

test('setup: product made through the form, stock 0 -> 24 through the inventory dialog', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/products');
  await page.getByRole('button', { name: 'เพิ่มสินค้าใหม่' }).click();
  const form = page.getByRole('dialog').filter({ hasText: 'เพิ่มสินค้าใหม่' });
  await form.getByLabel('ชื่อสินค้า *', { exact: true }).fill(NAME);
  await form.getByRole('button', { name: 'เพิ่มผู้จำหน่าย' }).click();
  await form.getByLabel('ผู้จำหน่าย 1', { exact: true }).selectOption({ label: SUPPLIER });
  await form.getByLabel('ต้นทุน/ชิ้น ผู้จำหน่าย 1', { exact: true }).fill(String(COST));
  await form.getByLabel('ต้นทุนอ้างอิง (สำหรับแสดงผล/ประมาณการ)', { exact: true }).fill(String(COST));
  await form.getByLabel('ราคา 1', { exact: true }).fill(String(PRICE));
  await form.getByRole('button', { name: 'บันทึกสินค้า' }).click();
  await expect(form).toBeHidden();
  const created = await productByName();
  expect(created).toBeTruthy();
  state.productId = created!.id;

  await page.goto('/inventory');
  await page.locator('tr').filter({ hasText: NAME }).getByRole('button', { name: /ปรับยอด/ }).click();
  const adj = page.getByRole('dialog').filter({ hasText: 'ปรับยอดสต็อกสินค้า' });
  await adj.getByPlaceholder('ระบุจำนวนตัวเลข...').fill('24');
  await adj.getByText('ปรับยอดเริ่มต้น', { exact: true }).click();
  await adj.getByRole('button', { name: 'ยืนยันปรับยอดสต็อก' }).click();
  await expect(page.getByText(/0 ➔ 24/)).toBeVisible();
  expect(await stockOf()).toBe(24);
});

test('BUG-01: cash sale of 2 on a short window (Windows display scaling): confirm visible, typing + Enter saves, stock 24 -> 22', async ({ browser }) => {
  // 1366x768 at 125% = 1093x614 CSS pixels: the confirm button used to sit under the dialog edge (pale, unclickable)
  const { ctx, page } = await cashierPage(browser, { width: 1093, height: 614 });
  try {
    await tile(page).click();
    await tile(page).click();
    await page.getByRole('button', { name: 'ชำระเงิน' }).first().click();
    const pay = page.getByRole('dialog').filter({ hasText: 'เลือกช่องทางการชำระเงิน' });
    await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
    const dlg = page.getByRole('dialog').filter({ hasText: 'รับชำระด้วยเงินสด' });
    const confirm = dlg.getByRole('button', { name: /ยืนยันรับเงินสด/ });
    // nothing received yet: disabled, and the dialog says why
    await expect(confirm).toBeDisabled();
    await expect(dlg.getByTestId('payment-message')).toContainText('พิมพ์จำนวนเงินที่รับมา');
    // the amount field has the keyboard: type 5 -> still short, says how much
    await page.keyboard.type('5');
    await expect(dlg.getByTestId('payment-message')).toContainText('ขาดอีก ฿35');
    await page.keyboard.press('Enter');
    await expect(dlg).toContainText('รับชำระด้วยเงินสด'); // not saved
    await page.keyboard.type('0');
    await expect(confirm).toBeEnabled();
    await expect(dlg).toContainText('฿10'); // change
    // the whole button is inside the window and is what a click there hits
    const box = (await confirm.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(614);
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? '', [
      box.x + box.width / 2,
      box.y + box.height - 3,
    ]);
    expect(hit).toContain('ยืนยันรับเงินสด');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog').filter({ hasText: 'ชำระเงินสำเร็จ!' })).toBeVisible();
    await expect.poll(stockOf).toBe(22);
  } finally {
    await ctx.close();
  }
});

test('BUG-01: banknote buttons at 1366x768 and 1920x1080; Enter after a banknote confirms (does not add it again)', async ({ browser }) => {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    const before = await stockOf();
    const { ctx, page } = await cashierPage(browser, viewport);
    try {
      await tile(page).click();
      await page.getByRole('button', { name: 'ชำระเงิน' }).first().click();
      await page.getByRole('dialog').getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
      const dlg = page.getByRole('dialog').filter({ hasText: 'รับชำระด้วยเงินสด' });
      await dlg.getByRole('button', { name: '฿50', exact: true }).click();
      await expect(dlg.getByTestId('cash-received-input')).toHaveValue('50');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog').filter({ hasText: 'ชำระเงินสำเร็จ!' })).toContainText('฿30');
      await expect.poll(stockOf).toBe(before - 1);
    } finally {
      await ctx.close();
    }
  }
});
