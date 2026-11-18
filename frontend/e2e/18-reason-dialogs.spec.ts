import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Reasons and confirmations are asked in the page, never with the browser's prompt / confirm / alert
 * (owner 2026-11-17: in the desktop app the cancel reason of an online order could not be typed. Electron throws on
 * prompt(), and after a native confirm() / alert() the window passes no keystrokes to the page until it is
 * re-focused; see docs/bugfix-reject-reason.md). Every flow here fails when a native dialog opens.
 * Keyboard only where the owner works that way: the field has the focus, Enter confirms, Escape closes only the
 * top dialog (also over another dialog opened from a row-nav list).
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
let adminToken = '';
let productId = '';
let shiftId = '';
const TERMINAL = 'e2e-reason';

async function shopSession(dev: string, name = 'ลูกค้าทดสอบ') {
  return (await api<{ token: string }>('POST', '/public/shop/session', undefined, { dev: { id: `${dev}${TAG}`, name } })).token;
}

async function placeOrder(dev: string) {
  const token = await shopSession(dev);
  const o = await api<{ id: string; orderNo: string }>('POST', '/public/shop/orders', token, {
    contactName: 'คุณมานี มีของ', contactPhone: '0812345678', fulfillment: 'PICKUP',
    items: [{ productId, quantity: 2, unitId: null }],
  });
  return { ...o, token };
}

/** fails the test on any native browser dialog */
function noNativeDialogs(page: Page) {
  const seen: string[] = [];
  page.on('dialog', (d) => {
    seen.push(`${d.type()}: ${d.message()}`);
    void d.dismiss().catch(() => undefined);
  });
  return seen;
}

async function adminPage(page: Page) {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
}

/** the reason dialog at the owner's 3 window sizes: no sideways scroll, 8 px between buttons */
async function reasonDialogLayout(page: Page) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await spacingIssues(page, '[data-testid="reason-dialog"]')).toEqual([]);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
}

test.beforeAll(async () => {
  adminToken = await apiLogin(ADMIN);
  const r = await api<{ id: string }>('POST', '/products', adminToken, { name: `ปูนเหตุผล ${TAG}`, unit: 'ถุง', basePrice: 100, priceLevel1: 100, costPrice: 1 });
  productId = r.id;
  await api('POST', '/inventory/adjust', adminToken, { productId, type: 'ADD', amount: 100, reason: 'ปรับยอดเริ่มต้น' });
  await api('PUT', '/online-shop/config', adminToken, { enabled: true });
  let shift = (await api<{ shift?: { id: string } } | null>('GET', `/shifts/current?terminalId=${TERMINAL}`, adminToken))?.shift;
  if (!shift) shift = (await api<{ shift: { id: string } }>('POST', '/shifts/open', adminToken, { startingCash: 0, terminalId: TERMINAL })).shift;
  shiftId = shift.id;
});

test('online order: cancel with a typed reason (keyboard only, unclaimed), the customer sees the reason', async ({ page }) => {
  const native = noNativeDialogs(page);
  const o = await placeOrder('rej1');
  await adminPage(page);
  await page.goto('/online-orders');
  await page.getByTestId('online-order-row').filter({ hasText: o.orderNo }).click();
  const detail = page.getByTestId('online-order-detail');
  await expect(detail.getByTestId('claim-bar')).toContainText('ยังไม่มีใครรับจัด');
  // keyboard: focus the button, Enter opens the dialog with the focus in the field
  await detail.getByRole('button', { name: 'ยกเลิกออเดอร์' }).focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByTestId('reason-dialog');
  await expect(dlg).toBeVisible();
  const field = dlg.locator('#reject-reason');
  await expect(field).toBeFocused();
  const confirm = dlg.getByRole('button', { name: 'ยืนยันยกเลิก' });
  await expect(confirm).toBeDisabled();
  await page.keyboard.press('Enter'); // blank: nothing happens
  await expect(dlg).toBeVisible();
  await reasonDialogLayout(page);
  await page.keyboard.type('สินค้าหมด ขออภัยครับ', { delay: 10 });
  await expect(field).toHaveValue('สินค้าหมด ขออภัยครับ');
  await expect(confirm).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  await expect(detail).toContainText('เหตุผลที่ยกเลิก: สินค้าหมด ขออภัยครับ');
  const back = await api<{ status: string; rejectReason: string }>('GET', `/online-shop/orders/${o.id}`, adminToken);
  expect(back).toMatchObject({ status: 'CANCELLED', rejectReason: 'สินค้าหมด ขออภัยครับ' });
  // the customer's own order page (API of /shop/orders/:id)
  const mine = await api<{ status: string; rejectReason: string }>('GET', `/public/shop/orders/${o.id}`, o.token);
  expect(mine).toMatchObject({ status: 'CANCELLED', rejectReason: 'สินค้าหมด ขออภัยครับ' });
  expect(native).toEqual([]);
});

test('online order claimed by me: after an in-page confirm (was native) the reason can still be typed; Escape keeps the order', async ({ page }) => {
  const native = noNativeDialogs(page);
  const o = await placeOrder('rej2');
  await api('POST', `/online-shop/orders/${o.id}/accept`, adminToken, { items: [{ productId, unitId: null, quantity: 2, unitPrice: 100 }], customerId: null, usePriceLevel: false });
  await adminPage(page);
  await page.goto(`/online-orders?id=${o.id}`);
  const detail = page.getByTestId('online-order-detail');
  // accepting claimed it for admin
  await expect(page.getByTestId('claim-bar')).toContainText('คุณกำลังจัด');

  // "เสร็จ" on an unpaid order used to ask with window.confirm (in the desktop app the keyboard was dead after it)
  await detail.getByRole('button', { name: 'เสร็จแล้ว', exact: true }).click();
  const ask = page.getByTestId('confirm-dialog');
  await expect(ask).toContainText('ยังไม่ได้รับเงินในหน้าขาย');
  await expect(ask.getByRole('button', { name: 'ปิดออเดอร์' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(ask).toBeHidden();

  await detail.getByRole('button', { name: 'ยกเลิกออเดอร์' }).click();
  const dlg = page.getByTestId('reason-dialog');
  await expect(dlg.locator('#reject-reason')).toBeFocused();
  await page.keyboard.type('ลูกค้าขอยกเลิก');
  // Escape closes the dialog only; nothing sent; opening again starts with an empty field
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(detail).toBeVisible();
  expect((await api<{ status: string }>('GET', `/online-shop/orders/${o.id}`, adminToken)).status).toBe('ACCEPTED');
  await detail.getByRole('button', { name: 'ยกเลิกออเดอร์' }).click();
  await expect(dlg.locator('#reject-reason')).toBeFocused();
  await expect(dlg.locator('#reject-reason')).toHaveValue('');
  await page.keyboard.type('ลูกค้าขอยกเลิก โทรแจ้งแล้ว');
  await dlg.getByRole('button', { name: 'ยืนยันยกเลิก' }).click();
  await expect(detail).toContainText('เหตุผลที่ยกเลิก: ลูกค้าขอยกเลิก โทรแจ้งแล้ว');
  expect(await api<{ status: string; rejectReason: string }>('GET', `/online-shop/orders/${o.id}`, adminToken)).toMatchObject({ status: 'CANCELLED', rejectReason: 'ลูกค้าขอยกเลิก โทรแจ้งแล้ว' });
  expect(native).toEqual([]);
});

test('LINE link request: "ไม่อนุมัติ" asks for the note in the page (default text, editable)', async ({ page }) => {
  const native = noNativeDialogs(page);
  const name = `ลูกค้าผูก ${TAG}`;
  const token = await shopSession('link', name);
  await api('POST', '/public/shop/link', token, { phone: `09${TAG}1234`.slice(0, 10) });
  await adminPage(page);
  await page.goto('/online-orders?tab=links');
  const req = page.getByTestId('link-request').filter({ hasText: name });
  await req.getByRole('button', { name: 'ไม่อนุมัติ' }).click();
  const dlg = page.getByTestId('reason-dialog');
  const field = dlg.locator('#link-reject-note');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('ตรวจสอบเบอร์ไม่ได้ กรุณาติดต่อร้าน');
  await reasonDialogLayout(page);
  // default text is selected: typing replaces it
  await page.keyboard.type('เบอร์ไม่ตรงกับสมาชิก กรุณาโทรหาร้าน');
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  await expect(req).toHaveCount(0);
  const rejected = await api<{ displayName: string; status: string; note: string }[] | { data: { displayName: string; note: string }[] }>('GET', '/online-shop/link-requests?status=REJECTED', adminToken);
  const list = Array.isArray(rejected) ? rejected : rejected.data;
  expect(list.find((r) => r.displayName === name)?.note).toBe('เบอร์ไม่ตรงกับสมาชิก กรุณาโทรหาร้าน');
  expect(native).toEqual([]);
});

test('finance: cancel an expense with a typed reason', async ({ page }) => {
  const native = noNativeDialogs(page);
  const accounts = await api<{ id: string; type: string; balance: number }[]>('GET', '/finance/accounts', adminToken);
  const safe = accounts.find((a) => a.type === 'CASH_SAFE')!;
  // earlier specs may leave the safe below zero: put in enough for the expense
  await api('POST', '/finance/owner', adminToken, { kind: 'CAPITAL', accountId: safe.id, amount: Math.ceil(Math.max(0, -safe.balance)) + 1000, clientId: randomUUID() });
  const cats = await api<{ id: string }[]>('GET', '/finance/expense-categories', adminToken);
  const desc = `ค่าน้ำแข็ง ${TAG}`;
  const exp = await api<{ id: string }>('POST', '/finance/expenses', adminToken, { categoryId: cats[0].id, accountId: safe.id, amount: 45, description: desc, clientId: randomUUID() });
  await adminPage(page);
  await page.goto('/finance');
  await page.getByRole('button', { name: 'ค่าใช้จ่าย', exact: true }).click();
  await page.locator('tr').filter({ hasText: desc }).getByRole('button', { name: 'ยกเลิก' }).click();
  const dlg = page.getByTestId('reason-dialog');
  await expect(dlg.locator('#expense-cancel-reason')).toBeFocused();
  await expect(dlg.getByRole('button', { name: 'ยืนยันยกเลิกค่าใช้จ่าย' })).toBeDisabled();
  await reasonDialogLayout(page);
  await page.keyboard.type('บันทึกซ้ำ');
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  await expect.poll(async () => (await api<{ status: string; cancelReason: string }>('GET', `/finance/expenses/${exp.id}`, adminToken)).cancelReason).toBe('บันทึกซ้ำ');
  expect(native).toEqual([]);
});

test('debts (row-nav list): reason dialog over the payment history dialog takes typed text; Escape closes only the top one', async ({ page }) => {
  const native = noNativeDialogs(page);
  const cust = await api<{ id: string }>('POST', '/customers', adminToken, { name: `ลูกหนี้เหตุผล ${TAG}`, phone: `07${TAG}0000`.slice(0, 10) });
  const order = await api<{ id: string; orderNumber: string }>('POST', '/orders/checkout', adminToken, {
    clientOrderId: randomUUID(), shiftId, terminalId: TERMINAL, customerId: cust.id,
    items: [{ productId, quantity: 3, unitPrice: 100 }],
    payments: [{ method: 'CREDIT_DEBT', amount: 300 }],
  });
  const debts = await api<{ data: { id: string; orderNumber?: string; order?: { orderNumber: string } }[] }>('GET', `/debts?search=${order.orderNumber}`, adminToken);
  const debt = debts.data[0];
  await api('POST', `/debts/${debt.id}/pay`, adminToken, { amount: 100, paymentMethod: 'CASH', clientPaymentId: randomUUID(), shiftId });

  await adminPage(page);
  await page.goto('/debts');
  await page.getByPlaceholder('ค้นหาตามเลขที่บิล, ชื่อลูกค้า, บริษัท, เบอร์โทร, เลขผู้เสียภาษี...').fill(order.orderNumber);
  const row = page.locator('tr[data-row-nav]').filter({ hasText: order.orderNumber });
  await row.focus();
  await page.keyboard.press('Enter'); // row-nav opens the history dialog
  const history = page.getByRole('dialog').filter({ hasText: order.orderNumber }).first();
  await expect(history).toBeVisible();
  await history.getByRole('button', { name: 'ยกเลิก', exact: true }).first().click();
  const dlg = page.getByTestId('reason-dialog');
  const field = dlg.locator('#debt-payment-cancel-reason');
  await expect(field).toBeFocused();
  await page.keyboard.type('ab');
  // Escape: only the reason dialog closes, the history stays open
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(history).toBeVisible();
  await history.getByRole('button', { name: 'ยกเลิก', exact: true }).first().click();
  await expect(field).toBeFocused();
  await reasonDialogLayout(page);
  await page.keyboard.type('รับเงินผิดบิล');
  await expect(field).toHaveValue('รับเงินผิดบิล');
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  await expect.poll(async () => {
    const d = await api<{ payments: { cancelReason: string | null }[] }>('GET', `/debts/${debt.id}`, adminToken);
    return d.payments.map((p) => p.cancelReason);
  }).toContain('รับเงินผิดบิล');
  expect(native).toEqual([]);
});
