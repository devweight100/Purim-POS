import { expect, test, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, expectCartQty, scan, uiLogin } from './helpers';

/**
 * One cashier's day on the POS, in order: open shift -> cash sale by scanning -> credit sale ->
 * partial return (by the manager) -> close shift with counted cash -> log out.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let adminToken = '';
const state: { cashOrder?: any; creditOrder?: any } = {};

const STARTING_CASH = 1500;
const WATER = { sku: 'DRK-SINGHA-600', name: 'น้ำดื่มสิงห์ 600ml', price: 12 };
const RICE = { sku: 'RICE-JAS-5KG', barcode: '885000000001', name: 'ข้าวหอมมะลิ 5 กก.', price: 189 };
const CASH_TOTAL = 2 * WATER.price + RICE.price; // 213

const latestShift = async () => (await api('GET', '/shifts/history?limit=1', adminToken)).data[0];
const findOrder = async (predicate: (o: any) => boolean) =>
  ((await api('GET', '/orders?limit=20', adminToken)).data as any[]).find(predicate);

/** Close the payment success window (it also closes by itself after a countdown). */
async function finishPayment() {
  await page
    .getByRole('button', { name: 'ปิดหน้าต่าง (เริ่มออเดอร์ใหม่)' })
    .click({ timeout: 3000 })
    .catch(() => undefined);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.beforeAll(async ({ browser }) => {
  await apiLogin(CASHIER); // makes sure the default password was changed (also when run alone)
  adminToken = await apiLogin(ADMIN);
  page = await browser.newPage();
  await uiLogin(page, CASHIER.username, CASHIER.password);
  await expect(page).toHaveURL(/\/pos/);
});

test.afterAll(async () => {
  await page?.close();
});

test('open shift with starting cash', async () => {
  const dialog = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('ยอดเงินรวมในลิ้นชัก').fill(String(STARTING_CASH));
  await dialog.getByRole('button', { name: 'ตกลง' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'ปิดกะ' })).toBeVisible();

  const shift = await latestShift();
  expect(shift).toMatchObject({ isOpen: true, openingCash: STARTING_CASH });
});

test('sell by scanning a hyphenated SKU and pay cash; the receipt shows the totals', async () => {
  await expect(page.getByText(WATER.name).first()).toBeVisible();
  await scan(page, WATER.sku);
  await expectCartQty(page, WATER.sku, 1);
  await scan(page, WATER.sku);
  await scan(page, RICE.barcode);
  await expectCartQty(page, WATER.sku, 2);
  await expectCartQty(page, RICE.sku, 1);

  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  const pay = page.getByRole('dialog');
  await expect(pay).toContainText('฿213');
  await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
  await pay.getByRole('button', { name: '฿500', exact: true }).click();
  await expect(pay).toContainText('฿287'); // change
  await pay.getByRole('button', { name: 'ยืนยันรับเงินสด' }).click();
  await expect(pay).toContainText('ชำระเงินสำเร็จ!');

  await pay.getByRole('button', { name: 'ดูตัวอย่าง / PDF' }).click();
  const receipt = page.getByRole('dialog').filter({ hasText: 'ตัวอย่างใบเสร็จรับเงิน' });
  await expect(receipt).toBeVisible();
  const text = (await receipt.innerText()).replace(/\s+/g, ' ');
  expect(text).toMatch(/เลขที่บิล: ORD-\d+/);
  expect(text).toContain(`${WATER.name} 2 ชิ้น x ฿12 ฿24`);
  expect(text).toContain(`${RICE.name} 1 ชิ้น x ฿189 ฿189`);
  expect(text).toContain('รวมเงิน: ฿213');
  expect(text).toContain('ยอดรวมสุทธิ: ฿213');
  expect(text).toContain('ชำระโดย: เงินสด');
  expect(text).toContain('รับเงินมา: ฿500');
  expect(text).toContain('เงินทอน: ฿287');
  await page.keyboard.press('Escape');
  await expect(receipt).toBeHidden();
  await finishPayment();

  state.cashOrder = await findOrder((o) => Number(o.totalAmount) === CASH_TOTAL);
  expect(state.cashOrder).toBeTruthy();
  expect(state.cashOrder.payments.map((p: any) => p.method)).toEqual(['CASH']);
});

test('credit sale to a customer', async () => {
  await scan(page, RICE.sku);
  await expectCartQty(page, RICE.sku, 1);
  await page.getByRole('button', { name: 'เลือกลูกค้า' }).click();
  const pick = page.getByRole('dialog').filter({ hasText: 'เลือกลูกค้าสมาชิก' });
  await pick.getByPlaceholder('พิมพ์ค้นหาชื่อ, เบอร์โทร, เลขผู้เสียภาษี Tax ID...').fill('ประหยัด');
  await pick.getByText('ประหยัด อดออม').first().click();
  await expect(pick).toBeHidden();

  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  const pay = page.getByRole('dialog');
  await pay.getByRole('button', { name: /เงินเชื่อ \(ประหยัด อดออม/ }).click();
  await expect(pay).toContainText('บันทึกเป็นเงินเชื่อ (ค้างชำระ)');
  await pay.getByRole('button', { name: 'ยืนยันบันทึกหนี้' }).click();
  await expect(pay).toContainText('ฐานข้อมูลยืนยันรายการเรียบร้อยแล้ว');
  await finishPayment();

  state.creditOrder = await findOrder((o) => o.customer?.name?.includes('ประหยัด'));
  expect(state.creditOrder).toBeTruthy();
  expect(Number(state.creditOrder.totalAmount)).toBe(RICE.price);
  expect(state.creditOrder.payments.map((p: any) => p.method)).toEqual(['CREDIT_DEBT']);
  const debts = await api('GET', '/debts', adminToken);
  expect(JSON.stringify(debts)).toContain(state.creditOrder.id);
});

test('partial return by the manager', async ({ browser }) => {
  const ctx = await browser.newContext();
  const mgr = await ctx.newPage();
  try {
    await uiLogin(mgr, ADMIN.username, ADMIN.password);
    await expect(mgr).toHaveURL(/\/pos/);
    await mgr.goto('/orders');
    await mgr.getByText(state.cashOrder.orderNumber).first().click();
    await mgr.getByRole('button', { name: 'รับคืนสินค้า', exact: true }).click();
    const dlg = mgr.getByRole('dialog').filter({ hasText: `รับคืนสินค้า บิล ${state.cashOrder.orderNumber}` });
    await dlg.locator('tbody tr').filter({ hasText: WATER.name }).locator('input[type=number]').fill('1');
    await dlg.getByPlaceholder('เหตุผล เช่น ลูกค้าซื้อเกิน, สินค้าไม่ตรงรุ่น').fill('ลูกค้าซื้อเกิน');
    // money back by transfer: the cashier's drawer is not touched
    await dlg.getByRole('button', { name: 'โอนคืน' }).click();
    await expect(dlg).toContainText('฿12');
    await dlg.getByRole('button', { name: 'ยืนยันรับคืน' }).click();
    await expect(mgr.getByText(/บันทึกรับคืน .* คืนเงิน ฿12 แล้ว/)).toBeVisible();
  } finally {
    await ctx.close();
  }

  const returns = await api<any[]>('GET', `/orders/${state.cashOrder.id}/returns`, adminToken);
  expect(returns).toHaveLength(1);
  expect(Number(returns[0].refundAmount)).toBe(WATER.price);
  expect(returns[0].refundMethod).toBe('TRANSFER');
});

test('close shift with counted cash', async () => {
  const expected = STARTING_CASH + CASH_TOTAL; // the credit sale and the transfer refund do not touch the drawer
  await page.getByRole('button', { name: 'ปิดกะ' }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: 'ปิดกะการขาย' });
  await expect(dlg).toContainText('เงินสดที่ควรมีในลิ้นชัก');
  await expect(dlg).toContainText('฿1,713');
  await dlg.getByPlaceholder('0.00').fill(String(expected));
  await expect(dlg).toContainText('ยอดเงินสดในลิ้นชักพอดี');
  await dlg.getByRole('button', { name: 'ยืนยันปิดกะ' }).click();
  await expect(dlg).toBeHidden();

  const shift = await latestShift();
  expect(shift).toMatchObject({ isOpen: false, actualCash: expected, difference: 0, status: 'BALANCED' });
  expect(shift.orderCount).toBe(2);
});

test('logout button returns to the login page', async () => {
  // close whatever the shift close left open (summary / open-shift prompt)
  for (let i = 0; i < 3 && (await page.getByRole('dialog').count()) > 0; i++) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'ออกจากระบบ' }).first().click();
  const dlg = page.getByRole('dialog').filter({ hasText: 'ออกจากระบบ' });
  await dlg.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/pos');
  await expect(page).toHaveURL(/\/login/);
});
