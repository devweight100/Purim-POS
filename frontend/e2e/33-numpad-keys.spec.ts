import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, cartItems, scan, uiLogin } from './helpers';

/**
 * Owner 2026-11-25 (docs/product-form-bank-logos.md part 1): whenever a numpad / amount dialog appears, keyboard
 * digits work at once, without clicking it first. Every dialog is opened, then digits are typed at a person's
 * speed with NO click into the numpad, and the value is checked.
 * Root cause on 2044860: Base UI gave the first tabbable element (a button) the focus and overruled autoFocus, so
 * the open-shift total, close-shift count, cash count and the item editor ignored typed digits.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-6);
const PRODUCT = { name: `สว่านกระแทกไร้สาย 20V พร้อมดอกสว่าน 13 ชิ้น-${TAG}`, barcode: `8858${TAG}11`, price: 1890 };
const MEMBER = { name: `คุณประหยัด มีเงินเชื่อ ลูกค้าประจำ-${TAG}`, phone: `086${TAG.slice(-6)}91` };
let admin = '';
let debtOrderNumber = '';

/** a person types: 120 ms between keys (a scanner is < 35 ms, docs/pos-keyboard-scan.md) */
async function typeDigits(page: Page, digits: string) {
  for (const d of digits) {
    await page.keyboard.press(d === '.' ? 'Period' : `Digit${d}`);
    await page.waitForTimeout(120);
  }
}
const dialog = (page: Page, text: string | RegExp) => page.getByRole('dialog').filter({ hasText: text }).last();

test.beforeAll(async () => {
  admin = await apiLogin(ADMIN);
  const cashier = await apiLogin(CASHIER);
  // the cashier starts without an open shift (the open-shift dialog is under test)
  const elsewhere = await api<{ id: string }[] | { shifts?: { id: string }[] }>('GET', '/shifts/mine-elsewhere', cashier).catch(() => []);
  const list = Array.isArray(elsewhere) ? elsewhere : elsewhere.shifts || [];
  for (const s of list) await api('POST', `/shifts/${s.id}/close`, cashier, { actualCash: 0 }).catch(() => undefined);
  const p = await api<{ id: string }>('POST', '/products', admin, {
    name: PRODUCT.name, barcodes: [PRODUCT.barcode], unit: 'ชิ้น', basePrice: PRODUCT.price, priceLevel1: PRODUCT.price, costPrice: 1200,
  });
  await api('POST', '/inventory/adjust', admin, { productId: p.id, type: 'ADD', amount: 100, reason: 'ตั้งต้น' });
  const cust = await api<{ id: string }>('POST', '/customers', admin, { name: MEMBER.name, phone: MEMBER.phone, type: 'INDIVIDUAL', priceLevel: 1 });
  const cur = await api<{ id?: string } | null>('GET', `/shifts/current?terminalId=e2e33-${TAG}`, admin).catch(() => null);
  const shiftId = cur?.id || (await api<{ shift: { id: string } }>('POST', '/shifts/open', admin, { startingCash: 0, terminalId: `e2e33-${TAG}` })).shift.id;
  const order = await api<{ orderNumber: string }>('POST', '/orders/checkout', admin, {
    clientOrderId: randomUUID(), shiftId, customerId: cust.id, items: [{ productId: p.id, quantity: 1, unitPrice: PRODUCT.price }],
    payments: [{ method: 'CREDIT_DEBT', amount: PRODUCT.price }],
  });
  debtOrderNumber = order.orderNumber;
});

test('open shift, close shift and the banknote count take keyboard digits without a click', async ({ page }) => {
  await uiLogin(page, CASHIER.username, CASHIER.password);
  await expect(page).toHaveURL(/\/pos/);
  const open = dialog(page, 'ระบุเงินในลิ้นชัก');
  await expect(open).toBeVisible();
  await page.waitForTimeout(400);
  await typeDigits(page, '750');
  await expect(open.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true })).toHaveValue('750');
  await page.keyboard.press('Enter');
  await expect(open).toBeHidden();

  await page.getByRole('button', { name: 'ปิดกะ', exact: true }).click();
  const close = dialog(page, 'ปิดกะการขาย');
  await expect(close).toBeVisible();
  await page.waitForTimeout(400);
  await typeDigits(page, '1250');
  await expect(close.getByLabel('ยอดเงินสดที่นับได้จริง')).toHaveValue('1250');
  // the banknote count (opened with its button; the digits then go to the first note without a click)
  await close.getByTitle('คลิกเพื่อนับแบงค์และเหรียญเหมือนตอนเปิดกะ').click();
  const count = page.getByRole('dialog').filter({ has: page.getByLabel('จำนวน แบงค์ 1,000 ฿') }).last();
  await expect(count).toBeVisible();
  await page.waitForTimeout(400);
  await typeDigits(page, '2');
  await expect(count.getByLabel('จำนวน แบงค์ 1,000 ฿')).toHaveValue('2');
  // Tab to the next note and keep typing (normal field behaviour)
  await page.keyboard.press('Tab');
  await typeDigits(page, '3');
  await expect(count.getByLabel('จำนวน แบงค์ 500 ฿')).toHaveValue('3');
  await page.keyboard.press('Escape');
  await expect(count).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(close).toBeHidden();
});

test('POS numpads: F2 qty, F4 price, F3 item, F9 cash drawer, claim qty, cash received, split by keyboard only', async ({ page }) => {
  await uiLogin(page, CASHIER.username, CASHIER.password);
  // a new browser = a new terminal: continue the shift opened by the first test
  const reopen = dialog(page, 'ระบุเงินในลิ้นชัก');
  const closeBtn = page.getByRole('button', { name: 'ปิดกะ', exact: true });
  await reopen.or(closeBtn).first().waitFor();
  if (await reopen.isVisible()) {
    const cont = reopen.getByRole('button', { name: 'ใช้กะนี้ต่อที่เครื่องนี้' }).first();
    if (await cont.isVisible()) await cont.click();
    else {
      await reopen.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true }).fill('500');
      await reopen.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true }).press('Enter');
    }
  }
  await expect(closeBtn).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('purim-pos-cart'));
  await page.reload();
  await page.waitForTimeout(1500);
  await scan(page, PRODUCT.barcode);
  await expect.poll(async () => (await cartItems(page)).length).toBe(1);

  // F2 quantity (NumpadPopup)
  await page.keyboard.press('F2');
  await expect(dialog(page, 'ระบุจำนวน')).toBeVisible();
  await typeDigits(page, '3');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await cartItems(page))[0]?.quantity).toBe(3);

  // F4 price (NumpadPopup)
  await page.keyboard.press('F4');
  const price = dialog(page, 'แก้ไขราคาขาย');
  await expect(price).toBeVisible();
  await typeDigits(page, '1850');
  await expect(price).toContainText('1,850.00');
  await page.keyboard.press('Escape');
  await expect(price).toBeHidden();

  // F3 item editor: the price field has the focus (it was the "คืนค่าเดิม" button)
  await page.keyboard.press('F3');
  const item = dialog(page, 'แก้ไขรายการ');
  await expect(item).toBeVisible();
  await page.waitForTimeout(300);
  await typeDigits(page, '1800');
  await expect(item.getByLabel('ราคาขายต่อหน่วย')).toHaveValue('1800');
  await page.keyboard.press('Escape');
  await expect(item).toBeHidden();

  // F9 cash drawer amount
  await page.keyboard.press('F9');
  const drawer = dialog(page, 'เปิดลิ้นชัก / จัดการเงินสด');
  await expect(drawer).toBeVisible();
  await page.waitForTimeout(300);
  await typeDigits(page, '200');
  await expect(drawer.getByLabel('จำนวนเงิน', { exact: true })).toHaveValue('200');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // claim quantity
  await page.getByRole('button', { name: 'เคลม', exact: true }).first().click();
  const claim = dialog(page, 'บันทึกสินค้าเคลม');
  await expect(claim).toBeVisible();
  await page.waitForTimeout(300);
  await typeDigits(page, '2');
  await expect(claim.getByLabel('จำนวนที่เคลม')).toHaveValue('2');
  await page.keyboard.press('Escape');
  await expect(claim).toBeHidden();

  // redeem points (member picked with Ctrl+M first)
  await page.keyboard.press('Control+m');
  const pick = page.getByRole('dialog').filter({ has: page.getByRole('textbox') }).last();
  await expect(pick).toBeVisible();
  for (const ch of MEMBER.phone) { await page.keyboard.type(ch); await page.waitForTimeout(60); }
  await expect(pick).toContainText(MEMBER.name);
  await page.keyboard.press('Enter');
  await expect(pick).toBeHidden();
  await page.getByRole('button', { name: /ใช้แต้ม/ }).first().click();
  const redeem = page.getByRole('dialog').filter({ has: page.getByLabel('จำนวนแต้มที่ใช้') });
  await expect(redeem).toBeVisible();
  await page.waitForTimeout(300);
  await typeDigits(page, '40');
  await expect(redeem.getByLabel('จำนวนแต้มที่ใช้')).toHaveValue('40');
  await page.keyboard.press('Escape');
  await expect(redeem).toBeHidden();

  // payment: cash received, typed right after choosing เงินสด
  await page.keyboard.press('F12');
  const pay = dialog(page, 'ยอดรวมสุทธิที่ต้องชำระ');
  await expect(pay.getByRole('button', { name: /เงินสด \(Cash\)/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await typeDigits(page, '6000');
  await expect(page.locator('#pos-cash-received')).toHaveValue('6000');
  // the focus on a banknote button (Tab / touch): the next digits still go to the amount
  await page.getByRole('button', { name: '฿500', exact: true }).focus();
  await typeDigits(page, '5800');
  await expect(page.locator('#pos-cash-received')).toHaveValue('5800');
  // a barcode scanner burst from a button: its digits do not stay in the amount, its Enter confirms nothing
  await page.getByRole('button', { name: '฿500', exact: true }).focus();
  await page.keyboard.type(PRODUCT.barcode, { delay: 5 });
  await page.keyboard.press('Enter');
  await expect(page.locator('#pos-cash-received')).toHaveValue('5800');
  expect((await cartItems(page))[0]?.quantity).toBe(3);
  await page.getByRole('button', { name: 'ย้อนกลับ' }).first().click();
  // split: the transfer part takes the digits (a click right after "ย้อนกลับ" is ignored on purpose)
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /แบ่งชำระ \(Split\)/ }).first().click();
  await page.waitForTimeout(300);
  await typeDigits(page, '1000');
  await expect(page.getByLabel('ยอดโอนเงิน (แบ่งจ่าย)')).toHaveValue('1000');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pos-cash-received, [aria-label="ยอดโอนเงิน (แบ่งจ่าย)"]')).toHaveCount(0);
});

test('back office debt payment: the amount takes keyboard digits without a click', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await page.goto('/debts');
  const row = page.locator('tr', { hasText: debtOrderNumber }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'รับชำระ' }).click();
  const payDebt = dialog(page, 'ระบุจำนวนเงินที่รับชำระ');
  await expect(payDebt).toBeVisible();
  await page.waitForTimeout(400);
  await typeDigits(page, '500');
  await expect(payDebt.getByLabel('จำนวนเงินที่รับชำระ')).toHaveValue('500');
  await page.keyboard.press('Escape');
});
