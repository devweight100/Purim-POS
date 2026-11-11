import { expect, test } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';

/** Products page: download the import template, upload it unchanged, confirm, products exist with pack units. */
test('product import of the downloaded template', async ({ page }) => {
  const token = await apiLogin(ADMIN);
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/products');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'โหลด Template' }).click();
  const download = await downloadPromise;
  const file = test.info().outputPath('template.xlsx');
  await download.saveAs(file);

  await page.locator('input[type=file][accept*=".xlsx"]').first().setInputFiles(file);
  const preview = page.getByRole('dialog').filter({ hasText: 'ตรวจสอบข้อมูลก่อนนำเข้า' });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('DRK-001');
  await expect(preview).toContainText('NDL-001');
  await expect(preview).toContainText('CEM-050');
  await preview.getByRole('button', { name: /ยืนยันอัพเดตเฉพาะรายการที่เปลี่ยน \(3 รายการ\)/ }).click();
  await expect(page.getByText(/นำเข้าสำเร็จ/).first()).toBeVisible();
  await expect(preview).toBeHidden();

  const all = await api('GET', '/products?limit=500', token);
  const list: any[] = Array.isArray(all) ? all : all.data;
  const water = list.find((p) => p.sku === 'DRK-001');
  expect(water).toBeTruthy();
  const full = await api('GET', `/products/${water.id}`, token);
  expect(full.name).toBe('น้ำดื่มตราช้าง 600 มล.');
  expect(full.unit).toBe('ขวด');
  expect(full.packagingUnits.map((u: any) => [u.name, u.qtyPerPrev, u.barcode, Number(u.priceLevel1)])).toEqual([
    ['แพ็ค', 6, '8850001111128', 39],
    ['ลัง', 2, '8850001111135', 75],
  ]);
  // 5 ลัง x 12 + 3 แพ็ค x 6 + 10 ขวด
  const stock = await api('GET', `/products/${water.id}/stock`, token);
  expect(JSON.stringify(stock)).toMatch(/88/);

  // base barcodes, including the extra one of the noodles, find their product
  expect((await api('GET', '/products/barcode/8850001111111', token)).id).toBe(water.id);
  expect((await api('GET', '/products/barcode/8850002222239', token)).sku).toBe('NDL-001');
});
