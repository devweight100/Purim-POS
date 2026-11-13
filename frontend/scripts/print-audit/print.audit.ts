import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ELECTRON_STUB, capturePrint, renderA4, renderSlip, renderSlipDriverPdf, type CapturedPrint } from './render';
import { ADMIN, PRODUCTS, STORE, adminToken, api } from './seed';

/**
 * Print audit: opens every printed document from every entry point with a stubbed desktop
 * bridge, captures the HTML the desktop app would print and renders it like the printer does.
 * Output: PA_OUT (default ./print-audit-out). See playwright.config.ts in this folder.
 */
test.describe.configure({ mode: 'serial' });

const OUT = process.env.PA_OUT || path.resolve('print-audit-out');
const VAT = process.env.PA_VAT !== '0'; // PA_VAT=0 -> store without VAT
const TAG = VAT ? 'vat' : 'novat';
fs.mkdirSync(OUT, { recursive: true });

let token = '';
let page: Page;
const ids: Record<string, string> = {};
const results: Record<string, unknown> = {};

const name = (n: string) => `${TAG}-${n}`;

async function slip(browser: Browser, job: CapturedPrint, n: string) {
  expect(job.format).toBe('80mm');
  const r = await renderSlip(browser, job.html, OUT, name(n));
  await renderSlipDriverPdf(browser, job.html, OUT, name(n));
  results[n] = { cssHeight: r.cssHeight, scrollWidth: r.scrollWidth, text: r.text };
  expect(r.scrollWidth, `${n}: nothing may stick out past 288px`).toBeLessThanOrEqual(288);
  return r;
}

async function a4(browser: Browser, job: CapturedPrint, n: string) {
  expect(job.format).toBe('a4');
  const r = await renderA4(browser, job.html, OUT, name(n));
  results[n] = { pages: r.pages.length, text: r.text };
  return r;
}

/** Preview screenshot of the topmost dialog. */
async function preview(n: string, dialogText: string | RegExp) {
  const dlg = page.getByRole('dialog').filter({ hasText: dialogText }).last();
  await expect(dlg).toBeVisible();
  await page.waitForTimeout(300);
  await dlg.screenshot({ path: path.join(OUT, `${name(n)}-preview.png`) });
  return dlg;
}

async function closeDialogs() {
  for (let i = 0; i < 4 && (await page.getByRole('dialog').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}

/** Edit the persisted POS cart and make the open POS pick it up. */
async function editCart(edit: (state: Record<string, unknown>) => void) {
  const raw = await page.evaluate(() => localStorage.getItem('purim-pos-cart'));
  const data = JSON.parse(raw || '{"state":{},"version":1}');
  edit(data.state);
  await page.evaluate((v) => {
    localStorage.setItem('purim-pos-cart', v);
    window.dispatchEvent(new StorageEvent('storage', { key: 'purim-pos-cart' }));
  }, JSON.stringify(data));
}

async function scan(code: string) {
  const input = page.locator('input.sr-only[tabindex="-1"]');
  await input.focus();
  await page.keyboard.type(code, { delay: 5 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
}

test.beforeAll(async ({ browser }) => {
  token = await adminToken();
  await api('PATCH', '/settings', token, { ...STORE, vatEnabled: VAT, vatRate: 7, allowDecimalQty: false });

  // products (idempotent by SKU)
  const existing = await api<{ data?: { id: string; sku: string }[] } | { id: string; sku: string }[]>('GET', '/products?limit=500', token);
  const list = Array.isArray(existing) ? existing : existing.data || [];
  for (const p of PRODUCTS) {
    let found = list.find((x) => x.sku === p.sku);
    if (!found) {
      found = await api<{ id: string; sku: string }>('POST', '/products', token, {
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        basePrice: p.basePrice,
        costPrice: Math.round(p.basePrice * 0.7),
        priceLevel1: p.basePrice,
        packagingUnits: p.pack ? [{ ...p.pack, barcode: `${p.sku}-PK` }] : [],
      });
      await api('POST', '/inventory/adjust', token, { productId: found.id, type: 'ADD', amount: 500, reason: 'ตั้งต้น (print audit)' });
    }
    ids[p.sku] = found.id;
  }

  // customer with a tax id and full address (company buyer)
  const customers = await api<{ id: string; name: string }[] | { data: { id: string; name: string }[] }>('GET', '/customers', token);
  const clist = Array.isArray(customers) ? customers : customers.data;
  let company = clist.find((c) => c.name.startsWith('บริษัท ก่อสร้างไทยเจริญ'));
  if (!company) {
    company = await api<{ id: string; name: string }>('POST', '/customers', token, {
      name: 'บริษัท ก่อสร้างไทยเจริญ จำกัด',
      phone: '0891234567',
      address: '123/45 ซอยรังสิต-นครนายก 26 ตำบลประชาธิปัตย์ อำเภอธัญบุรี จังหวัดปทุมธานี 12130',
      taxId: '0105559876543',
      companyName: 'บริษัท ก่อสร้างไทยเจริญ จำกัด',
      branchName: 'สำนักงานใหญ่',
      creditLimit: 100000,
      creditTerms: 30,
    });
  }
  ids.customer = company.id;
  ids.customerName = company.name;

  page = await browser.newPage();
  await page.addInitScript(ELECTRON_STUB);
  await page.goto('/login');
  await page.locator('#username').fill(ADMIN.username);
  await page.locator('#password').fill(ADMIN.password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/pos/, { timeout: 30_000 });
});

test.afterAll(async () => {
  fs.writeFileSync(path.join(OUT, `${TAG}-results.json`), JSON.stringify({ ids, results }, null, 2));
  await page?.close();
});

test('open shift', async () => {
  const dialog = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  const shown = await dialog.waitFor({ timeout: 8000 }).then(() => true, () => false);
  if (!shown) await page.getByRole('button', { name: 'เปิดกะ' }).click();
  {
    await dialog.getByLabel('ยอดเงินรวมในลิ้นชัก').fill('2000');
    await dialog.getByRole('button', { name: 'ตกลง' }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(page.getByRole('button', { name: 'ปิดกะ', exact: true })).toBeVisible();
});

test('POS cash sale: item + bill discount, change -> slip printed right after payment', async ({ browser }) => {
  await scan('PA-PIPE-PVC-12');
  await scan('PA-PIPE-PVC-12');
  await scan('PA-PIPE-PVC-12');
  await scan('PA-CEMENT-TPI');
  await scan('PA-CEMENT-TPI');
  await scan('PA-SCREW-6');
  await scan('PA-GLOVE');
  await page.waitForTimeout(500);
  await editCart((s) => {
    const items = s.items as Record<string, unknown>[];
    const pipe = items.find((i) => i.sku === 'PA-PIPE-PVC-12');
    if (pipe) {
      pipe.discountType = 'baht';
      pipe.discountValue = 18.5;
    }
    s.billDiscountType = 'baht';
    s.billDiscountValue = 50;
    s.note = 'ส่งของหน้างาน ซอย 5';
  });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  const pay = page.getByRole('dialog');
  await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
  await pay.getByRole('button', { name: '฿1,000', exact: true }).click();
  const job = await capturePrint(page, () => pay.getByRole('button', { name: 'ยืนยันรับเงินสด' }).click());
  await expect(pay).toContainText('ชำระเงินสำเร็จ!');
  await slip(browser, job, 'slip-cash-pos');

  await pay.getByRole('button', { name: 'ดูตัวอย่าง / PDF' }).click();
  const dlg = await preview('slip-cash-pos', 'ตัวอย่างใบเสร็จรับเงิน');
  const job2 = await capturePrint(page, () => dlg.getByRole('button', { name: /^พิมพ์ใบเสร็จ/ }).click());
  await slip(browser, job2, 'slip-cash-pos-previewprint');
  await closeDialogs();
  await page.getByRole('button', { name: 'ปิดหน้าต่าง (เริ่มออเดอร์ใหม่)' }).click({ timeout: 3000 }).catch(() => undefined);
  await closeDialogs();

  const orders = await api<{ data: { id: string; orderNumber: string }[] }>('GET', '/orders?limit=5', token);
  ids.cashOrder = orders.data[0].orderNumber;
  ids.cashOrderId = orders.data[0].id;
});

test('POS credit sale to a company customer', async ({ browser }) => {
  await scan('PA-CEMENT-TPI');
  await scan('PA-SCREW-6');
  await page.waitForTimeout(400);
  await editCart((s) => {
    s.customerId = ids.customer;
    s.customerName = ids.customerName;
  });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  const pay = page.getByRole('dialog');
  await pay.getByRole('button', { name: /เงินเชื่อ \(/ }).click();
  const job = await capturePrint(page, () => pay.getByRole('button', { name: 'ยืนยันบันทึกหนี้' }).click());
  await slip(browser, job, 'slip-credit-pos');
  await page.getByRole('button', { name: 'ปิดหน้าต่าง (เริ่มออเดอร์ใหม่)' }).click({ timeout: 3000 }).catch(() => undefined);
  await closeDialogs();
  const orders = await api<{ data: { id: string; orderNumber: string }[] }>('GET', '/orders?limit=5', token);
  ids.creditOrder = orders.data[0].orderNumber;
  ids.creditOrderId = orders.data[0].id;
});

test('orders page: slip + A4 reprint of the cash sale', async ({ browser }) => {
  await page.goto('/orders');
  await page.getByText(ids.cashOrder).first().click();
  const detail = page.getByRole('dialog').last();
  await detail.getByRole('button', { name: /พิมพ์สลิป 80mm/ }).click();
  const dlg = await preview('slip-cash-orders', 'ตัวอย่างใบเสร็จรับเงิน');
  const job = await capturePrint(page, () => dlg.getByRole('button', { name: /^พิมพ์ใบเสร็จ/ }).click());
  await slip(browser, job, 'slip-cash-orders');
  await closeDialogs();

  await page.getByText(ids.cashOrder).first().click();
  await page.getByRole('dialog').last().getByRole('button', { name: /พิมพ์ใบเสร็จเต็มรูปแบบ \(A4\)/ }).click();
  const a4dlg = page.getByRole('dialog').last();
  await page.waitForTimeout(500);
  await a4dlg.screenshot({ path: path.join(OUT, `${name('a4-cash-orders')}-preview.png`) });
  const a4job = await capturePrint(page, () => a4dlg.getByRole('button', { name: 'พิมพ์เอกสาร A4' }).click());
  await a4(browser, a4job, 'a4-cash-orders');
  await closeDialogs();

  await page.getByText(ids.creditOrder).first().click();
  await page.getByRole('dialog').last().getByRole('button', { name: /พิมพ์ใบเสร็จเต็มรูปแบบ \(A4\)/ }).click();
  const a4dlg2 = page.getByRole('dialog').last();
  await page.waitForTimeout(500);
  await a4dlg2.screenshot({ path: path.join(OUT, `${name('a4-credit-orders')}-preview.png`) });
  const a4job2 = await capturePrint(page, () => a4dlg2.getByRole('button', { name: 'พิมพ์เอกสาร A4' }).click());
  await a4(browser, a4job2, 'a4-credit-orders');
  await closeDialogs();

  await page.getByText(ids.creditOrder).first().click();
  await page.getByRole('dialog').last().getByRole('button', { name: /พิมพ์สลิป 80mm/ }).click();
  const dlg2 = await preview('slip-credit-orders', 'ตัวอย่างใบเสร็จรับเงิน');
  const job2 = await capturePrint(page, () => dlg2.getByRole('button', { name: /^พิมพ์ใบเสร็จ/ }).click());
  await slip(browser, job2, 'slip-credit-orders');
  await closeDialogs();
});
