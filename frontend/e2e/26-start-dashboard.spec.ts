import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Round "start screen" (docs/round-start-dashboard.md):
 * - start screen หน้าขาย (POS) / หลังบ้าน after logging in, by keyboard; POS-only cashier straight to the POS;
 *   offline selling device straight to the POS;
 * - store monitor "กลับ" -> back office;
 * - dashboard credit-customer card -> list -> the customer's debts;
 * - back-office debt payment into a chosen open shift / no shift / a shift closed meanwhile.
 */
test.describe.configure({ mode: 'serial' });

const TAG = Date.now().toString(36).slice(-5);
const CUSTOMER = { name: `ลูกค้าเงินเชื่อหน้าแรก ${TAG}`, phone: `08${String(Date.now()).slice(-8)}` };
let A = '';
let C = '';
const s: Record<string, { id: string; shiftNumber?: string }> = {};

test.beforeAll(async () => {
  A = await apiLogin(ADMIN);
  C = await apiLogin(CASHIER);
  const product = await api<{ id: string }>('POST', '/products', A, { name: `สินค้าเงินเชื่อ ${TAG}`, basePrice: 450, priceLevel1: 450, unit: 'ชิ้น' });
  const customer = await api<{ id: string }>('POST', '/customers', A, CUSTOMER);
  s.customer = customer;
  s.cashierShift = (await api<{ shift: { id: string; shiftNumber: string } }>('POST', '/shifts/open', C, { startingCash: 300, terminalId: `pw-rs-c-${TAG}` })).shift;
  const adminShift = (await api<{ shift: { id: string } }>('POST', '/shifts/open', A, { startingCash: 0, terminalId: `pw-rs-a-${TAG}` })).shift;
  const order = await api<{ id: string }>('POST', '/orders/checkout', A, {
    clientOrderId: randomUUID(), shiftId: adminShift.id, customerId: customer.id,
    items: [{ productId: product.id, quantity: 2, unitPrice: 450 }], payments: [{ method: 'CREDIT_DEBT', amount: 900 }],
  });
  s.order = order;
  await api('POST', `/shifts/${adminShift.id}/close`, A, { actualCash: 0 });
});

async function expectLayoutOk(page: Page, label: string) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    expect(await horizontalOverflow(page), `${label} ${size.width}x${size.height}`).toEqual([]);
  }
  await page.setViewportSize(SIZES[0]);
}

test('login -> start screen -> back office / POS by keyboard; shop, user, version, logout', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await expect(page).toHaveURL(/\/start$/);
  const pos = page.getByTestId('start-pos');
  const back = page.getByTestId('start-backoffice');
  await expect(pos).toBeFocused();
  await expect(page.getByTestId('start-user-name')).not.toBeEmpty();
  await expect(page.getByText(/^เวอร์ชัน /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'ออกจากระบบ' })).toBeVisible();
  // big touch targets, 8 px apart, no sideways scroll
  const [a, b] = [await pos.boundingBox(), await back.boundingBox()];
  expect(a!.height).toBeGreaterThanOrEqual(190);
  expect(b!.x - (a!.x + a!.width)).toBeGreaterThanOrEqual(8);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    expect(await horizontalOverflow(page), `start ${size.width}x${size.height}`).toEqual([]);
    expect(await spacingIssues(page), `start ${size.width}x${size.height}`).toEqual([]);
  }
  await page.setViewportSize(SIZES[0]);

  await page.keyboard.press('ArrowRight');
  await expect(back).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(pos).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard$/);

  // opening the program again with the session: the start screen; "1" = POS
  await page.goto('/');
  await expect(page).toHaveURL(/\/start$/);
  await expect(pos).toBeFocused();
  await page.keyboard.press('1');
  await expect(page).toHaveURL(/\/pos$/);

  await page.goto('/start');
  await expect(pos).toBeFocused();
  await page.keyboard.press('2');
  await expect(page).toHaveURL(/\/dashboard$/);

  // desktop F2 goes through /start?go=backoffice
  await page.goto('/start?go=backoffice');
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/start');
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('a POS-only cashier goes straight to the POS; a device set to "ไม่ใช้ขาย" pre-selects หลังบ้าน', async ({ browser, page }) => {
  const password = `Pos#Only${TAG}`;
  await api('POST', '/auth/register', A, {
    username: `posonly${TAG}`, password, fullName: `แคชเชียร์ขายอย่างเดียว ${TAG}`, role: 'CASHIER',
    pinCode: String(6001 + Math.floor(Math.random() * 3000)), permissions: ['POS_SELL', 'POS_DISCOUNT'],
  });
  const ctx = await browser.newContext({ locale: 'th-TH', viewport: { width: 1366, height: 768 } });
  const cp = await ctx.newPage();
  await uiLogin(cp, `posonly${TAG}`, password, { start: 'stay' });
  await expect(cp).toHaveURL(/\/pos$/);
  await expect(cp.getByTestId('start-backoffice')).toHaveCount(0);
  await ctx.close();

  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await expect(page).toHaveURL(/\/start$/);
  await page.evaluate(() => localStorage.setItem('purim_selling_device', '0'));
  await page.reload();
  await expect(page.getByTestId('start-backoffice')).toBeFocused();
  await expect(page.getByText('เครื่องนี้ตั้งค่าไม่ใช้ขาย')).toBeVisible();
  await expect(page).toHaveURL(/\/start$/); // never skipped by the setting
  await page.evaluate(() => localStorage.removeItem('purim_selling_device'));
});

test('a selling device that cannot reach the server opens the POS straight away', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await expect(page).toHaveURL(/\/start$/);
  await page.evaluate(() => localStorage.setItem('purim_selling_device', '1'));
  await page.route('**/api/version', (r) => r.abort());
  await page.goto('/start');
  await expect(page).toHaveURL(/\/pos$/, { timeout: 10_000 });
  await page.unroute('**/api/version');
  await page.evaluate(() => localStorage.removeItem('purim_selling_device'));
});

test('store monitor "กลับหลังบ้าน" returns to the back office, not the POS', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await expect(page).toHaveURL(/\/start$/);
  await page.goto('/monitor');
  await page.getByTestId('monitor-back').click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('dashboard credit-customer card -> list (keyboard) -> the customer debts', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await page.goto('/dashboard');
  const card = page.getByTestId('credit-card');
  const summary = await api<{ customerCount: number; totalOutstanding: number }>('GET', '/debts/credit-summary', A);
  await expect(card.getByTestId('credit-customers')).toContainText(`${summary.customerCount.toLocaleString()} ราย`);
  // the duplicated bottom shortcut row is gone
  await expect(page.getByText('ไปที่หน้าขาย POS')).toHaveCount(0);
  await expectLayoutOk(page, 'dashboard');
  await card.focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('ค้นหาลูกค้าเงินเชื่อ').fill(CUSTOMER.phone);
  const row = dlg.getByTestId('credit-row').filter({ hasText: CUSTOMER.name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(CUSTOMER.phone);
  await expect(row).toContainText('900');
  await expect(dlg.getByTestId('credit-row')).toHaveCount(1);
  await expectLayoutOk(page, 'credit list');
  await dlg.getByLabel('ค้นหาลูกค้าเงินเชื่อ').press('ArrowDown');
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/debts\\?customerId=${s.customer.id}`));
  await expect(page.getByRole('cell', { name: CUSTOMER.name }).first()).toBeVisible();
});

test('back-office debt payment: into a chosen open shift, into no shift, and a shift closed meanwhile', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await page.goto(`/debts?customerId=${s.customer.id}&customerName=${encodeURIComponent(CUSTOMER.name)}`);
  const openPay = async () => {
    await page.getByRole('button', { name: 'รับชำระ' }).first().click();
    const dlg = page.getByRole('dialog').filter({ has: page.getByTestId('pay-debt-shift') });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('pay-debt-shift').locator('option', { hasText: s.cashierShift.shiftNumber! })).toHaveCount(1);
    return dlg;
  };
  const payPart = async (dlg: ReturnType<Page['getByRole']>, amount: string) => {
    await dlg.getByRole('button', { name: /แบ่งชำระ/ }).click();
    await dlg.locator('input[type=number]').fill(amount);
    await dlg.getByRole('button', { name: /ยืนยันรับชำระ/ }).click();
  };
  /** after saving, the receipt opens (it names the shift, if any); close it */
  const closeReceipt = async (shiftNumber: string | null) => {
    const receipt = page.getByRole('dialog').filter({ hasText: 'ใบเสร็จรับเงินชำระหนี้' });
    await expect(receipt).toBeVisible();
    if (shiftNumber) await expect(receipt).toContainText(shiftNumber);
    else await expect(receipt).not.toContainText('เข้ากะ');
    await page.keyboard.press('Escape');
    await expect(receipt).toBeHidden();
  };
  const before = await api<{ debtCollectionCash: number; expectedCash: number }>('GET', `/shifts/${s.cashierShift.id}/summary`, A);

  // 1. into the cashier's open shift (keyboard: the picker is a select)
  let dlg = await openPay();
  await dlg.getByTestId('pay-debt-shift').selectOption(s.cashierShift.id);
  await expect(dlg.getByTestId('pay-debt-shift-hint')).toContainText('ลิ้นชักของกะนี้');
  await expectLayoutOk(page, 'pay dialog');
  await payPart(dlg, '100');
  await expect(dlg).toBeHidden();
  await closeReceipt(s.cashierShift.shiftNumber!);
  const after = await api<{ debtCollectionCash: number; expectedCash: number }>('GET', `/shifts/${s.cashierShift.id}/summary`, A);
  expect(after.debtCollectionCash).toBeCloseTo(before.debtCollectionCash + 100, 2);
  expect(after.expectedCash).toBeCloseTo(before.expectedCash + 100, 2);

  // 2. not into any shift: cash goes to the safe, the shift does not change
  dlg = await openPay();
  await dlg.getByTestId('pay-debt-shift').selectOption('NONE');
  await expect(dlg.getByTestId('pay-debt-shift-hint')).toContainText('เซฟ');
  await payPart(dlg, '50');
  await expect(dlg).toBeHidden();
  await closeReceipt(null);
  const still = await api<{ expectedCash: number }>('GET', `/shifts/${s.cashierShift.id}/summary`, A);
  expect(still.expectedCash).toBeCloseTo(after.expectedCash, 2);
  const debts = await api<{ data: { payments: { amount: string; shiftId: string | null }[] }[] }>('GET', `/debts?customerId=${s.customer.id}`, A);
  const pays = debts.data[0].payments.map((p) => [Number(p.amount), p.shiftId]);
  expect(pays).toEqual(expect.arrayContaining([[100, s.cashierShift.id], [50, null]]));

  // 3. the chosen shift is closed before saving: refused, the list reloads, pick again
  dlg = await openPay();
  await dlg.getByTestId('pay-debt-shift').selectOption(s.cashierShift.id);
  await api('POST', `/shifts/${s.cashierShift.id}/close`, C, { actualCash: after.expectedCash });
  await payPart(dlg, '20');
  await expect(page.getByText(/ปิดไปแล้ว กรุณาเลือกกะที่ยังเปิดอยู่/)).toBeVisible();
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('pay-debt-shift')).toHaveValue('');
  await expect(dlg.getByTestId('pay-debt-shift').locator('option', { hasText: s.cashierShift.shiftNumber! })).toHaveCount(0);
  await dlg.getByTestId('pay-debt-shift').selectOption('NONE');
  await dlg.getByRole('button', { name: /ยืนยันรับชำระ/ }).click();
  await expect(dlg).toBeHidden();
});
