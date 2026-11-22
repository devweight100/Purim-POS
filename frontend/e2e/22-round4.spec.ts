import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';
import { listDate } from '../../shared/src/thai-date';

/**
 * UI round 4 (owner 2026-11-18):
 * - payables bills: only เลขที่เอกสาร / วันที่ / บริษัท / ยอดเอกสาร with a paid progress bar; one "⋯" menu per row
 *   usable by keyboard; a row click / Enter opens the bill details; the ⋯ button never opens the details;
 * - tables show "18 พ.ย. 69" without time, the orders list keeps the time; new document numbers <PP><YYMM>-<NNNN>.
 */
test.describe.configure({ mode: 'serial' });

const TAG = `R4${String(Date.now()).slice(-6)}`;
const NO_TIME = /\d{1,2}:\d{2}/;
const NEW_NUMBER = (p: string) => new RegExp(`^${p}\\d{4}-\\d{4}$`);
let token = '';
const made: { sup?: { id: string; name: string }; bills: { id: string; poNumber: string; amount: number }[] } = { bills: [] };

test.beforeAll(async () => {
  token = await apiLogin(ADMIN);
  made.sup = await api<{ id: string; name: string }>('POST', '/suppliers', token, { name: `บริษัท ทดสอบเจ้าหนี้รอบสี่ ${TAG} จำกัด`, creditTerms: 30 });
  const prod = await api<{ id: string }>('POST', '/products', token, { name: `สินค้า ${TAG}`, basePrice: 50, priceLevel1: 50, unit: 'ชิ้น' });
  for (const cost of [1000, 2000, 3000]) {
    const po = await api<{ id: string; poNumber: string; items: { id: string }[] }>('POST', '/purchase-orders', token, {
      supplierId: made.sup.id, status: 'ISSUED', items: [{ productId: prod.id, quantity: 1, unitCost: cost }],
    });
    await api('POST', `/purchase-orders/${po.id}/receive`, token, {
      clientReceiptId: randomUUID(), items: [{ purchaseOrderItemId: po.items[0].id, receivedQty: 1, unitCost: cost }],
    });
    made.bills.push({ id: po.id, poNumber: po.poNumber, amount: cost });
  }
  // 2000 bill: 500 paid (partial); 3000 bill: paid in full; 1000 bill: unpaid
  const pay = (poId: string, amount: number) => api('POST', '/payables/settle-multiple', token, {
    supplierId: made.sup!.id, billsToSettle: [{ poId, amountToPay: amount }], matchedDebitNotes: [], discountAmount: 0,
    paymentMethod: 'TRANSFER', clientVoucherId: randomUUID(), note: 'e2e round 4',
  });
  await pay(made.bills[1].id, 500);
  await pay(made.bills[2].id, 3000);
});

async function openPayables(page: Page) {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/payables');
  await page.getByPlaceholder('ค้นหาเลขที่ PO, ชื่อบริษัทผู้จำหน่าย...').fill(TAG);
  await expect(page.locator('[data-testid="payable-bills-table"] tbody tr')).toHaveCount(3);
}

test('payables: 4 columns with a paid progress bar, new PO numbers, list dates without time', async ({ page }) => {
  await openPayables(page);
  const table = page.getByTestId('payable-bills-table');
  const heads = (await table.locator('thead th').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  // (+ the screen-reader name of the ⋯ column)
  expect(heads).toEqual(['เลขที่เอกสาร', 'วันที่', 'บริษัท', 'ยอดเอกสาร', 'การจัดการ']);
  const row = (i: number) => table.locator('tbody tr', { hasText: made.bills[i].poNumber });
  for (const b of made.bills) expect(b.poNumber).toMatch(NEW_NUMBER('PO'));

  await expect(row(0).getByTestId('bill-progress')).toHaveAttribute('data-state', 'unpaid');
  await expect(row(0).getByTestId('bill-progress')).toContainText('จ่ายแล้ว ฿0.00 / ค้าง ฿1,000.00');
  await expect(row(1).getByTestId('bill-progress')).toHaveAttribute('data-state', 'partial');
  await expect(row(1).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  await expect(row(1).getByTestId('bill-progress')).toContainText('จ่ายแล้ว ฿500.00 / ค้าง ฿1,500.00');
  await expect(row(1).getByTestId('bill-progress')).toHaveAttribute('title', /จ่ายเงินแล้ว ฿500\.00/);
  await expect(row(2).getByTestId('bill-progress')).toHaveAttribute('data-state', 'paid');
  await expect(row(2).getByTestId('bill-progress')).toContainText('ชำระครบแล้ว');
  // the amount column is the document total
  await expect(row(1)).toContainText('฿2,000');
  // date: "18 พ.ย. 69", no time
  const date = (await row(0).getByTestId('bill-date').innerText()).trim();
  expect(date).toBe(listDate(new Date()));
  expect(date).not.toMatch(NO_TIME);

  for (const collapsed of [false, true]) {
    if (collapsed) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Control+b');
    }
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.waitForTimeout(250);
      expect({ size, collapsed, overflow: await horizontalOverflow(page) }).toEqual({ size, collapsed, overflow: [] });
      const menu = (await row(1).getByTestId('bill-actions').boundingBox())!;
      expect(menu.x + menu.width).toBeLessThanOrEqual(size.width - 16);
    }
  }
});

test('payables: ⋯ menu by keyboard (same actions + confirmations), row click / Enter open the details, ⋯ never does', async ({ page }) => {
  await openPayables(page);
  const table = page.getByTestId('payable-bills-table');
  const partial = table.locator('tbody tr', { hasText: made.bills[1].poNumber });
  const details = page.getByRole('dialog').filter({ hasText: 'รายละเอียดบิลเจ้าหนี้' });

  // keyboard: Tab-reachable ⋯ button, Enter opens the menu on its first item, ↓ moves, Escape gives the focus back
  const more = partial.getByRole('button', { name: `การจัดการบิล ${made.bills[1].poNumber}` });
  await more.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const items = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
  expect(items).toEqual(['ดูรายละเอียดบิล', 'ชำระเงิน / ประกบใบลดหนี้', 'ระบุ / แก้ไขเลขที่บิลผู้จำหน่าย', 'พิมพ์ใบสั่งซื้อ (PDF)', 'ดู / พิมพ์ใบสำคัญจ่ายล่าสุด', 'ย้อนสถานะการชำระเงิน...']);
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await expect(details).toHaveCount(0); // opening the menu did not open the row
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  // pay: ↓ to "ชำระเงิน" + Enter opens the settle dialog
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'ชำระเงิน / ประกบใบลดหนี้' })).toBeFocused();
  await page.keyboard.press('Enter');
  const settle = page.getByRole('dialog');
  await expect(settle).toBeVisible();
  await expect(settle).not.toContainText('รายละเอียดบิลเจ้าหนี้');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // rollback keeps its confirmation (cancel = nothing happens)
  await more.click();
  await page.getByRole('menuitem', { name: 'ย้อนสถานะการชำระเงิน...' }).click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'ย้อนสถานะ' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: /ยกเลิก|ไม่/ }).first().click();
  await expect(partial.getByTestId('bill-progress')).toHaveAttribute('data-state', 'partial');

  // the unpaid bill offers pay + cancel bill, the paid one neither
  await table.locator('tbody tr', { hasText: made.bills[0].poNumber }).getByTestId('bill-actions').click();
  await expect(page.getByRole('menuitem', { name: 'ยกเลิกบิล...' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'ย้อนสถานะการชำระเงิน...' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await table.locator('tbody tr', { hasText: made.bills[2].poNumber }).getByTestId('bill-actions').click();
  await expect(page.getByRole('menuitem', { name: 'ชำระเงิน / ประกบใบลดหนี้' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'ยกเลิกบิล...' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // a click on the row opens the details (with what left the table)
  await partial.getByText(made.sup!.name).click();
  await expect(details).toBeVisible();
  await expect(details.getByTestId('bill-facts')).toContainText(made.bills[1].poNumber);
  await expect(details).toContainText('จ่ายเงินแล้ว');
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  // Enter on the focused row (row-nav) opens them too
  await partial.focus();
  await page.keyboard.press('Enter');
  await expect(details).toBeVisible();
  await page.keyboard.press('Escape');

  // the vouchers tab: ⋯ menu too, row click opens the voucher
  await page.getByRole('tab', { name: /ประวัติการจ่ายเงิน/ }).click();
  const vRow = page.locator('tbody tr', { hasText: made.sup!.name }).first();
  await expect(vRow.getByTestId('voucher-actions')).toBeVisible();
  expect((await vRow.innerText()).trim()).toMatch(/PV\d{4}-\d{4}/);
});

test('dates: debts and PO lists without time, orders list with time; bills numbered IN<YYMM>-<NNNN>', async ({ page }) => {
  const cust = await api<{ id: string }>('POST', '/customers', token, { name: `ลูกค้า ${TAG}`, phone: `08${String(Date.now()).slice(-8)}` });
  const prod = await api<{ id: string }>('POST', '/products', token, { name: `ปูน ${TAG}`, basePrice: 100, priceLevel1: 100, unit: 'ถุง' });
  await api('POST', '/inventory/adjust', token, { productId: prod.id, type: 'SET', amount: 50, reason: 'ตั้งต้น' });
  const cur = await api<{ id?: string; shift?: { id: string } } | null>('GET', '/shifts/current', token).catch(() => null);
  const shiftId = cur?.id || cur?.shift?.id || (await api<{ shift: { id: string } }>('POST', '/shifts/open', token, { startingCash: 0, terminalId: `e2e-${TAG}` })).shift.id;
  const order = await api<{ orderNumber: string }>('POST', '/orders/checkout', token, {
    clientOrderId: randomUUID(), shiftId, customerId: cust.id, items: [{ productId: prod.id, quantity: 2, unitPrice: 100 }],
    payments: [{ method: 'CREDIT_DEBT', amount: 200 }],
  });
  expect(order.orderNumber).toMatch(NEW_NUMBER('IN'));
  const today = listDate(new Date());

  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);

  // orders (ประวัติบิล): date + time kept
  await page.goto('/orders');
  const oRow = page.locator('tr', { hasText: order.orderNumber }).first();
  await expect(oRow).toBeVisible();
  expect(await oRow.innerText()).toMatch(new RegExp(`${today.replace(/\./g, '\\.')} \\d{2}:\\d{2}`));

  // debts: short date, no time
  await page.goto('/debts');
  const dRow = page.locator('tr', { hasText: order.orderNumber }).first();
  await expect(dRow).toBeVisible();
  const dText = await dRow.innerText();
  expect(dText).toContain(today);
  expect(dText).not.toMatch(NO_TIME);

  // purchase orders: short date, no time
  await page.goto('/purchase-orders');
  const pRow = page.locator('tr', { hasText: made.bills[0].poNumber }).first();
  await expect(pRow).toBeVisible();
  const pText = await pRow.innerText();
  expect(pText).toContain(today);
  expect(pText).not.toMatch(NO_TIME);
});
