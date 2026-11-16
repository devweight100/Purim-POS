import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import jsQR from 'jsqr';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';
import { hasValidPromptPayCrc } from '../../shared/src/promptpay';

/**
 * PromptPay QR with the amount locked (docs/promptpay-qr.md): the owner sets a PromptPay ID on the default bank
 * account, the cashier sells with QR, splits a bill, and the back office takes a debt payment by QR. Each QR is
 * screenshotted and decoded with jsQR; the decoded payload must lock the amount on screen.
 * PROMPTPAY_SHOT_DIR=<dir> also saves the POS QR screen at 1366x768.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
const NAME = `ข้าวกล่องพร้อมเพย์ ${TAG}`;
const PRICE = 37.25;
const MOBILE = '0812345678';

let adminToken = '';
const state: { productId?: string; bankId?: string } = {};

/** Screenshot of the QR as drawn on screen, decoded in node with jsQR. */
async function decodeQr(page: Page, qr: Locator): Promise<string | null> {
  const png = await qr.locator('svg').screenshot();
  const { w, h, data } = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, data: Array.from(ctx.getImageData(0, 0, c.width, c.height).data) };
  }, png.toString('base64'));
  return jsQR(Uint8ClampedArray.from(data), w, h)?.data ?? null;
}

/** The QR on screen locks `amount`: payload (data attribute) = decoded image, valid CRC, tag 54 = amount. */
async function expectQrAmount(page: Page, qr: Locator, amount: string) {
  await expect(qr).toHaveAttribute('data-amount', amount);
  const payload = (await qr.getAttribute('data-payload'))!;
  expect(payload.startsWith('000201010212')).toBe(true);
  expect(payload).toContain(`0016A000000677010111011300668123456785303764`);
  expect(payload).toContain(`54${String(amount.length).padStart(2, '0')}${amount}5802TH6304`);
  expect(hasValidPromptPayCrc(payload)).toBe(true);
  expect(await decodeQr(page, qr)).toBe(payload);
}

const tile = (page: Page) => page.getByTestId('pos-product-card').filter({ hasText: NAME }).first();

async function openShiftIfAsked(page: Page) {
  const dlg = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  await dlg.or(page.getByRole('button', { name: 'ปิดกะ', exact: true })).first().waitFor();
  if (await dlg.isVisible()) {
    await dlg.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true }).fill('500');
    await dlg.getByRole('button', { name: 'ตกลง' }).click();
    await expect(dlg).toBeHidden();
  }
}

async function cashierPage(browser: Browser, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  await uiLogin(page, CASHIER.username, CASHIER.password);
  await expect(page).toHaveURL(/\/pos/);
  await openShiftIfAsked(page);
  await page.getByPlaceholder(/ค้นหาชื่อสินค้า, หมวดหมู่, SKU/).fill(NAME);
  await expect(tile(page)).toBeVisible();
  return { ctx, page };
}

async function noLayoutProblems(page: Page, within: string) {
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(await spacingIssues(page, within)).toEqual([]);
}

test.beforeAll(async () => {
  await apiLogin(CASHIER);
  adminToken = await apiLogin(ADMIN);
  const p = await api<{ id: string }>('POST', '/products', adminToken, { name: NAME, sku: `PP-${TAG}`, basePrice: PRICE, priceLevel1: PRICE, unit: 'กล่อง' });
  state.productId = p.id;
  await api('POST', '/inventory/adjust', adminToken, { productId: p.id, type: 'ADD', amount: 20, reason: 'ปรับยอดเริ่มต้น' });
});

test('owner sets a PromptPay ID on the default account: 13-digit checksum checked, live ฿1.00 preview scans', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  const banks = await api<{ id: string; bankName: string; isDefault: boolean }[]>('GET', '/bank-accounts', adminToken);
  const bank = banks.find((b) => b.isDefault) ?? banks[0];
  state.bankId = bank.id;
  await page.goto('/accounts');
  await page.getByRole('button', { name: `แก้ไขบัญชี ${bank.bankName}` }).first().click();
  const form = page.getByRole('dialog').filter({ hasText: 'แก้ไขบัญชีการเงิน' });
  await expect(form).toBeVisible();

  // keyboard: the type select and the ID field are reachable with Tab
  await form.getByLabel('พร้อมเพย์สำหรับสร้าง QR ล็อกยอด (ไม่บังคับ)').focus();
  await form.getByTestId('promptpay-type').selectOption('NATIONAL_ID');
  await page.keyboard.press('Tab');
  await expect(form.getByTestId('promptpay-id')).toBeFocused();
  await page.keyboard.type('1234567890122'); // wrong check digit
  await expect(form.getByRole('alert')).toContainText('หลักตรวจสอบ');
  await expect(form.getByTestId('promptpay-qr')).toHaveCount(0);
  await form.getByTestId('account-save').click();
  await expect(form).toBeVisible(); // not saved

  await form.getByTestId('promptpay-type').selectOption('MOBILE');
  await form.getByTestId('promptpay-id').fill('081-234-5678');
  await expect(form.getByRole('alert')).toHaveCount(0);
  const preview = form.getByTestId('promptpay-qr');
  await expectQrAmount(page, preview, '1.00');
  await expect(preview).toContainText('081-xxx-5678');

  for (const size of SIZES) {
    await page.setViewportSize(size);
    await noLayoutProblems(page, '[role="dialog"]');
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await form.getByTestId('account-save').click();
  await expect(form).toBeHidden();
  const saved = (await api<{ id: string; promptpayType: string; promptpayId: string }[]>('GET', '/bank-accounts', adminToken)).find((b) => b.id === bank.id);
  expect(saved).toMatchObject({ promptpayType: 'MOBILE', promptpayId: MOBILE });
  await expect(page.getByTestId('account-promptpay').first()).toBeVisible();
});

test('cashier sells with QR: the QR locks the bill total, follows the numpad amount; payment still confirmed by hand', async ({ browser }) => {
  const { ctx, page } = await cashierPage(browser, { width: 1366, height: 768 });
  try {
    await tile(page).click();
    await tile(page).click();
    await page.getByRole('button', { name: 'ชำระเงิน' }).first().click();
    const pay = page.getByRole('dialog').filter({ hasText: 'เลือกช่องทางการชำระเงิน' });
    await pay.getByRole('button', { name: /QR PromptPay \/ โอนเงิน/ }).click();
    const dlg = page.getByRole('dialog').filter({ hasText: 'รับชำระผ่าน QR PromptPay' });
    const qr = dlg.getByTestId('promptpay-qr');
    await expectQrAmount(page, qr, '74.50');
    await expect(qr).toContainText('฿74.50');
    await expect(qr).toContainText('081-xxx-5678');
    const box = (await qr.locator('svg').boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(240); // big enough to scan across the counter
    await noLayoutProblems(page, '[role="dialog"]');
    const dir = process.env.PROMPTPAY_SHOT_DIR;
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, 'pos-qr-1366x768.png') });
    }
    for (const size of SIZES) {
      await page.setViewportSize(size);
      expect(await horizontalOverflow(page)).toEqual([]);
    }
    await page.setViewportSize({ width: 1366, height: 768 });

    // the cashier changes the amount on the numpad (keyboard): the QR follows
    await dlg.getByRole('button', { name: 'กดเพื่อเปิด Numpad' }).click();
    const pad = page.getByRole('dialog').filter({ hasText: 'ระบุยอดโอนเงิน' });
    await expect(pad).toBeVisible();
    await page.keyboard.press('Delete');
    await page.keyboard.type('80');
    await page.keyboard.press('Enter');
    await expect(pad).toBeHidden();
    await expectQrAmount(page, qr, '80.00');

    // no automatic confirmation: the sale is saved only by the cashier's button (amount recorded as before)
    await dlg.getByRole('button', { name: 'ลูกค้าชำระเงินเรียบร้อยแล้ว' }).click();
    await expect(page.getByRole('dialog').filter({ hasText: 'ชำระเงินสำเร็จ!' })).toBeVisible();
    type Row = { totalAmount: string; payments: { method: string; amount: string | number }[] };
    const orders = await api<Row[] | { data?: Row[] }>('GET', `/orders?limit=5&search=${encodeURIComponent(NAME)}`, adminToken);
    const list: Row[] = Array.isArray(orders) ? orders : orders.data ?? [];
    expect(list.length).toBeGreaterThan(0);
    expect(Number(list[0].totalAmount)).toBe(74.5);
    expect(list[0].payments.map((p) => [p.method, Number(p.amount)])).toEqual([['QR_PROMPTPAY', 74.5]]);
  } finally {
    await ctx.close();
  }
});

test('split payment: the QR is for the transfer part only and follows it', async ({ browser }) => {
  const { ctx, page } = await cashierPage(browser, { width: 1366, height: 768 });
  try {
    await tile(page).click();
    await page.getByRole('button', { name: 'ชำระเงิน' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: /แบ่งชำระ \(Split\)/ }).click();
    const dlg = page.getByRole('dialog').filter({ hasText: 'รับชำระแบบแบ่งจ่าย' });
    await expect(dlg.getByTestId('promptpay-qr-empty')).toBeVisible();
    const qrInput = dlg.locator('input[type=number]').first();
    await qrInput.fill('20');
    const qr = dlg.getByTestId('promptpay-qr');
    await expectQrAmount(page, qr, '20.00');
    await qrInput.fill('12.5');
    await expectQrAmount(page, qr, '12.50');
    for (const size of SIZES) {
      await page.setViewportSize(size);
      expect(await horizontalOverflow(page)).toEqual([]);
    }
  } finally {
    await ctx.close();
  }
});

test('debt payment by QR: the QR locks the amount being paid', async ({ page }) => {
  const terminalId = 'e2e-promptpay';
  let shift = (await api<{ shift?: { id: string } } | null>('GET', `/shifts/current?terminalId=${terminalId}`, adminToken))?.shift;
  if (!shift) shift = (await api<{ shift: { id: string } }>('POST', '/shifts/open', adminToken, { startingCash: 0, terminalId })).shift;
  const cust = await api<{ id: string }>('POST', '/customers', adminToken, { name: `ลูกหนี้พร้อมเพย์ ${TAG}`, phone: `08${TAG}0000`.slice(0, 10) });
  const order = await api<{ id: string; orderNumber: string }>('POST', '/orders/checkout', adminToken, {
    clientOrderId: randomUUID(), shiftId: shift.id, customerId: cust.id,
    items: [{ productId: state.productId, quantity: 3, unitPrice: PRICE }],
    payments: [{ method: 'CREDIT_DEBT', amount: PRICE * 3 }],
  });

  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/debts');
  await page.getByPlaceholder('ค้นหาตามเลขที่บิล, ชื่อลูกค้า, บริษัท, เบอร์โทร, เลขผู้เสียภาษี...').fill(order.orderNumber);
  await page.locator('tr').filter({ hasText: order.orderNumber }).getByRole('button', { name: /รับชำระ/ }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: 'รับชำระหนี้ / ชำระบิลเงินเชื่อ' });
  await dlg.getByRole('button', { name: 'QR โอน' }).click();
  const qr = dlg.getByTestId('promptpay-qr');
  await expectQrAmount(page, qr, '111.75');
  await dlg.getByRole('button', { name: /แบ่งชำระ/ }).click();
  await dlg.locator('input[type=number]').fill('50');
  await expectQrAmount(page, qr, '50.00');
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await noLayoutProblems(page, '[role="dialog"]');
  }
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});
