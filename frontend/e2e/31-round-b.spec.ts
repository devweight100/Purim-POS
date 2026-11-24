import fs from 'node:fs';
import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, FRONTEND_URL, LINE_MOCK_PORT } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Round B (docs/round-b.md):
 * - 6: product export = filter dialog -> manager PIN (keyboard) -> file; wrong PIN / cancel = no file;
 * - 8: dashboard panels ลูกหนี้เกินกำหนด / เจ้าหนี้ / ค่าใช้จ่ายใกล้ถึงกำหนด with links;
 * - 10: LINE staff group: signed webhook through the public path, pick the group, "ส่งข้อความทดสอบ" (mocked LINE API).
 * No sideways scroll at the owner's 3 window sizes.
 */
test.describe.configure({ mode: 'serial' });

const TAG = Date.now().toString(36).slice(-5);
const SECRET = 'fedcba9876543210fedcba9876543210';
const GROUP = 'C' + '5e'.repeat(16);
const SHOTS = process.env.E2E_SHOT_DIR || '';
let A = '';
const pushes: { to: string; text: string }[] = [];
let lineMock: http.Server;
const ids: Record<string, string> = {};

async function layoutOk(page: Page, label: string) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    expect(await horizontalOverflow(page), `${label} ${size.width}x${size.height}`).toEqual([]);
  }
  await page.setViewportSize(SIZES[0]);
}

test.beforeAll(async () => {
  A = await apiLogin(ADMIN);
  lineMock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v2/bot/message/push') {
        const b = JSON.parse(body);
        pushes.push({ to: b.to, text: b.messages?.[0]?.text || '' });
        res.end('{}');
      } else if (req.url === `/v2/bot/group/${GROUP}/summary`) {
        res.end(JSON.stringify({ groupId: GROUP, groupName: `กลุ่มพนักงานร้าน ${TAG}` }));
      } else if (req.url?.startsWith('/v2/bot/message/quota')) {
        res.end(JSON.stringify({ type: 'none', totalUsage: 0 }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise<void>((r) => lineMock.listen(LINE_MOCK_PORT, '127.0.0.1', () => r()));
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  // products for the export filter
  const cat = await api<{ id: string }>('POST', '/categories', A, { name: `ส่งออก ${TAG}` });
  ids.cat = cat.id;
  for (const [i, stock] of [[1, 20], [2, 0], [3, 3]] as const) {
    const p = await api<{ id: string }>('POST', '/products', A, { name: `สินค้าส่งออก ${TAG} ${i}`, categoryId: cat.id, basePrice: 10, priceLevel1: 10, unit: 'ชิ้น' });
    if (stock) await api('POST', '/inventory/adjust', A, { productId: p.id, type: 'ADD', amount: stock, reason: 'e2e ส่งออก' });
  }
  // creditor with an overdue bill + a recurring expense due soon
  const sup = await api<{ id: string }>('POST', '/suppliers', A, { name: `บริษัทเจ้าหนี้แดชบอร์ด ${TAG}` });
  ids.sup = sup.id;
  const prod = await api<{ id: string }>('POST', '/products', A, { name: `วัสดุซื้อเข้า ${TAG}`, basePrice: 50, priceLevel1: 50, unit: 'ชิ้น' });
  const due = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  const po = await api<{ id: string; poNumber: string; items: { id: string }[] }>('POST', '/purchase-orders', A, { supplierId: sup.id, status: 'ISSUED', dueDate: due, items: [{ productId: prod.id, quantity: 4, unitCost: 125 }] });
  await api('POST', `/purchase-orders/${po.id}/receive`, A, { clientReceiptId: randomUUID(), items: [{ purchaseOrderItemId: po.items[0].id, receivedQty: 4, unitCost: 125 }] });
  ids.po = po.poNumber;
  const cats = await api<{ id: string }[]>('GET', '/finance/expense-categories', A);
  await api('POST', '/finance/recurring', A, { name: `ค่าเช่าร้าน ${TAG}`, categoryId: cats[0].id, amount: 15000, frequency: 'MONTHLY', dayOfMonth: 1, firstDueDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) });
});

test.afterAll(async () => {
  await new Promise((r) => lineMock?.close(r));
});

test('product export: filter dialog -> PIN (wrong, cancel, right) -> Excel with the filtered rows', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await page.goto('/products');
  await page.getByRole('button', { name: /ส่งออก Excel/ }).click();
  const dlg = page.getByTestId('product-export-dialog');
  await expect(dlg).toBeVisible();
  // keyboard: the category search is focused; type and tick the category
  await expect(dlg.getByLabel('ค้นหาหมวดหมู่')).toBeFocused();
  await page.keyboard.type(`ส่งออก ${TAG}`);
  await dlg.getByTestId('export-categories').getByLabel(`ส่งออก ${TAG}`).check();
  await dlg.getByLabel('มีสต็อก').check();
  if (SHOTS) await dlg.screenshot({ path: `${SHOTS}/export-filter-dialog.png` });
  await layoutOk(page, 'export filter dialog');
  await dlg.getByRole('button', { name: 'ส่งออก Excel' }).click();

  const pin = page.getByTestId('export-pin-dialog');
  await expect(pin).toBeVisible();
  await expect(pin).toContainText(`หมวด ส่งออก ${TAG}`);
  await expect(pin.getByLabel('PIN ผู้อนุมัติ')).toBeFocused();
  // wrong PIN: error, stays open
  await page.keyboard.type('0000');
  await page.keyboard.press('Enter');
  await expect(pin.getByRole('alert')).toContainText('PIN ไม่ถูกต้อง');
  if (SHOTS) await pin.screenshot({ path: `${SHOTS}/export-pin-dialog.png` });
  // Escape = cancel, nothing downloaded
  await page.keyboard.press('Escape');
  await expect(pin).toBeHidden();
  // again with the right PIN
  await page.getByRole('button', { name: /ส่งออก Excel/ }).click();
  await expect(dlg.getByTestId('export-categories').getByLabel(`ส่งออก ${TAG}`)).toBeChecked(); // filters kept
  await dlg.getByRole('button', { name: 'ส่งออก Excel' }).click();
  const download = page.waitForEvent('download');
  await expect(pin.getByLabel('PIN ผู้อนุมัติ')).toBeFocused();
  await page.keyboard.type(ADMIN.pin);
  await page.keyboard.press('Enter');
  await download;
  await expect(page.getByText('ส่งออกข้อมูลสินค้า 2 รายการ')).toBeVisible();
  // the server refuses an export without an approval
  const r = await fetch(`${FRONTEND_URL}/api/exports/products`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${A}` }, body: '{"filters":{}}' });
  expect(r.status).toBe(403);
});

test('dashboard: overdue debtors / creditors / expenses due soon panels with links; no sideways scroll', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await page.goto('/dashboard');
  const panels = page.getByTestId('obligation-panels');
  await expect(panels).toBeVisible();
  const cred = page.getByTestId('panel-creditors');
  await expect(cred.getByTestId('creditors-summary')).toContainText('เกินกำหนด');
  const row = cred.getByTestId('creditor-row').filter({ hasText: `บริษัทเจ้าหนี้แดชบอร์ด ${TAG}` });
  await expect(row).toContainText('฿500.00');
  const up = page.getByTestId('panel-upcoming');
  // a monthly expense can fall due twice in the window (e.g. the 26th and the 1st): every occurrence is listed
  await expect(up.getByTestId('upcoming-row').filter({ hasText: `ค่าเช่าร้าน ${TAG}` }).first()).toContainText('฿15,000.00');
  await expect(up.getByTestId('upcoming-row').filter({ hasText: ids.po })).toContainText('เกินกำหนด');
  await layoutOk(page, 'dashboard');
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    expect(await spacingIssues(page, '[data-testid="obligation-panels"]'), `panels spacing ${size.width}`).toEqual([]);
  }
  await page.setViewportSize(SIZES[0]);
  if (SHOTS) await panels.screenshot({ path: `${SHOTS}/dashboard-panels.png` });
  // keyboard: focus the creditor row link and press Enter -> payables filtered by that supplier
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/payables\\?supplierId=${ids.sup}`));
  await expect(page.locator('tbody tr', { hasText: ids.po })).toBeVisible();
  // the recurring item opens the finance recurring tab
  await page.goto('/dashboard');
  await page.getByTestId('panel-upcoming').getByTestId('upcoming-row').filter({ hasText: `ค่าเช่าร้าน ${TAG}` }).first().click();
  await expect(page).toHaveURL(/\/finance\?view=recurring/);
  await expect(page.getByText(`ค่าเช่าร้าน ${TAG}`).first()).toBeVisible();
});

test('LINE staff group: signed webhook through the public path, pick the group, test message', async ({ page }) => {
  await api('PUT', '/online-shop/config', A, { messagingToken: 'e2e-token-'.padEnd(44, 'x'), channelSecret: SECRET, backOfficeUrl: 'http://192.168.1.10:3000' });
  const raw = JSON.stringify({ destination: 'Ubot', events: [{ type: 'join', timestamp: Date.now(), source: { type: 'group', groupId: GROUP } }] });
  const post = (sig: string) => fetch(`${FRONTEND_URL}/api/public/line/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': sig, 'cf-ray': '8f00-SIN' }, body: raw,
  });
  expect((await post('bad')).status).toBe(401);
  expect((await post(createHmac('sha256', SECRET).update(raw).digest('base64'))).status).toBe(200);
  // the rest stays closed to the internet
  expect((await fetch(`${FRONTEND_URL}/api/public/line/other`, { method: 'POST', headers: { 'cf-ray': 'x' } })).status).toBe(404);

  await uiLogin(page, ADMIN.username, ADMIN.password);
  await page.goto('/settings?tab=online');
  const card = page.getByTestId('line-staff-card');
  await expect(card).toBeVisible();
  const g = card.getByTestId('line-group-row').filter({ hasText: `กลุ่มพนักงานร้าน ${TAG}` });
  await expect(g).toBeVisible();
  await g.getByRole('radio').check();
  await expect(page.getByText(/สำหรับแจ้งเตือนแล้ว/).first()).toBeVisible();
  await expect(g.getByRole('radio')).toBeChecked();
  pushes.length = 0;
  await g.getByRole('button', { name: 'ส่งข้อความทดสอบ' }).click();
  await expect(page.getByText(/ส่งข้อความทดสอบไปที่กลุ่ม/).first()).toBeVisible();
  expect(pushes).toEqual([expect.objectContaining({ to: GROUP })]);
  await layoutOk(page, 'settings online');
  if (SHOTS) await card.screenshot({ path: `${SHOTS}/settings-line-staff.png` });
  // leave LINE off for the other specs
  await api('PUT', '/online-shop/config', A, { staffGroupId: '', messagingToken: '', channelSecret: '' });
});
