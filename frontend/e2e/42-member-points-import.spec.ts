import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * Member points + member import (docs/round-shift-today-bundle-replace.md section 5):
 * - ตั้งค่าสะสมแต้ม = the shop-wide rate (with a minimum per use); the member form says "เว้นว่าง = ใช้เรทกลางของร้าน"
 *   and shows the rate that applies;
 * - นำเข้าสมาชิก Excel: template download, preview with new / update counts and the rows to fix (nothing saved while
 *   any row is wrong), then the import; imported points are set through the "นำเข้าคะแนน" history.
 */
test.describe.configure({ mode: 'serial' });
test.use({ deviceScaleFactor: 2 });

const OUT = process.env.E2E_SCREENSHOT_DIR || '';
const TAG = String(Date.now()).slice(-5);
const PHONE_OLD = `086${TAG}11`;
const PHONE_NEW = `086${TAG}22`;
let token = '';
let oldId = '';
let savedConfig: unknown = null;

async function shots(page: Page, name: string) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    expect(await horizontalOverflow(page), `${name} ${size.width}x${size.height}`).toEqual([]);
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: `${OUT}/after-${name}-${size.width}x${size.height}.png` });
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
}

function xlsxFile(rows: (string | number)[][], name: string) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'สมาชิก');
  const file = test.info().outputPath(name);
  XLSX.writeFile(wb, file);
  return file;
}

test.beforeAll(async () => {
  token = await apiLogin(ADMIN);
  savedConfig = (await api<{ loyaltyConfig: unknown }>('GET', '/settings', token)).loyaltyConfig;
  oldId = (await api<{ id: string }>('POST', '/customers', token, { name: `ร้านวัสดุก่อสร้างสมชาย เจริญทรัพย์ ${TAG}`, phone: PHONE_OLD })).id;
});

test.afterAll(async () => {
  await api('PATCH', '/settings', token, { loyaltyConfig: savedConfig || { isLoyaltyEnabled: true } }).catch(() => undefined);
});

test('shop-wide point rate in ตั้งค่าสะสมแต้ม; the member form uses it when its own fields are empty', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await page.goto('/customers');
  await page.getByRole('button', { name: 'ตั้งค่าสะสมแต้ม' }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: 'ตั้งค่าระบบคะแนนสะสม' });
  await expect(dlg).toContainText('เรทกลางของร้าน');
  const inputs = dlg.locator('input[type=number]');
  await inputs.nth(0).fill('100');
  await inputs.nth(1).fill('5');
  await inputs.nth(2).fill('50');
  await inputs.nth(3).fill('2');
  await dlg.getByLabel(/ใช้แต้มขั้นต่ำต่อครั้ง/).fill('100');
  await shots(page, 'points-settings');
  await dlg.getByRole('button', { name: /บันทึกการตั้งค่า/ }).click();
  await expect(dlg).toBeHidden();
  const cfg = (await api<{ loyaltyConfig: Record<string, number> }>('GET', '/settings', token)).loyaltyConfig;
  expect(cfg).toMatchObject({ defaultPointEarnRateBaht: 100, defaultPointEarnUnits: 5, defaultPointRedeemRatePoints: 50, defaultPointRedeemDiscountBaht: 2, minRedeemPoints: 100 });
  await expect(page.getByText('เรทกลางของร้าน: ซื้อ 100฿ = 5 แต้ม · ใช้ 50 แต้ม = ลด 2฿ · ใช้ขั้นต่ำ 100 แต้ม')).toBeVisible();

  // member form: empty fields, hint + the rate that applies; a member's own value changes it
  await page.getByRole('button', { name: 'เพิ่มสมาชิกใหม่' }).click();
  const form = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: /คะแนนสะสม/ }) });
  await form.getByRole('button', { name: /คะแนนสะสม/ }).click();
  await expect(form.getByTestId('member-rate-hint')).toContainText('เว้นว่าง = ใช้เรทกลางของร้าน');
  await expect(form.locator('#member-pointEarnRateBaht')).toHaveValue('');
  await expect(form.locator('#member-pointEarnRateBaht')).toHaveAttribute('placeholder', 'เรทกลาง 100');
  await expect(form.getByTestId('member-effective-rate')).toContainText('ซื้อ 100฿ = 5 แต้ม');
  await expect(form.getByTestId('member-effective-rate')).toContainText('ใช้เรทกลางของร้านทั้งหมด');
  await form.locator('#member-pointEarnRateBaht').fill('200');
  await expect(form.getByTestId('member-effective-rate')).toContainText('ซื้อ 200฿ = 5 แต้ม');
  await shots(page, 'member-form-points');
  await page.keyboard.press('Escape');
});

test('member import: template, preview with errors (nothing saved), fixed file imported; points via history', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await page.goto('/customers');

  // template download: Thai headers, text phone column
  const dl = page.waitForEvent('download');
  await page.getByTestId('member-template').click();
  const tpl = await dl;
  const tplBook = XLSX.read(fs.readFileSync(await tpl.path()), { type: 'buffer' });
  const header = XLSX.utils.sheet_to_json<string[]>(tplBook.Sheets[tplBook.SheetNames[0]], { header: 1 })[0];
  expect(header.slice(0, 5)).toEqual(['รหัสสมาชิก', 'ชื่อ', 'เบอร์โทร', 'ระดับราคา', 'คะแนนสะสม']);
  expect(tplBook.SheetNames).toContain('วิธีกรอก');

  const head = ['รหัสสมาชิก', 'ชื่อ', 'เบอร์โทร', 'ระดับราคา', 'คะแนนสะสม', 'ที่อยู่', 'หมายเหตุ'];
  // a file with a duplicate phone and a bad level: preview shows them, import is disabled
  const bad = xlsxFile([
    head,
    ['', `ลูกค้าใหม่ จากไฟล์นำเข้า ร้านช่างไม้ ${TAG}`, Number(PHONE_NEW), 2, 120, '12/3 ถ.สุขุมวิท', 'นำเข้า'],
    ['', `สมาชิกเดิม อัปเดตแต้ม ${TAG}`, PHONE_OLD, 1, 75, '', ''],
    ['', 'ซ้ำเบอร์', PHONE_NEW, 1, 0, '', ''],
    ['', 'ระดับผิด', `087${TAG}99`, 9, 0, '', ''],
  ], 'members-bad.xlsx');
  await page.getByTestId('member-import-file').setInputFiles(bad);
  const dlg = page.getByTestId('member-import-dialog');
  await expect(dlg).toBeVisible();
  const counts = dlg.getByTestId('member-import-counts');
  await expect(counts).toContainText('ต้องแก้ 2');
  await expect(counts).toContainText('เพิ่มใหม่ 1');
  await expect(counts).toContainText('แก้ไข 1');
  await expect(dlg.getByRole('alert')).toContainText('แถวที่ต้องแก้');
  await expect(dlg.getByTestId('member-import-row').filter({ hasText: 'ซ้ำเบอร์' })).toContainText('ซ้ำกับแถว 2');
  await expect(dlg.getByTestId('member-import-confirm')).toBeDisabled();
  await shots(page, 'member-import-errors');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();

  // fixed file: phone typed as a number (Excel dropped the 0) is kept as text 0...
  const good = xlsxFile([head, ...[
    ['', `ลูกค้าใหม่ จากไฟล์นำเข้า ร้านช่างไม้ ${TAG}`, Number(PHONE_NEW), 2, 120, '12/3 ถ.สุขุมวิท', 'นำเข้า'],
    ['', `สมาชิกเดิม อัปเดตแต้ม ${TAG}`, PHONE_OLD, 1, 75, '', ''],
  ]], 'members-good.xlsx');
  await page.getByTestId('member-import-file').setInputFiles(good);
  await expect(counts).toContainText('เพิ่มใหม่ 1');
  await expect(counts).toContainText('แก้ไข 1');
  await expect(dlg.getByTestId('member-import-row').filter({ hasText: PHONE_OLD })).toContainText('0 → 75');
  await shots(page, 'member-import-preview');
  await expect(dlg.getByTestId('member-import-confirm')).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'นำเข้าสมาชิกแล้ว' })).toBeVisible();

  const created = (await api<{ phone: string; points: number; priceLevel: number; code: string }[]>('GET', `/customers?search=${PHONE_NEW}`, token))[0];
  expect(created).toMatchObject({ phone: PHONE_NEW, points: 120, priceLevel: 2 });
  expect(created.code).toMatch(/^CUST-\d{4}$/);
  expect((await api<{ points: number; name: string }>('GET', `/customers/${oldId}`, token))).toMatchObject({ points: 75, name: `สมาชิกเดิม อัปเดตแต้ม ${TAG}` });
  fs.rmSync(path.dirname(bad), { recursive: true, force: true });
});
