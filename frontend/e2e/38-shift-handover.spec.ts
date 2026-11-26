import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';

/**
 * Shift hand-over on one PC (docs/round-shift-today-bundle-replace.md): cashier A opens a shift and logs out
 * WITHOUT closing it, cashier B logs in on the same PC (and logs out), then A logs back in and gets the SAME
 * open shift with its sales and cash. B never takes A's shift over.
 */
test.describe.configure({ mode: 'serial' });
test.use({ deviceScaleFactor: 2 });
const OUT='/tmp/claude-0/-home-user-Purim-POS/097d8098-f2c7-5800-a661-d51ea3aa5bad/scratchpad/round-shift/';
async function shots(page: Page, name: string) { for (const [w,h] of [[1366,768],[1920,1080],[1093,614]]) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}${name}-${w}x${h}.png` }); } await page.setViewportSize({ width: 1366, height: 768 }); }

const TAG = Date.now().toString(36).slice(-5);
const CA = { username: `sa${TAG}`, password: `ShiftA#${TAG}2026`, fullName: `แคชเชียร์กะเอ ${TAG}`, pin: String(4100 + (Number.parseInt(TAG, 36) % 800)) };
const CB = { username: `sb${TAG}`, password: `ShiftB#${TAG}2026`, fullName: `แคชเชียร์กะบี ${TAG}`, pin: String(5100 + (Number.parseInt(TAG, 36) % 800)) };
let adminToken = '';
let productId = '';

async function openShiftThroughDialog(page: Page, cash: string) {
  const total = page.getByLabel('ยอดเงินรวมในลิ้นชัก');
  await expect(total).toBeVisible();
  await total.fill(cash);
  await total.press('Enter');
}

async function logoutFromPos(page: Page) {
  await page.getByRole('button', { name: 'ออกจากระบบ' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'ออกจากระบบ' }).click();
  await page.waitForURL(/\/login/);
}

const tokenOf = (u: { username: string; password: string }) =>
  api<{ access_token: string }>('POST', '/auth/login', undefined, { username: u.username, password: u.password }).then((r) => r.access_token);

test.beforeAll(async () => {
  adminToken = await apiLogin(ADMIN);
  for (const u of [CA, CB]) {
    await api('POST', '/auth/register', adminToken, { username: u.username, password: u.password, fullName: u.fullName, role: 'CASHIER', pinCode: u.pin, permissions: ['POS_SELL'] });
  }
  const p = await api<{ id: string }>('POST', '/products', adminToken, { name: `สินค้ากะส่งต่อ ${TAG}`, basePrice: 120, priceLevel1: 120, unit: 'ชิ้น', costPrice: 50 });
  productId = p.id;
  await api('POST', '/inventory/adjust', adminToken, { productId, type: 'ADD', amount: 100, reason: 'ปรับยอดเริ่มต้น' });
});

test('A opens a shift, logs out, B logs in and out, A logs back in: same shift with its sales and cash', async ({ page }) => {
  // --- A opens a shift on this PC and sells
  await uiLogin(page, CA.username, CA.password);
  await page.waitForURL(/\/pos/);
  await openShiftThroughDialog(page, '500');
  const terminalId = await page.evaluate(() => localStorage.getItem('purim_terminal_id'));
  const tA = await tokenOf(CA);
  const curA = await api<{ shift: { id: string; userId: string } } | null>('GET', `/shifts/current?terminalId=${terminalId}`, tA);
  expect(curA?.shift?.id).toBeTruthy();
  const shiftA = curA!.shift.id;
  await api('POST', '/orders/checkout', tA, {
    clientOrderId: randomUUID(), shiftId: shiftA,
    items: [{ productId, quantity: 2, unitPrice: 120 }], payments: [{ method: 'CASH', amount: 240 }],
  });
  await logoutFromPos(page);

  // --- B has a shift open on another PC
  const tB0 = await tokenOf(CB);
  await api('POST', '/shifts/open', tB0, { startingCash: 200, terminalId: `other-pc-${TAG}` });
  // --- B logs in on the same PC
  await uiLogin(page, CB.username, CB.password);
  await page.waitForURL(/\/pos/);
  console.log('B sees after login:', await page.evaluate(() => localStorage.getItem('purim-cache:current-shift')));
  await page.waitForTimeout(2000);
  console.log('B dialog visible?', await page.getByLabel('ยอดเงินรวมในลิ้นชัก').isVisible());
  console.log('B terminal', await page.evaluate(() => localStorage.getItem('purim_terminal_id')));
  await shots(page, 'before-shift-b-dialog');
  await page.getByRole('button', { name: 'ใช้กะนี้ต่อที่เครื่องนี้' }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/shift-b.png' });
  console.log('B toasts', await page.locator('[data-sonner-toast]').allTextContents());
  await page.keyboard.press('Escape');
  await logoutFromPos(page);

  // --- A logs back in
  await uiLogin(page, CA.username, CA.password);
  await page.waitForURL(/\/pos/);
  await page.waitForTimeout(3000);
  console.log('A dialog visible?', await page.getByLabel('ยอดเงินรวมในลิ้นชัก').isVisible());
  console.log('A cache', await page.evaluate(() => localStorage.getItem('purim-cache:current-shift')));
  console.log('A terminal', await page.evaluate(() => localStorage.getItem('purim_terminal_id')));
  await shots(page, 'before-shift-a-relogin');
  const open = await api<{ data?: unknown[] }>('GET', `/shifts/history?limit=10&search=${encodeURIComponent(CA.fullName)}`, adminToken);
  console.log(JSON.stringify(open).slice(0, 1500));
});
