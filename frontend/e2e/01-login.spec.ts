import { expect, test } from '@playwright/test';
import { CASHIER } from './env';
import { uiLogin } from './helpers';

test.describe('login', () => {
  test('wrong password is rejected', async ({ page }) => {
    await uiLogin(page, CASHIER.username, 'wrong-password');
    await expect(page.getByText(/ไม่ถูกต้อง|ไม่สำเร็จ/).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('default password forces a password and PIN change before the POS opens', async ({ page }) => {
    await uiLogin(page, CASHIER.username, CASHIER.defaultPassword);
    await expect(page).toHaveURL(/\/change-password/);
    await expect(page.getByText('ตั้งรหัสผ่านใหม่')).toBeVisible();

    // other pages send the user back here
    await page.goto('/pos');
    await expect(page).toHaveURL(/\/change-password/);

    await page.getByPlaceholder('รหัสที่ใช้เข้าสู่ระบบตอนนี้').fill(CASHIER.defaultPassword);
    await page.getByPlaceholder('รหัสผ่านใหม่', { exact: true }).fill(CASHIER.password);
    await page.getByPlaceholder('พิมพ์รหัสผ่านใหม่อีกครั้ง').fill(CASHIER.password);
    await page.getByPlaceholder('PIN สำหรับเข้าระบบเร็ว').fill(CASHIER.pin);
    await page.getByRole('button', { name: 'บันทึกรหัสผ่านใหม่' }).click();
    await expect(page).toHaveURL(/\/pos/);

    // the old password no longer works, the new one does
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await uiLogin(page, CASHIER.username, CASHIER.defaultPassword);
    await expect(page).toHaveURL(/\/login/);
    await uiLogin(page, CASHIER.username, CASHIER.password);
    await expect(page).toHaveURL(/\/pos/);
  });
});
