import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Online orders: full-screen order window + step flow (owner 2026-11-26, docs/online-orders-flow.md).
 * Keyboard only: ↑ / ↓ + Enter in the list, inside the window the ONE next-step button has the focus so Enter does
 * the next step (รับงาน -> เริ่มจัดของ -> จัดของเสร็จ -> ออกไปส่ง -> ส่งเสร็จ), Esc returns to the list with the row
 * focused. รับเงิน is always in the same place: disabled before รับงาน, "ชำระแล้ว · บิล ..." once paid.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
const NAME = `คุณทดสอบขั้นตอน ${TAG}`;
const TERMINAL = 'e2e-flow';
let adminToken = '';
let productId = '';
const o: Record<'delivery' | 'pickup', { id: string; orderNo: string }> = {} as never;

async function placeOrder(dev: string, fulfillment: 'PICKUP' | 'DELIVERY') {
  const s = await api<{ token: string }>('POST', '/public/shop/session', undefined, { dev: { id: `${dev}${TAG}`, name: 'ลูกค้าทดสอบ' } });
  return api<{ id: string; orderNo: string }>('POST', '/public/shop/orders', s.token, {
    contactName: NAME, contactPhone: '0812345678', fulfillment,
    address: fulfillment === 'DELIVERY' ? '99 หมู่ 1 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ' : undefined,
    items: [{ productId, quantity: 3, unitId: null }],
  });
}

/** pays the order through the POS checkout (the same request the POS sends) */
async function pay(id: string) {
  let shift = (await api<{ shift?: { id: string } } | null>('GET', `/shifts/current?terminalId=${TERMINAL}`, adminToken))?.shift;
  if (!shift) shift = (await api<{ shift: { id: string } }>('POST', '/shifts/open', adminToken, { startingCash: 0, terminalId: TERMINAL })).shift;
  const pos = await api<{ lines: { productId: string; quantity: number; unitPrice: number; unitId: string | null; unitName: string; factor: number }[] }>('POST', `/online-shop/orders/${id}/pos`, adminToken, { terminalId: TERMINAL });
  const total = pos.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  await api('POST', '/orders/checkout', adminToken, {
    clientOrderId: randomUUID(), shiftId: shift.id, onlineOrderId: id,
    items: pos.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, unitId: l.unitId, unitName: l.unitName, conversionFactor: l.factor })),
    payments: [{ method: 'CASH', amount: total }],
  });
}

const currentStep = (page: Page) => page.getByTestId('order-steps').locator('[aria-current="step"]');

async function layoutOk(page: Page) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await spacingIssues(page, '[data-testid="online-order-detail"]')).toEqual([]);
    // the window covers the whole screen; only the item list / side panel scroll inside it
    const box = await page.locator('[data-slot="dialog-content"]').boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, width: size.width, height: size.height });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
}

test.beforeAll(async () => {
  adminToken = await apiLogin(ADMIN);
  const r = await api<{ id: string }>('POST', '/products', adminToken, { name: `ปูนขั้นตอน ${TAG}`, unit: 'ถุง', basePrice: 120, priceLevel1: 120, costPrice: 1 });
  productId = r.id;
  await api('POST', '/inventory/adjust', adminToken, { productId, type: 'ADD', amount: 100, reason: 'ปรับยอดเริ่มต้น' });
  await api('PUT', '/online-shop/config', adminToken, { enabled: true });
  o.pickup = await placeOrder('flowp', 'PICKUP');
  o.delivery = await placeOrder('flowd', 'DELIVERY');
});

test('list: next step per row; ↑/↓ + Enter opens a full-screen window; Enter walks the steps; Esc back to the list', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/online-orders');
  await page.getByLabel('ค้นหาออเดอร์').fill(NAME);
  const rows = page.getByTestId('online-order-row');
  await expect(rows).toHaveCount(2);
  for (const r of await rows.all()) await expect(r.getByTestId('row-next-step')).toHaveText('→ รอรับงาน');

  // keyboard: ↑ / ↓ move between rows, Enter opens
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(rows.first()).toBeFocused();
  const target = page.locator(`[data-testid="online-order-row"][data-id="${o.delivery.id}"]`);
  if (!(await target.evaluate((el) => el === document.activeElement))) await page.keyboard.press('ArrowDown');
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');

  const detail = page.getByTestId('online-order-detail');
  await expect(detail).toContainText(o.delivery.orderNo);
  await expect(detail).toContainText('ให้ร้านไปส่ง');
  await expect(detail).toContainText(NAME);
  // NEW: steps (delivery has กำลังส่ง), what to do now, ONE next step, รับเงิน disabled with the reason
  await expect(page.getByTestId('order-steps').locator('li[data-state]')).toHaveText([/ใหม่/, /รับงาน/, /จัดของ/, /จัดเสร็จ/, /กำลังส่ง/, /เสร็จ/]);
  await expect(currentStep(page)).toContainText('ใหม่');
  await expect(page.getByTestId('step-hint')).toContainText('ตรวจรายการ ใส่ค่าส่ง แล้วกดรับงาน');
  await expect(detail.getByTestId('step-primary')).toHaveCount(1);
  await expect(detail.getByTestId('step-primary')).toHaveText(/รับงาน/);
  await expect(detail.getByTestId('step-primary')).toBeFocused();
  await expect(detail.getByRole('button', { name: 'รับเงิน', exact: true })).toBeDisabled();
  await expect(detail.getByTestId('payment-slot')).toContainText('รับงานก่อนจึงรับเงินได้');
  for (const skip of ['เริ่มจัดของ', 'จัดของเสร็จ', 'ออกไปส่ง', 'ส่งเสร็จ', 'ยกเลิกออเดอร์', 'ปล่อยงาน']) await expect(detail.getByRole('button', { name: skip })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: /พิมพ์ใบจัดของ/ })).toHaveCount(0);
  await layoutOk(page);

  // Enter without a fee: refused, the fee field gets the focus; type it, Enter = รับงาน
  await detail.getByTestId('step-primary').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('กรุณาใส่ค่าส่งก่อนรับออเดอร์')).toBeVisible();
  await expect(detail.getByLabel('ค่าส่ง')).toBeFocused();
  await page.keyboard.type('40');
  await page.keyboard.press('Enter');

  // ACCEPTED -> เริ่มจัดของ (focused), รับเงิน available, picking slip offered
  await expect(currentStep(page)).toContainText('รับงาน');
  await expect(detail.getByTestId('step-primary')).toHaveText(/เริ่มจัดของ/);
  await expect(detail.getByTestId('step-primary')).toBeFocused();
  await expect(detail.getByRole('button', { name: 'รับเงิน', exact: true })).toBeEnabled();
  await expect(detail.getByRole('button', { name: /พิมพ์ใบจัดของ/ })).toBeVisible();
  await layoutOk(page);
  await detail.getByTestId('step-primary').focus();
  await page.keyboard.press('Enter');
  // PREPARING -> จัดของเสร็จ
  await expect(currentStep(page)).toContainText('จัดของ');
  await expect(detail.getByTestId('step-primary')).toHaveText(/จัดของเสร็จ/);
  await expect(detail.getByTestId('step-primary')).toBeFocused();
  await page.keyboard.press('Enter');
  // READY (delivery) -> ออกไปส่ง; no ส่งเสร็จ yet
  await expect(currentStep(page)).toContainText('จัดเสร็จ');
  await expect(detail.getByTestId('step-primary')).toHaveText(/ออกไปส่ง/);
  await expect(detail.getByTestId('step-primary')).toBeFocused();
  await expect(detail.getByRole('button', { name: 'ส่งเสร็จ' })).toHaveCount(0);
  await layoutOk(page);

  // Esc: back to the list, the same row focused, its next step updated
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(target).toBeFocused();
  await expect(target.getByTestId('row-next-step')).toHaveText('→ รอส่ง · ยังไม่รับเงิน');

  // paid at the POS: the window shows "ชำระแล้ว · บิล ..." in the payment slot; delivery still needs its steps
  await pay(o.delivery.id);
  await page.keyboard.press('Enter');
  await expect(detail.getByTestId('payment-paid')).toContainText('ชำระแล้ว · บิล');
  await expect(detail.getByRole('button', { name: 'รับเงิน', exact: true })).toHaveCount(0);
  await expect(detail.getByTestId('step-primary')).toHaveText(/ออกไปส่ง/);
  await expect(detail.getByTestId('step-primary')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(currentStep(page)).toContainText('กำลังส่ง');
  await expect(detail.getByTestId('step-primary')).toHaveText(/ส่งเสร็จ/);
  await expect(detail.getByTestId('step-primary')).toBeFocused();
  await page.keyboard.press('Enter'); // paid: no confirmation
  await expect(detail.getByTestId('step-primary')).toHaveCount(0);
  await expect(page.getByTestId('step-hint')).toContainText('ออเดอร์นี้เสร็จแล้ว');
  expect((await api<{ status: string }>('GET', `/online-shop/orders/${o.delivery.id}`, adminToken)).status).toBe('DONE');
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
});

test('pickup ready and unpaid: the next step is รับเงิน (focused), no other step button', async ({ page }) => {
  await api('POST', `/online-shop/orders/${o.pickup.id}/accept`, adminToken, {});
  await api('POST', `/online-shop/orders/${o.pickup.id}/picked`, adminToken, {});
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/online-orders');
  await page.getByLabel('ค้นหาออเดอร์').fill(NAME);
  const row = page.locator(`[data-testid="online-order-row"][data-id="${o.pickup.id}"]`);
  await expect(row.getByTestId('row-next-step')).toHaveText('→ รอรับเงิน');
  await row.focus();
  await page.keyboard.press('Enter');
  const detail = page.getByTestId('online-order-detail');
  await expect(page.getByTestId('order-steps').locator('li[data-state]')).toHaveText([/ใหม่/, /รับงาน/, /จัดของ/, /จัดเสร็จ/, /เสร็จ/]);
  await expect(detail.getByTestId('step-primary')).toHaveCount(0);
  await expect(detail.getByTestId('step-actions')).toContainText('รับเงิน');
  await expect(detail.getByRole('button', { name: 'รับเงิน', exact: true })).toBeFocused();
  await layoutOk(page);
  // Enter = open as the POS bill (goes to the POS with the order in the cart)
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/pos/);
  await expect(page.getByTestId('pos-online-banner')).toContainText(o.pickup.orderNo);
});
