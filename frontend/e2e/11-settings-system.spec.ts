import { expect, test } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, uiLogin } from './helpers';

/**
 * Settings page in groups (owner: "the low-stock setting is in the wrong place; dangerous buttons together in one
 * place, ระบบ"): each setting in one group, the irreversible operations only under ตั้งค่า > ระบบ (danger zone, ADMIN), each
 * behind a typed confirmation word; no "install desktop app" button; nothing dangerous on the users page.
 */
test('settings groups: low-stock in สินค้าและสต็อก, cash limit in การเงิน, saved to the server', async ({ page }) => {
  const token = await apiLogin(ADMIN);
  const before = await api<{ lowStockThreshold: number; cashMovementApprovalLimit: number }>('GET', '/settings', token);
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);

  // no install-the-app button anywhere in the back office
  await page.goto('/settings');
  await expect(page.getByText('ติดตั้งโปรแกรม (Desktop App)')).toHaveCount(0);

  // ข้อมูลร้าน is the first group; the low-stock and cash-limit fields are not there
  await expect(page.getByTestId('settings-tab-store')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#low-stock-threshold')).toHaveCount(0);
  await expect(page.locator('#cash-movement-approval-limit')).toHaveCount(0);

  // สินค้าและสต็อก: low-stock threshold (exactly one field on the page)
  await page.getByTestId('settings-tab-stock').click();
  await expect(page).toHaveURL(/tab=stock/);
  await expect(page.locator('#low-stock-threshold')).toHaveCount(1);
  await expect(page.locator('#cash-movement-approval-limit')).toHaveCount(0);
  const next = before.lowStockThreshold + 2;
  await page.locator('#low-stock-threshold').fill(String(next));
  await page.getByRole('button', { name: 'บันทึกการตั้งค่า' }).click();
  await expect.poll(async () => (await api<{ lowStockThreshold: number }>('GET', '/settings', token)).lowStockThreshold).toBe(next);

  // การเงิน: cash movement approval limit
  await page.getByTestId('settings-tab-finance').click();
  await expect(page.locator('#cash-movement-approval-limit')).toHaveCount(1);
  await expect(page.locator('#low-stock-threshold')).toHaveCount(0);

  // a link opens a group directly
  await page.goto('/settings?tab=stock');
  await expect(page.locator('#low-stock-threshold')).toHaveValue(String(next));

  // put it back
  await api('PATCH', '/settings', token, { lowStockThreshold: before.lowStockThreshold });

  // the users page no longer has the clear-all-products button
  await page.goto('/users');
  await expect(page.getByRole('heading', { name: /จัดการพนักงาน/ })).toBeVisible();
  await expect(page.getByText('ล้างข้อมูลสินค้าทั้งหมด')).toHaveCount(0);
});

test('ระบบ danger zone: admin only, typed confirmation before anything is deleted', async ({ page, browser }) => {
  const token = await apiLogin(ADMIN);
  const products = (await api<{ meta: { total: number } }>('GET', '/products/page?page=1&limit=1', token)).meta.total;
  const orders = (await api<{ meta: { total: number } }>('GET', '/orders?limit=1', token)).meta.total;
  expect(products).toBeGreaterThan(0);
  const deletes: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if ((r.method() === 'DELETE' && u.pathname === '/api/products') || u.pathname === '/api/settings/reset-database') deletes.push(r.method() + ' ' + u.pathname);
  });

  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/settings');
  // nothing dangerous outside ระบบ
  await expect(page.getByTestId('danger-zone')).toHaveCount(0);
  await page.getByTestId('settings-tab-system').click();
  const zone = page.getByTestId('danger-zone');
  await expect(zone).toBeVisible();

  // delete all products: the button stays disabled until the exact word is typed; cancel deletes nothing
  await zone.getByTestId('open-clear-products').click();
  let dlg = page.getByRole('dialog').filter({ hasText: 'ยืนยันการลบสินค้าทั้งหมด' });
  const confirmProducts = dlg.getByRole('button', { name: 'ยืนยันลบสินค้าทั้งหมด' });
  await expect(confirmProducts).toBeDisabled();
  await dlg.getByTestId('clear-products-confirm-input').fill('ลบสินค้า');
  await expect(confirmProducts).toBeDisabled();
  await dlg.getByTestId('clear-products-confirm-input').fill('ลบสินค้าทั้งหมด');
  await expect(confirmProducts).toBeEnabled();
  await dlg.getByRole('button', { name: 'ยกเลิก' }).click();
  await expect(dlg).toHaveCount(0);

  // reset everything: needs RESET; cancel
  await zone.getByTestId('open-reset-database').click();
  dlg = page.getByRole('dialog').filter({ hasText: 'ยืนยันการล้างข้อมูลทั้งหมดในระบบ' });
  const confirmReset = dlg.getByRole('button', { name: 'ยืนยันล้างข้อมูลเดี๋ยวนี้' });
  await expect(confirmReset).toBeDisabled();
  await dlg.getByTestId('reset-confirm-input').fill('reset');
  await expect(confirmReset).toBeDisabled();
  await dlg.getByTestId('reset-confirm-input').fill('RESET');
  await expect(confirmReset).toBeEnabled();
  await dlg.getByRole('button', { name: 'ยกเลิก' }).click();
  await expect(dlg).toHaveCount(0);

  expect(deletes).toEqual([]);
  expect((await api<{ meta: { total: number } }>('GET', '/products/page?page=1&limit=1', token)).meta.total).toBe(products);
  expect((await api<{ meta: { total: number } }>('GET', '/orders?limit=1', token)).meta.total).toBe(orders);

  // a manager with the settings permission sees ระบบ with version + backup (owner: managers may back up),
  // but not the danger zone
  const tag = String(Date.now()).slice(-6);
  const managerPassword = `Mgr#E2e${tag}`;
  await api('POST', '/auth/register', token, {
    username: `mgr${tag}`, password: managerPassword, fullName: `ผู้จัดการ ${tag}`, role: 'MANAGER', pinCode: String(5001 + Math.floor(Math.random() * 4000)),
    permissions: ['MANAGE_SETTINGS', 'MANAGE_USERS'],
  });
  const mgr = await browser.newContext({ locale: 'th-TH', viewport: { width: 1366, height: 768 } });
  const mp = await mgr.newPage();
  await uiLogin(mp, `mgr${tag}`, managerPassword);
  // no POS: the start screen shows หน้าขาย disabled; หลังบ้าน opens their first back-office page (settings)
  await expect(mp).toHaveURL(/\/settings/);
  await mp.goto('/settings?tab=system');
  await expect(mp.getByTestId('settings-tab-stock')).toBeVisible();
  await expect(mp.getByTestId('settings-tab-system')).toHaveAttribute('aria-selected', 'true');
  await expect(mp.getByText('เวอร์ชันระบบ')).toBeVisible();
  const backupNow = mp.getByRole('button', { name: 'สำรองข้อมูลตอนนี้' });
  await expect(backupNow).toBeVisible();
  const backupDone = mp.waitForResponse((r) => r.url().endsWith('/server-control/backup') && r.request().method() === 'POST');
  await backupNow.click();
  expect((await backupDone).status()).toBe(201);
  await expect(mp.getByText(/สำรองข้อมูลสำเร็จ/)).toBeVisible();
  await expect(mp.getByRole('button', { name: 'ดาวน์โหลด' })).toHaveCount(0);
  await expect(mp.getByTestId('danger-zone')).toHaveCount(0);
  await expect(mp.getByTestId('open-clear-products')).toHaveCount(0);
  await mgr.close();

  // a cashier cannot open the settings at all (and never sees ระบบ)
  const cas = await browser.newContext({ locale: 'th-TH', viewport: { width: 1366, height: 768 } });
  const cp = await cas.newPage();
  await uiLogin(cp, CASHIER.username, CASHIER.password);
  await expect(cp).toHaveURL(/\/pos/);
  await cp.goto('/settings?tab=system');
  await expect(cp.getByText('ไม่มีสิทธิ์เข้าถึงหน้านี้')).toBeVisible();
  await expect(cp.getByTestId('danger-zone')).toHaveCount(0);
  await cas.close();
});

test('removed screens: /pos-neo opens the POS, /master-control opens the store monitor; no menu item left', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);

  // a terminal or bookmark still pointing at the old neo screen lands on the normal POS (no 404)
  await page.goto('/pos-neo');
  await expect(page).toHaveURL(/\/pos$/);
  await expect(page.getByText('Neo-Brutalist')).toHaveCount(0);
  await page.goto('/pos-neo/anything?x=1');
  await expect(page).toHaveURL(/\/pos\?x=1$/);

  // old desktop-app menu item / bookmark for แผงควบคุมเครื่องแม่ -> มอนิเตอร์ร้าน
  await page.goto('/master-control');
  await expect(page).toHaveURL(/\/monitor$/);

  // the sidebar no longer links to them; the monitor stays
  await page.goto('/settings');
  await expect(page.locator('a[href="/master-control"]')).toHaveCount(0);
  await expect(page.locator('a[href="/pos-neo"]')).toHaveCount(0);
  await expect(page.locator('a[href="/monitor"]').first()).toBeAttached();
});
