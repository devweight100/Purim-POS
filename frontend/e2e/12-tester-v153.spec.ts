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
  await dlg.or(page.getByRole('button', { name: 'ปิดกะ', exact: true })).first().waitFor();
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

test('setup + BUG-10: product made through the form, stock 0 -> 24 through the inventory dialog (reason must be chosen)', async ({ page }) => {
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
  await page.getByPlaceholder('ค้นหาชื่อสินค้า, SKU, บาร์โค้ด...').fill(NAME);
  await page.locator('tr').filter({ hasText: NAME }).getByRole('button', { name: /ปรับยอด/ }).click();
  const adj = page.getByRole('dialog').filter({ hasText: 'ปรับยอดสต็อกสินค้า' });
  await adj.getByPlaceholder('ระบุจำนวนตัวเลข...').fill('24');
  // BUG-10: no reason chosen in advance; confirming needs one
  await expect(adj.locator('input[name=adjustReason]:checked')).toHaveCount(0);
  await expect(adj.getByTestId('adjust-reason-required')).toBeVisible();
  await expect(adj.getByRole('button', { name: 'ยืนยันปรับยอดสต็อก' })).toBeDisabled();
  await adj.getByText('ปรับยอดเริ่มต้น', { exact: true }).click();
  await expect(adj.getByTestId('adjust-reason-required')).toHaveCount(0);
  await adj.getByRole('button', { name: 'ยืนยันปรับยอดสต็อก' }).click();
  await expect(page.getByText(/ปรับสต็อก .* เรียบร้อย: 0 ➔ 24/)).toBeVisible();
  await expect.poll(stockOf).toBe(24);
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

test('BUG-02: the POS card always shows stock left and follows a stock adjustment made elsewhere at once; a sale lowers both', async ({ browser }) => {
  const { ctx, page } = await cashierPage(browser, { width: 1366, height: 768 });
  try {
    const start = await stockOf();
    await expect(tile(page).getByTestId('pos-card-stock')).toHaveText(`คงเหลือ ${start}`);
    // the back office adjusts +4 (another screen): the open POS shows it well before the 15 s poll
    await api('POST', '/inventory/adjust', adminToken, { productId: state.productId, type: 'ADD', amount: 4, reason: 'ปรับยอดเริ่มต้น' });
    await expect(tile(page).getByTestId('pos-card-stock')).toHaveText(`คงเหลือ ${start + 4}`, { timeout: 6000 });
    // a sale lowers the card and the server equally
    await tile(page).click();
    await page.getByRole('button', { name: 'ชำระเงิน' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog').filter({ hasText: 'ชำระเงินสำเร็จ!' })).toBeVisible();
    await expect.poll(stockOf).toBe(start + 3);
    await expect(tile(page).getByTestId('pos-card-stock')).toHaveText(`คงเหลือ ${start + 3}`, { timeout: 6000 });
  } finally {
    await ctx.close();
  }
  // "restart": a new window shows the same number
  const again = await cashierPage(browser, { width: 1366, height: 768 });
  try {
    await expect(tile(again.page).getByTestId('pos-card-stock')).toHaveText(`คงเหลือ ${await stockOf()}`);
  } finally {
    await again.ctx.close();
  }
});

test('BUG-03: the open shift survives a restart that lost the browser storage: the POS offers to continue it (same float)', async ({ browser }) => {
  // first run of the day: open the shift with ฿700 counted as 500x1 + 100x2
  const first = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH' });
  const page1 = await first.newPage();
  await uiLogin(page1, CASHIER.username, CASHIER.password);
  const dlg1 = page1.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  await expect(dlg1).toBeVisible();
  await dlg1.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true }).fill('700');
  await dlg1.getByRole('button', { name: 'ตกลง' }).click();
  await expect(page1.getByText(/เปิดกะสำเร็จ! เงินตั้งต้นลิ้นชัก ฿700/)).toBeVisible();
  const terminalId = await page1.evaluate(() => localStorage.getItem('purim_terminal_id'));
  const opened = await api<{ shift: { id: string; shiftNumber: string } }>('GET', `/shifts/current?terminalId=${terminalId}`, await apiLogin(CASHIER));
  await first.close();

  // the app comes back with its storage gone (ended without a clean shutdown): new terminal id, logged out
  const second = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH' });
  const page2 = await second.newPage();
  try {
    await uiLogin(page2, CASHIER.username, CASHIER.password);
    const dlg2 = page2.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
    const banner = dlg2.getByTestId('shift-elsewhere');
    await expect(banner).toContainText(opened.shift.shiftNumber);
    await expect(banner).toContainText('฿700');
    await banner.locator('div').filter({ hasText: opened.shift.shiftNumber }).getByRole('button', { name: 'ใช้กะนี้ต่อที่เครื่องนี้' }).click();
    await expect(dlg2).toBeHidden();
    await expect(page2.getByRole('button', { name: 'ปิดกะ', exact: true })).toBeVisible();
    // same shift, same float, no second shift opened
    expect(await page2.evaluate(() => localStorage.getItem('purim_terminal_id'))).toBe(terminalId);
    const now = await api<{ shift: { id: string }; startingCash: number | string }>('GET', `/shifts/current?terminalId=${terminalId}`, await apiLogin(CASHIER));
    expect(now.shift.id).toBe(opened.shift.id);
    expect(Number(now.startingCash)).toBe(700);
    // a reload keeps it without asking again
    await page2.reload();
    await expect(page2.getByRole('button', { name: 'ปิดกะ', exact: true })).toBeVisible();
    await expect(page2.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' })).toHaveCount(0);
  } finally {
    await second.close();
  }
});

test('BUG-04: shift cash counts are typed from the keyboard (Tab between notes, Enter confirms) when opening and closing', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH' });
  const page = await ctx.newPage();
  try {
    await uiLogin(page, CASHIER.username, CASHIER.password);
    const dlg = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
    await expect(dlg).toBeVisible();
    await dlg.getByLabel('จำนวน แบงค์ 500 ฿').focus();
    await page.keyboard.type('1');
    await page.keyboard.press('Tab'); // -> 100
    await expect(dlg.getByLabel('จำนวน แบงค์ 100 ฿')).toBeFocused();
    await page.keyboard.type('2');
    await expect(page.getByRole('dialog').filter({ hasText: 'ระบุจำนวน:' })).toHaveCount(0); // no numpad in the way
    await expect(dlg.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true })).toHaveValue('700');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/เปิดกะสำเร็จ! เงินตั้งต้นลิ้นชัก ฿700/)).toBeVisible();
    await expect(dlg).toBeHidden();

    // closing: count the drawer the same way
    await page.getByRole('button', { name: 'ปิดกะ', exact: true }).click();
    const close = page.getByRole('dialog').filter({ hasText: 'ปิดกะการขาย (Close Shift)' });
    await close.getByTitle('คลิกเพื่อนับแบงค์และเหรียญเหมือนตอนเปิดกะ').click();
    const count = page.getByRole('dialog').filter({ hasText: 'ยอดเงินสดจากการนับแบงค์/เหรียญ' });
    await count.getByLabel('จำนวน แบงค์ 500 ฿').focus();
    await page.keyboard.type('1');
    await page.keyboard.press('Tab');
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    await expect(count).toBeHidden();
    await expect(close.getByPlaceholder('0.00')).toHaveValue('700');
    await expect(close).toContainText('ยอดเงินสดในลิ้นชักพอดี');
  } finally {
    await ctx.close();
  }
});

test('BUG-05: cost columns and stock value use the recorded cost (12), never the selling price (20)', async ({ page }) => {
  type PageRes = { data: Array<{ id: string; unitCost?: number | null }>; stats: { totalValuation: number } };
  const pageRes = () => api<PageRes>('GET', `/products/page?page=1&limit=5&stats=1&q=${encodeURIComponent(NAME)}`, adminToken);
  const before = await pageRes();
  expect(before.data[0].unitCost).toBe(COST);
  // +1 at the batch cost moves the stock value by the cost, not by the price
  await api('POST', '/inventory/adjust', adminToken, { productId: state.productId, type: 'ADD', amount: 1, reason: 'ปรับยอดเริ่มต้น' });
  const after = await pageRes();
  expect(after.stats.totalValuation - before.stats.totalValuation).toBeCloseTo(COST, 6);
  // the cashier sees no cost at all
  const cashierRows = await api<PageRes>('GET', `/products/page?page=1&limit=5&q=${encodeURIComponent(NAME)}`, await apiLogin(CASHIER));
  expect(cashierRows.data[0]).not.toHaveProperty('unitCost');

  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/products');
  await page.getByPlaceholder(/ค้นหา/).first().fill(NAME);
  await expect(page.locator('tr').filter({ hasText: NAME }).getByTestId('product-cost')).toHaveText('฿12');
  await page.goto('/inventory');
  await page.getByPlaceholder('ค้นหาชื่อสินค้า, SKU, บาร์โค้ด...').fill(NAME);
  const row = page.locator('tr').filter({ hasText: NAME });
  await expect(row).toContainText('฿12');
  await expect(row).not.toContainText('฿20');
});

test('BUG-06: the supplier and its cost chosen when creating the product are saved and shown when editing; edits are saved', async ({ page }) => {
  const supplierRows = async () =>
    (await api<{ supplierEntries: Array<{ supplier?: { name?: string } | null; supplierName?: string; unitCost: number | string }> }>('GET', `/products/${state.productId}`, adminToken))
      .supplierEntries.map((e) => [e.supplierName || e.supplier?.name, Number(e.unitCost)]);
  expect(await supplierRows()).toEqual([[SUPPLIER, COST]]);

  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/products');
  await page.getByPlaceholder('ค้นหาชื่อ, รหัส, บาร์โค้ด...').fill(NAME);
  const openEdit = async () => {
    await page.locator('tr').filter({ hasText: NAME }).getByRole('button').last().click();
    return page.getByRole('dialog').filter({ hasText: 'แก้ไขสินค้า' });
  };
  let form = await openEdit();
  await expect(form).not.toContainText('ยังไม่มีผู้จำหน่าย');
  await expect(form.getByLabel('ผู้จำหน่าย 1', { exact: true }).locator('option:checked')).toHaveText(SUPPLIER);
  await expect(form.getByLabel('ต้นทุน/ชิ้น ผู้จำหน่าย 1', { exact: true })).toHaveValue(String(COST));
  await form.getByLabel('ต้นทุน/ชิ้น ผู้จำหน่าย 1', { exact: true }).fill('11');
  await form.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
  await expect(form).toBeHidden();
  await expect.poll(supplierRows).toEqual([[SUPPLIER, 11]]);
  form = await openEdit();
  await expect(form.getByLabel('ต้นทุน/ชิ้น ผู้จำหน่าย 1', { exact: true })).toHaveValue('11');
});

test('BUG-12: double click on ย้อนกลับ does not open the method card under the pointer; Escape closes one window at a time', async ({ browser }) => {
  const { ctx, page } = await cashierPage(browser, { width: 1280, height: 720 });
  try {
    await tile(page).click();
    await page.getByRole('button', { name: 'ชำระเงิน' }).first().click();
    const pay = page.getByRole('dialog').first();
    await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
    const back = (await pay.getByRole('button', { name: 'ย้อนกลับ' }).boundingBox())!;
    const x = back.x + back.width / 2;
    const y = back.y + back.height / 2;
    await page.mouse.click(x, y);
    // the second click of the double click lands on the "แบ่งชำระ" card (this window size puts it there)
    const split = (await pay.getByRole('button', { name: /แบ่งชำระ \(Split\)/ }).boundingBox())!;
    expect(x >= split.x && x <= split.x + split.width && y >= split.y && y <= split.y + split.height).toBe(true);
    await page.mouse.click(x, y);
    await expect(pay).toContainText('เลือกช่องทางการชำระเงิน');
    await expect(pay).not.toContainText('รับชำระแบบแบ่งจ่าย');
    // a deliberate click a moment later still works
    await page.waitForTimeout(700);
    await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
    await expect(pay).toContainText('รับชำระด้วยเงินสด');

    // Escape with the numpad open closes only the numpad, the next Escape the payment window; nothing else opens
    const dialogs = page.locator('[role="dialog"]');
    await pay.getByRole('button', { name: 'เปิด Numpad' }).click();
    await expect(dialogs.filter({ hasText: 'ระบุจำนวนเงินสดที่รับ' })).toHaveCount(1);
    await expect(dialogs).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(dialogs).toHaveCount(1);
    await expect(dialogs).toContainText('รับชำระด้วยเงินสด');
    await page.keyboard.press('Escape');
    await expect(dialogs).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialogs).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
