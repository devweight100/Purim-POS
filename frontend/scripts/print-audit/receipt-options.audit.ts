import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ELECTRON_STUB, capturePrint, renderA4, renderSlip } from './render';
import { ADMIN, STORE, adminToken, api } from './seed';

/**
 * Receipt options (Settings > รูปแบบใบเสร็จ) x VAT on/off: prints the same cash sale and company
 * credit sale as slip and A4 from the orders page and screenshots the settings page preview.
 * Needs the bills made by print.audit.ts (run it first on the same database).
 */
test.describe.configure({ mode: 'serial' });

const OUT = process.env.PA_OUT || path.resolve('print-audit-out');
fs.mkdirSync(OUT, { recursive: true });

const SLIP_ALL_ON = {
  showLogo: true, showBranch: true, showAddress: true, showPhone: true, showEmail: true, showTaxId: true,
  showHeaderText: true, showFooterText: true, showCashier: true, showCustomer: true, showNote: true,
  showPaymentDetails: true, showPoints: true,
};

const CASES = [
  { tag: 'vat-default', vat: true, options: null },
  { tag: 'novat-default', vat: false, options: null },
  { tag: 'vat-slip-allon', vat: true, options: { slip: SLIP_ALL_ON } },
  {
    tag: 'novat-custom',
    vat: false,
    options: {
      slip: { showAddress: true, showPhone: false, showCashier: false, showFooterText: false },
      a4: { showAddress: false, showEmail: false, showSignatures: false, showAmountInWords: false, showCustomerDetails: false },
    },
  },
] as const;

const TAX_WORDS = /ภาษี|VAT|TAX|อย่างย่อ/i;

let token = '';
let page: Page;
let cashOrder = '';
let creditOrder = '';

test.beforeAll(async ({ browser }) => {
  token = await adminToken();
  const orders = await api<{ data: { orderNumber: string; customerId?: string | null; paymentMethod?: string }[] }>('GET', '/orders?limit=50', token);
  creditOrder = orders.data.find((o) => o.customerId)?.orderNumber || '';
  cashOrder = orders.data.find((o) => !o.customerId)?.orderNumber || '';
  expect(cashOrder, 'run print.audit.ts first (needs its bills)').not.toBe('');
  expect(creditOrder, 'run print.audit.ts first (needs its bills)').not.toBe('');

  page = await browser.newPage();
  await page.addInitScript(ELECTRON_STUB);
  await page.goto('/login');
  await page.locator('#username').fill(ADMIN.username);
  await page.locator('#password').fill(ADMIN.password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/pos/, { timeout: 30_000 });
});

test.afterAll(async () => {
  // leave the shop as print.audit.ts expects it
  await api('PATCH', '/settings', token, { receiptOptions: null }).catch(() => undefined);
  await page?.close();
});

async function closeDialogs() {
  for (let i = 0; i < 4 && (await page.getByRole('dialog').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}

async function printFromOrders(browser: Browser, order: string, kind: 'slip' | 'a4', name: string) {
  await closeDialogs();
  await page.getByText(order).first().click();
  const detail = page.getByRole('dialog').last();
  await detail.getByRole('button', { name: kind === 'slip' ? /พิมพ์สลิป 80mm/ : /พิมพ์ใบเสร็จเต็มรูปแบบ \(A4\)/ }).click();
  const dlg = page.getByRole('dialog').last();
  await page.waitForTimeout(500);
  const btn = dlg.getByRole('button', { name: kind === 'slip' ? /^พิมพ์ใบเสร็จ/ : 'พิมพ์เอกสาร A4' }).last();
  const job = await capturePrint(page, () => btn.click());
  const r = kind === 'slip' ? await renderSlip(browser, job.html, OUT, name) : await renderA4(browser, job.html, OUT, name);
  await closeDialogs();
  return r.text;
}

for (const c of CASES) {
  test(`receipt options: ${c.tag}`, async ({ browser }) => {
    await api('PATCH', '/settings', token, { ...STORE, receiptHeader: 'ยินดีต้อนรับ เปิดทุกวัน 07:00-18:00', vatEnabled: c.vat, receiptOptions: c.options });

    // settings page: options card + live preview (slip, then A4); also refreshes this device's settings copy
    await page.goto('/settings');
    const card = page.getByTestId('receipt-options');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('receipt-preview-slip')).toBeVisible();
    await page.waitForTimeout(400);
    await card.screenshot({ path: path.join(OUT, `ro-${c.tag}-settings-options-slip.png`) });
    await page.getByTestId('receipt-preview-slip').screenshot({ path: path.join(OUT, `ro-${c.tag}-settings-preview-slip.png`) });
    await card.getByRole('tab', { name: 'A4' }).click();
    await expect(page.getByTestId('receipt-preview-a4')).toBeVisible();
    await page.waitForTimeout(400);
    await card.screenshot({ path: path.join(OUT, `ro-${c.tag}-settings-options-a4.png`) });
    await page.getByTestId('receipt-preview-a4').screenshot({ path: path.join(OUT, `ro-${c.tag}-settings-preview-a4.png`) });

    await page.goto('/orders');
    const slipCash = await printFromOrders(browser, cashOrder, 'slip', `ro-${c.tag}-slip-cash`);
    const slipCredit = await printFromOrders(browser, creditOrder, 'slip', `ro-${c.tag}-slip-credit`);
    const a4Credit = await printFromOrders(browser, creditOrder, 'a4', `ro-${c.tag}-a4-credit`);

    expect(slipCash).toContain(STORE.storeName);
    expect(a4Credit).toContain(STORE.storeName);
    if (!c.vat) {
      for (const t of [slipCash, slipCredit, a4Credit]) {
        expect(t).not.toMatch(TAX_WORDS);
        expect(t).not.toContain(STORE.taxId);
      }
      expect(a4Credit).not.toContain('0105559876543'); // buyer tax id
    } else {
      expect(slipCash).toContain('ใบกำกับภาษีอย่างย่อ');
      expect(slipCash).toContain(STORE.taxId);
      expect(a4Credit).toContain(STORE.taxId);
    }
    if (c.options === null) {
      expect(slipCash).not.toContain(STORE.storeAddress);
      expect(slipCash).not.toContain(STORE.storeEmail);
      expect(a4Credit).toContain(STORE.storeAddress);
    }
    if (c.tag === 'vat-slip-allon') {
      expect(slipCash).toContain(STORE.storeAddress);
      expect(slipCash).toContain(STORE.storeEmail);
    }
    if (c.tag === 'novat-custom') {
      expect(slipCash).toContain(STORE.storeAddress);
      expect(slipCash).not.toContain('พนักงาน');
      expect(a4Credit).not.toContain(STORE.storeAddress);
      expect(a4Credit).not.toContain('จำนวนเงินตัวอักษร');
      expect(a4Credit).not.toContain('ผู้มีอำนาจลงนาม');
    }
  });
}
