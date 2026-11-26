import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * Shift hand-over on one PC (owner bug 2026-11-26, docs/round-shift-today-bundle-replace.md): cashier A opens a shift
 * and logs out WITHOUT closing it, cashier B logs in on the same PC and logs out, then A logs back in and gets the SAME
 * open shift with its sales and cash. B is told whose shift holds this PC and cannot open one, nor take A's shift
 * (also not through "ใช้กะนี้ต่อที่เครื่องนี้" for B's own shift left on another PC, which used to re-key the PC).
 * A sale A left in the offline outbox is not sent by B and reaches A's shift once A is back.
 * Once A closes the shift, B opens their own shift on this PC.
 */
test.describe.configure({ mode: 'serial' });
test.use({ deviceScaleFactor: 2 });

const OUT = process.env.E2E_SCREENSHOT_DIR || '';
async function shots(page: Page, name: string) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    expect(await horizontalOverflow(page)).toEqual([]);
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: `${OUT}/${name}-${size.width}x${size.height}.png` });
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
}

const TAG = Date.now().toString(36).slice(-5);
const CA = { username: `sa${TAG}`, password: `ShiftA#${TAG}2026`, fullName: `แคชเชียร์กะเช้า สมศรี ใจดีมากที่สุด ${TAG}`, pin: String(4100 + (Number.parseInt(TAG, 36) % 800)) };
const CB = { username: `sb${TAG}`, password: `ShiftB#${TAG}2026`, fullName: `แคชเชียร์กะบ่าย สมชาย ขยันขันแข็ง ${TAG}`, pin: String(5100 + (Number.parseInt(TAG, 36) % 800)) };
let adminToken = '';
let productId = '';

const tokenOf = (u: { username: string; password: string }) =>
  api<{ access_token: string }>('POST', '/auth/login', undefined, { username: u.username, password: u.password }).then((r) => r.access_token);

type Current = { shift: { id: string; userId: string; terminalId: string }; startingCash: number; totalSales: number; orderCount: number; expectedCash: number } | null;

async function logoutFromPos(page: Page) {
  await page.getByRole('button', { name: 'ออกจากระบบ' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'ออกจากระบบ' }).click();
  await page.waitForURL(/\/login/);
}

/** Put a sale straight into this device's offline outbox (as if the network had been down when it was made). */
async function queueOfflineSale(page: Page, order: Record<string, unknown>) {
  await page.evaluate(
    (o) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('purim_pos_offline_db');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction('offline_orders', 'readwrite');
          tx.objectStore('offline_orders').put(o);
          tx.oncomplete = () => { req.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }),
    order,
  );
}

const inOutbox = (page: Page, id: string) =>
  page.evaluate(
    (key) =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open('purim_pos_offline_db');
        req.onsuccess = () => {
          const g = req.result.transaction('offline_orders').objectStore('offline_orders').get(key);
          g.onsuccess = () => { resolve(!!g.result); req.result.close(); };
        };
      }),
    id,
  );

test.beforeAll(async () => {
  adminToken = await apiLogin(ADMIN);
  for (const u of [CA, CB]) {
    await api('POST', '/auth/register', adminToken, { username: u.username, password: u.password, fullName: u.fullName, role: 'CASHIER', pinCode: u.pin, permissions: ['POS_SELL'] });
  }
  const p = await api<{ id: string }>('POST', '/products', adminToken, { name: `สินค้ากะส่งต่อ ${TAG}`, basePrice: 120, priceLevel1: 120, unit: 'ชิ้น', costPrice: 50 });
  productId = p.id;
  await api('POST', '/inventory/adjust', adminToken, { productId, type: 'ADD', amount: 100, reason: 'ปรับยอดเริ่มต้น' });
});

test('A -> logout -> B -> logout -> A: A gets the same shift (sales + cash); B cannot open or take it; outbox goes to A', async ({ page }) => {
  // --- A opens a shift on this PC (keyboard: type the total, Enter) and sells
  await uiLogin(page, CA.username, CA.password);
  await page.waitForURL(/\/pos/);
  const total = page.getByLabel('ยอดเงินรวมในลิ้นชัก');
  await total.fill('500');
  await total.press('Enter');
  await expect(total).toBeHidden();
  const terminalId = await page.evaluate(() => localStorage.getItem('purim_terminal_id'));
  const tA = await tokenOf(CA);
  const before = await api<Current>('GET', `/shifts/current?terminalId=${terminalId}`, tA);
  const shiftA = before!.shift.id;
  await api('POST', '/orders/checkout', tA, {
    clientOrderId: randomUUID(), shiftId: shiftA,
    items: [{ productId, quantity: 2, unitPrice: 120 }], payments: [{ method: 'CASH', amount: 240 }],
  });
  await api('POST', `/shifts/${shiftA}/cash-movements`, tA, { type: 'in', amount: 100, reason: 'เพิ่มเงินทอน', clientMovementId: randomUUID(), purpose: 'OTHER' });
  await logoutFromPos(page);
  // a sale A made while the network was down, still in this PC's outbox
  const offlineId = randomUUID();
  await queueOfflineSale(page, {
    clientOrderId: offlineId, shiftId: shiftA, ownerId: before!.shift.userId, payloadVersion: 2, orderNumber: 'OFFLINE-X',
    createdAt: new Date().toISOString(), syncStatus: 'pending', retryCount: 0,
    items: [{ productId, quantity: 1, unitPrice: 120 }], payments: [{ method: 'CASH', amount: 120 }],
  });

  // --- B has a shift left open under another terminal id (another PC)
  const tB = await tokenOf(CB);
  const bOther = (await api<{ shift: { id: string } }>('POST', '/shifts/open', tB, { startingCash: 200, terminalId: `other-pc-${TAG}` })).shift.id;

  // --- B logs in on the same PC: told whose shift holds it, cannot open, cannot re-key the PC
  await uiLogin(page, CB.username, CB.password);
  await page.waitForURL(/\/pos/);
  const busy = page.getByTestId('shift-terminal-busy');
  await expect(busy).toContainText(CA.fullName);
  await expect(busy).toContainText('ปิดกะ');
  await expect(page.getByRole('button', { name: 'ตกลง' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /ข้ามการเปิดกะ/ })).toBeDisabled();
  const elsewhere = page.getByTestId('shift-elsewhere');
  await expect(elsewhere).toContainText('เครื่องนี้มีกะของ');
  await expect(elsewhere.getByRole('button', { name: 'ใช้กะนี้ต่อที่เครื่องนี้' })).toBeDisabled();
  await shots(page, 'after-shift-b-busy');
  expect(await page.evaluate(() => localStorage.getItem('purim_terminal_id'))).toBe(terminalId);
  // the server refuses B too (opening here, selling into A's shift)
  await expect(api('POST', '/shifts/open', tB, { startingCash: 300, terminalId })).rejects.toThrow(/400/);
  await expect(api('POST', '/orders/checkout', tB, {
    clientOrderId: randomUUID(), shiftId: shiftA, items: [{ productId, quantity: 1, unitPrice: 120 }], payments: [{ method: 'CASH', amount: 120 }],
  })).rejects.toThrow(/400/);
  // A's outbox sale is not sent with B's login
  await page.waitForTimeout(1500);
  expect(await inOutbox(page, offlineId)).toBe(true);
  // B leaves with the button in the notice
  await busy.getByRole('button', { name: /ออกจากระบบ/ }).click();
  await page.waitForURL(/\/login/);

  // --- A logs back in: no "count the drawer" dialog, the same shift, its sales and cash
  await uiLogin(page, CA.username, CA.password);
  await page.waitForURL(/\/pos/);
  await expect.poll(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('purim-cache:current-shift') || 'null')))?.id).toBe(shiftA);
  await expect(page.getByLabel('ยอดเงินรวมในลิ้นชัก')).toBeHidden();
  await shots(page, 'after-shift-a-back');
  // the outbox sale went into A's shift once A was back
  await expect.poll(async () => (await api<Current>('GET', `/shifts/current?terminalId=${terminalId}`, tA))!.orderCount, { timeout: 40_000 }).toBe(2);
  const after = await api<Current>('GET', `/shifts/current?terminalId=${terminalId}`, tA);
  expect(after!.shift.id).toBe(shiftA);
  expect(after!.startingCash).toBe(500);
  expect(after!.totalSales).toBe(360);
  expect(after!.expectedCash).toBe(960);
  // exactly one open shift for A; B's other shift untouched
  const hist = await api<{ data: { id: string; status: string }[] }>('GET', `/shifts/history?limit=50&search=${encodeURIComponent(TAG)}`, adminToken);
  expect(hist.data.filter((s) => s.status === 'OPEN').map((s) => s.id).sort()).toEqual([shiftA, bOther].sort());

  // --- A closes; now B opens their own shift on this PC
  await api('POST', `/shifts/${shiftA}/close`, tA, { actualCash: 960 });
  await api('POST', `/shifts/${bOther}/close`, tB, { actualCash: 200 });
  await logoutFromPos(page);
  await uiLogin(page, CB.username, CB.password);
  await page.waitForURL(/\/pos/);
  const totalB = page.getByLabel('ยอดเงินรวมในลิ้นชัก');
  await expect(totalB).toBeVisible();
  await expect(page.getByTestId('shift-terminal-busy')).toHaveCount(0);
  await totalB.fill('300');
  await totalB.press('Enter');
  await expect(totalB).toBeHidden();
  const curB = await api<Current>('GET', `/shifts/current?terminalId=${terminalId}`, tB);
  expect(curB!.shift.id).not.toBe(shiftA);
  expect(curB!.startingCash).toBe(300);
  await api('POST', `/shifts/${curB!.shift.id}/close`, tB, { actualCash: 300 });
});
