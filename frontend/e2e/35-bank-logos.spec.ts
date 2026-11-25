import { expect, test, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, cartItems, scan, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * Owner 2026-11-25 (docs/product-form-bank-logos.md part 4): receiving bank accounts get a bank (built-in badge:
 * the bank's colour + abbreviation) or the owner's own logo (PNG / JPEG / WebP, never SVG). At a transfer / QR
 * payment the cashier picks the account that received the money (one account = preselected; several = an explicit
 * choice by number keys / arrows + Enter); the account is recorded on the payment and shown in the bill detail.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-6);
const PRODUCT = { name: `กระเบื้องปูพื้น 60x60 ซม. ลายหินอ่อน เกรด A-${TAG}`, barcode: `8856${TAG}21`, price: 435 };
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
let admin = '';
type Bank = { id: string; bankName: string; accountNumber: string; bankCode: string | null; logoUrl: string | null };
const banks = () => api<Bank[]>('GET', '/bank-accounts', admin);
let scbId = '';

test.beforeAll(async () => {
  admin = await apiLogin(ADMIN);
  await apiLogin(CASHIER);
  const scb = await api<Bank>('POST', '/bank-accounts', admin, { bankName: 'ธนาคารไทยพาณิชย์ (SCB)', bankCode: 'SCB', accountName: `ร้านปุริมวัสดุ สาขาตลาดไท ${TAG}`, accountNumber: `402-${TAG.slice(0, 1)}-${TAG.slice(1)}-1` });
  scbId = scb.id;
  await api('POST', '/bank-accounts', admin, { bankName: 'ธนาคารกรุงเทพ (BBL)', bankCode: 'BBL', accountName: `นายปุริม ใจดี ${TAG}`, accountNumber: `155-${TAG.slice(0, 1)}-${TAG.slice(1)}-2` });
  const p = await api<{ id: string }>('POST', '/products', admin, { name: PRODUCT.name, barcodes: [PRODUCT.barcode], unit: 'แผ่น', basePrice: PRODUCT.price, priceLevel1: PRODUCT.price, stockQuantity: 200 });
  expect(p.id).toBeTruthy();
});

test('settings: every account shows its bank badge; bank field + own logo (PNG ok, SVG refused)', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await page.goto('/accounts');
  const cards = page.locator('div.rounded-2xl', { has: page.getByRole('button', { name: /แก้ไขบัญชี/ }) });
  await expect(page.locator('[data-bank="SCB"]').first()).toBeVisible();
  await expect(page.locator('[data-bank="BBL"]').first()).toBeVisible();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    expect(await horizontalOverflow(page), `${size.width}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  expect(await cards.count()).toBeGreaterThanOrEqual(2);

  const bbl = (await banks()).find((b) => b.bankCode === 'BBL' && b.accountNumber.includes(TAG.slice(1)))!;
  await page.getByRole('button', { name: `แก้ไขบัญชี ${bbl.bankName}` }).last().click();
  const dlg = page.getByRole('dialog').filter({ hasText: 'แก้ไขบัญชีการเงิน' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('account-bank')).toHaveValue('BBL');
  // the bank list (owner's banks + PromptPay + other)
  const options = await dlg.getByTestId('account-bank').locator('option').allInnerTexts();
  expect(options.join('|')).toMatch(/กสิกรไทย.*ไทยพาณิชย์.*กรุงไทย.*กรุงเทพ.*กรุงศรี.*ttb.*ออมสิน.*ธ\.ก\.ส\..*ธอส\..*UOB.*CIMB.*KKP.*LH Bank.*TISCO.*ICBC.*พร้อมเพย์.*อื่น/);
  await dlg.getByTestId('account-bank').selectOption('GSB');
  await expect(dlg.locator('[data-bank="GSB"]')).toBeVisible();
  // SVG: refused before anything is sent
  await dlg.getByTestId('account-logo-file').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>') });
  await expect(page.getByText('ไม่รับไฟล์ SVG').first()).toBeVisible();
  await expect(dlg.getByTestId('bank-logo-image')).toHaveCount(0);
  // PNG: redrawn to 128 px, shown instead of the badge
  await dlg.getByTestId('account-logo-file').setInputFiles({ name: 'my-logo.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1PX, 'base64') });
  await expect(dlg.getByTestId('bank-logo-image')).toBeVisible();
  await dlg.getByTestId('account-save').click();
  await expect(dlg).toBeHidden();
  const saved = (await banks()).find((b) => b.id === bbl.id)!;
  expect(saved.bankCode).toBe('GSB');
  expect(saved.bankName).toContain('ออมสิน');
  expect(saved.logoUrl).toMatch(/^data:image\/png;base64,/);
  await expect(page.getByTestId('bank-logo-image').first()).toBeVisible();
});

async function posWithItem(page: Page) {
  await uiLogin(page, CASHIER.username, CASHIER.password);
  const open = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  const closeBtn = page.getByRole('button', { name: 'ปิดกะ', exact: true });
  await open.or(closeBtn).first().waitFor();
  if (await open.isVisible()) {
    const cont = open.getByRole('button', { name: 'ใช้กะนี้ต่อที่เครื่องนี้' }).first();
    if (await cont.isVisible()) await cont.click();
    else {
      await open.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true }).fill('500');
      await open.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true }).press('Enter');
    }
  }
  await expect(closeBtn).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('purim-pos-cart'));
  await page.reload();
  await page.waitForTimeout(1500);
  await scan(page, PRODUCT.barcode);
  await expect.poll(async () => (await cartItems(page)).length).toBe(1);
}

test('POS transfer: several accounts = explicit choice by number keys / arrows + Enter; recorded and shown on the bill', async ({ page, browser }) => {
  const list = await banks();
  expect(list.length).toBeGreaterThan(1);
  const scbIdx = list.findIndex((b) => b.id === scbId);
  await posWithItem(page);
  await page.keyboard.press('F12');
  const qrCard = page.getByRole('button', { name: /QR PromptPay \/ โอนเงิน/ });
  await qrCard.focus();
  await page.keyboard.press('Enter');
  const choice = page.getByTestId('pay-bank-choice');
  await expect(choice).toBeVisible();
  await expect(choice.getByRole('radio')).toHaveCount(list.length);
  await expect(choice.locator('[aria-checked="true"]')).toHaveCount(0); // nothing preselected
  await expect(choice.getByRole('radio').first()).toBeFocused();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    expect(await horizontalOverflow(page), `${size.width}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  // confirming without a choice is refused
  await page.getByRole('button', { name: /ลูกค้าชำระเงินเรียบร้อยแล้ว/ }).click();
  await expect(page.getByText(/เลือกบัญชีที่รับเงินโอนก่อน/).first()).toBeVisible();
  await expect(page.getByRole('dialog').filter({ hasText: 'ชำระเงินสำเร็จ!' })).toHaveCount(0);
  // number key = that account; arrows move; Enter confirms
  await choice.getByRole('radio').first().focus();
  if (scbIdx < 9) await page.keyboard.press(`Digit${scbIdx + 1}`);
  else {
    // (a reused test database with many accounts) 1, then arrows to it
    await page.keyboard.press('Digit1');
    for (let i = 0; i < scbIdx; i++) await page.keyboard.press('ArrowDown');
  }
  await expect(choice.getByRole('radio').nth(scbIdx)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('pay-bank-selected')).toContainText('ไทยพาณิชย์');
  await page.keyboard.press('ArrowRight');
  await expect(choice.getByRole('radio').nth((scbIdx + 1) % list.length)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(choice.getByRole('radio').nth(scbIdx)).toHaveAttribute('aria-checked', 'true');
  await expect(choice.getByRole('radio').nth(scbIdx)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').filter({ hasText: 'ชำระเงินสำเร็จ!' })).toBeVisible();

  type O = { id: string; orderNumber: string; payments?: { method: string; bankAccountId: string | null }[] };
  const res = await api<O[] | { data: O[] }>('GET', '/orders?page=1&limit=10', admin);
  const rows: O[] = Array.isArray(res) ? res : res.data;
  const mine = rows.find((o) => (o.payments || []).some((p) => p.bankAccountId === scbId));
  expect(mine, 'order paid into SCB').toBeTruthy();

  // bill detail (back office): the receiving account with its logo
  await page.keyboard.press('Enter'); // close the success screen
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const office = await ctx.newPage();
  await uiLogin(office, ADMIN.username, ADMIN.password, { start: 'stay' });
  await office.goto('/orders');
  await office.locator('tr', { hasText: mine!.orderNumber }).first().click();
  const pay = office.getByTestId('order-payment-bank');
  await expect(pay).toContainText('ไทยพาณิชย์');
  await expect(pay.locator('[data-bank="SCB"]')).toBeVisible();
  await ctx.close();
});
