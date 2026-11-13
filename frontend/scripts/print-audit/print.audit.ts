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
  expect.soft(r.scrollWidth, `${n}: nothing may stick out past 288px`).toBeLessThanOrEqual(288);
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
  await api('PATCH', '/settings', token, { ...STORE, vatEnabled: VAT, vatRate: 7, allowDecimalQty: false, receiptOptions: null });

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

/** Print from the topmost dialog (preview screenshot first). */
async function printTopDialog(browser: Browser, n: string, button: RegExp | string, kind: 'slip' | 'a4') {
  const dlg = page.getByRole('dialog').last();
  await expect(dlg).toBeVisible();
  await page.waitForTimeout(600);
  await dlg.screenshot({ path: path.join(OUT, `${name(n)}-preview.png`) });
  const btn = dlg.getByRole('button', { name: button }).last();
  const job = await capturePrint(page, () => btn.click());
  return kind === 'slip' ? slip(browser, job, n) : a4(browser, job, n);
}

/** Open a document through the document search (F3). */
async function openFromSearch(docNumber: string) {
  await closeDialogs();
  await page.keyboard.press('F3');
  const search = page.getByRole('dialog').last();
  await search.locator('input').first().fill(docNumber);
  // results appear as you type; open the one with this number ("ดู & พิมพ์..." button of its row)
  await search.getByText(docNumber, { exact: true }).first().waitFor();
  await search
    .locator(`xpath=.//*[normalize-space(text())="${docNumber}"]/ancestor::div[.//button][1]//button`)
    .last()
    .click();
}

test('orders page: slip + A4 reprint of the cash sale; slip of the credit sale', async ({ browser }) => {
  await page.goto('/orders');
  await page.getByText(ids.cashOrder).first().click();
  await page.getByRole('dialog').last().getByRole('button', { name: /พิมพ์สลิป 80mm/ }).click();
  await printTopDialog(browser, 'slip-cash-orders', /^พิมพ์ใบเสร็จ/, 'slip');
  await closeDialogs();

  await page.getByText(ids.cashOrder).first().click();
  await page.getByRole('dialog').last().getByRole('button', { name: /พิมพ์ใบเสร็จเต็มรูปแบบ \(A4\)/ }).click();
  await printTopDialog(browser, 'a4-cash-orders', 'พิมพ์เอกสาร A4', 'a4');
  await closeDialogs();

  await page.getByText(ids.creditOrder).first().click();
  await page.getByRole('dialog').last().getByRole('button', { name: /พิมพ์สลิป 80mm/ }).click();
  await printTopDialog(browser, 'slip-credit-orders', /^พิมพ์ใบเสร็จ/, 'slip');
  await closeDialogs();
});

test('POS history and document search reprint the same slip as the orders page', async ({ browser }) => {
  await page.goto('/pos');
  await page.waitForTimeout(1500);
  await closeDialogs();
  await page.getByRole('button', { name: /ประวัติ/ }).first().click();
  const row = page.getByRole('dialog').last().locator('tr').filter({ hasText: ids.cashOrder });
  await row.getByRole('button', { name: /เครื่องมือ/ }).click();
  await page.getByRole('menuitem', { name: 'ดูใบเสร็จ' }).click();
  await printTopDialog(browser, 'slip-cash-poshistory', /^พิมพ์ใบเสร็จ/, 'slip');
  await closeDialogs();

  await openFromSearch(ids.cashOrder);
  await printTopDialog(browser, 'slip-cash-search', /^พิมพ์ใบเสร็จ/, 'slip');
  await closeDialogs();

  const strip = (t: string) => t.replace(/\*\*\* พิมพ์ซ้ำ[^*]*\*\*\*/, '').replace(/\s+/g, ' ').trim();
  const ref = results['slip-cash-orders'] as { text: string; cssHeight: number };
  for (const n of ['slip-cash-poshistory', 'slip-cash-search']) {
    const r = results[n] as { text: string; cssHeight: number };
    expect(strip(r.text), `${n} == orders page`).toBe(strip(ref.text));
    expect(r.cssHeight).toBe(ref.cssHeight);
  }
});

test('seed the other documents through the API', async () => {
  // mixed payment (cash + transfer) to the company customer, with a pack unit
  const pipe = ids['PA-PIPE-PVC-12'];
  const glove = ids['PA-GLOVE'];
  const shift = (await api<{ data: { id: string; isOpen: boolean; terminalId?: string }[] }>('GET', '/shifts/history?limit=1', token)).data[0];
  const mixed = await api<{ id: string; orderNumber: string }>('POST', '/orders/checkout', token, {
    clientOrderId: `pa-mixed-${Date.now()}-0001`,
    customerId: ids.customer,
    shiftId: shift?.id,
    terminalId: shift?.terminalId,
    createdAt: new Date().toISOString(),
    discountAmount: 0,
    totalAmount: 309,
    items: [
      { productId: pipe, quantity: 2, unitPrice: 89.5, unitName: 'เส้น', conversionFactor: 1, discountAmount: 0 },
      { productId: glove, quantity: 1, unitPrice: 130, unitName: 'โหล', conversionFactor: 12, discountAmount: 0 },
    ],
    payments: [
      { method: 'CASH', amount: 200 },
      { method: 'TRANSFER', amount: 109, referenceNo: 'กสิกรไทย xxx-1234' },
    ],
  });
  ids.mixedOrder = mixed.orderNumber;
  ids.mixedOrderId = mixed.id;

  // partial return of the cash sale (1 pipe)
  try {
    const full = await api<{ items: { id: string; productId: string }[] }>('GET', `/orders/${ids.cashOrderId}`, token);
    const line = full.items.find((i) => i.productId === pipe);
    await api('POST', `/orders/${ids.cashOrderId}/returns`, token, {
      items: [{ orderItemId: line?.id, quantity: 1 }],
      reason: 'ลูกค้าซื้อเกิน',
      refundMethod: 'CASH',
      shiftId: shift?.id,
      clientReturnId: `pa-return-${Date.now()}-0001`,
    });
  } catch (e) {
    results.returnError = String(e);
  }

  // debt payment on the credit sale (partial)
  const debts = await api<{ data?: { id: string; orderId: string }[] } | { id: string; orderId: string }[]>('GET', '/debts', token);
  const dlist = Array.isArray(debts) ? debts : debts.data || [];
  const debt = dlist.find((d) => d.orderId === ids.creditOrderId);
  if (debt) {
    const paid = await api<{ receiptNo?: string }>('POST', `/debts/${debt.id}/pay`, token, {
      amount: 100,
      paymentMethod: 'CASH',
      shiftId: shift?.id,
      clientPaymentId: `pa-debt-${Date.now()}-0001`,
      note: 'ชำระงวดแรก',
    });
    ids.debtReceipt = paid.receiptNo || '';
  }

  // claim on the cash sale (store discount)
  try {
    const claim = await api<{ id: string; claimNumber?: string }>('POST', '/claims', token, {
      productId: ids['PA-CEMENT-TPI'],
      orderId: ids.cashOrderId,
      quantity: 1,
      unitName: 'ถุง',
      resolutionType: 'STORE_DISCOUNT',
      discountAmount: 145,
      defectReason: 'ถุงขาด ปูนจับตัวเป็นก้อน',
      cashierName: 'ผู้ดูแลระบบ',
      clientClaimId: `pa-claim-${Date.now()}-0001`,
    });
    ids.claim = claim.claimNumber || claim.id;
  } catch (e) {
    results.claimError = String(e);
  }

  // purchase order with line discounts + VAT, received
  const suppliers = await api<{ id: string; name: string }[] | { data: { id: string; name: string }[] }>('GET', '/suppliers', token);
  const supplier = (Array.isArray(suppliers) ? suppliers : suppliers.data)[0];
  ids.supplier = supplier.id;
  const po = await api<{ id: string; poNumber: string; items: { id: string; quantity: number; unitCost: number }[] }>(
    'POST',
    '/purchase-orders',
    token,
    {
      supplierId: supplier.id,
      supplierInvoiceNo: 'INV-6911-0042',
      billDate: new Date().toISOString(),
      notes: 'ส่งของภายในวันศุกร์',
      billDiscountType: 'baht',
      billDiscountValue: 100,
      items: [
        { productId: pipe, quantity: 50, unitCost: 62, discountType: 'percent', discountValue: 5, vatType: 'EXCLUDED', vatRate: 7 },
        { productId: ids['PA-CEMENT-TPI'], quantity: 20, unitCost: 101.5, discountType: 'baht', discountValue: 30, vatType: 'EXCLUDED', vatRate: 7 },
        { productId: ids['PA-SCREW-6'], quantity: 10, unitCost: 24.5, vatType: 'EXCLUDED', vatRate: 7 },
      ],
    },
  );
  ids.po = po.poNumber;
  ids.poId = po.id;
  try {
    await api('POST', `/purchase-orders/${po.id}/issue`, token);
    const fresh = await api<{ items: { id: string; quantity: number; unitCost: number }[] }>('GET', `/purchase-orders/${po.id}`, token);
    await api('POST', `/purchase-orders/${po.id}/receive`, token, {
      clientReceiptId: `pa-grn-${Date.now()}-0001`,
      items: fresh.items.map((i) => ({ purchaseOrderItemId: i.id, receivedQty: Number(i.quantity), unitCost: Number(i.unitCost) })),
    });
  } catch (e) {
    results.poReceiveError = String(e);
  }

  // supplier return (credit note)
  try {
    const sr = await api<{ id: string; returnNumber?: string }>('POST', '/supplier-returns', token, {
      supplierId: supplier.id,
      reason: 'สินค้าชำรุดจากการขนส่ง',
      items: [{ productId: pipe, quantity: 3, unitCost: 62, itemType: 'DEFECTIVE' }],
    });
    ids.supplierReturn = sr.returnNumber || sr.id;
  } catch (e) {
    results.supplierReturnError = String(e);
  }

  // payment voucher for the PO bill
  try {
    const bills = await api<{ data?: { id: string; remainingAmount?: number | string; netAmount?: number | string }[] } | { id: string }[]>(
      'GET',
      `/payables/bills?supplierId=${supplier.id}`,
      token,
    );
    const blist = (Array.isArray(bills) ? bills : bills.data || []) as { id: string; remainingAmount?: number | string; netAmount?: number | string; totalAmount?: number | string }[];
    const bill = blist.find((b) => b.id === ids.poId) || blist[0];
    const amount = Number(bill?.remainingAmount ?? bill?.netAmount ?? bill?.totalAmount ?? 0);
    const v = await api<{ voucherNumber?: string; voucher?: { voucherNumber?: string } }>('POST', '/payables/settle-multiple', token, {
      clientVoucherId: `pa-voucher-${Date.now()}-0001`,
      supplierId: supplier.id,
      billsToSettle: [{ poId: bill.id, amountToPay: amount }],
      paymentMethod: 'TRANSFER',
      referenceNo: 'TRF-0099123',
      note: 'จ่ายค่าสินค้างวด พ.ย.',
    });
    ids.voucher = v.voucherNumber || v.voucher?.voucherNumber || '';
  } catch (e) {
    results.voucherError = String(e);
  }
  fs.writeFileSync(path.join(OUT, `${TAG}-ids.json`), JSON.stringify({ ids, results }, null, 2));
});

test('A4 tax invoice to a company buyer (mixed payment), from the orders page', async ({ browser }) => {
  await page.goto('/orders');
  await page.getByText(ids.mixedOrder).first().click();
  await page.getByRole('dialog').last().getByRole('button', { name: /พิมพ์ใบเสร็จเต็มรูปแบบ \(A4\)/ }).click();
  await printTopDialog(browser, 'a4-mixed-company', 'พิมพ์เอกสาร A4', 'a4');
  await closeDialogs();
  await page.getByText(ids.mixedOrder).first().click();
  await page.getByRole('dialog').last().getByRole('button', { name: /พิมพ์สลิป 80mm/ }).click();
  await printTopDialog(browser, 'slip-mixed-orders', /^พิมพ์ใบเสร็จ/, 'slip');
  await closeDialogs();
});

test('debt payment: installment slip + A4 from the credit sale', async ({ browser }) => {
  await page.goto('/orders');
  await page.getByText(ids.creditOrder).first().click();
  await page.getByRole('dialog').last().getByRole('button', { name: /ประวัติชำระ/ }).click();
  const hist = page.getByRole('dialog').last();
  await expect(hist).toBeVisible();
  await page.waitForTimeout(800);
  await hist.getByRole('button', { name: /^สลิป$/ }).first().click();
  await printTopDialog(browser, 'slip-debt-payment', /พิมพ์สลิป/, 'slip');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.getByRole('dialog').last().getByRole('button', { name: /พิมพ์ A4/ }).first().click();
  await printTopDialog(browser, 'a4-debt-installment', 'พิมพ์เอกสาร A4', 'a4');
  await closeDialogs();
});

for (const doc of [
  { key: 'claim', n: 'claim', button: /พิมพ์/, kinds: ['slip', 'a4'] as const },
  { key: 'po', n: 'a4-po', button: /พิมพ์/, kinds: ['a4'] as const },
  { key: 'supplierReturn', n: 'a4-supplier-return', button: /พิมพ์เอกสาร/, kinds: ['a4'] as const },
  { key: 'voucher', n: 'a4-voucher', button: /พิมพ์ใบสำคัญจ่าย/, kinds: ['a4'] as const },
]) {
  test(`document search: ${doc.key}`, async ({ browser }) => {
    test.skip(!ids[doc.key], `${doc.key} was not created: ${JSON.stringify(results)}`);
    await page.goto('/pos');
    await page.waitForTimeout(1200);
    await openFromSearch(ids[doc.key]);
    const dlg = page.getByRole('dialog').last();
    await expect(dlg).toBeVisible();
    for (const kind of doc.kinds) {
      if (doc.key === 'claim') {
        // the claim document has an 80mm / A4 switch
        await dlg.getByRole('button', { name: kind === 'slip' ? /80mm/ : /A4/ }).first().click().catch(() => undefined);
      }
      const buttons = dlg.getByRole('button', { name: doc.button });
      const label = await buttons.last().innerText();
      await printTopDialog(browser, `${doc.n}${doc.kinds.length > 1 ? `-${kind}` : ''}`, new RegExp(label.trim().replace(/[()]/g, '.')), kind);
    }
    await closeDialogs();
  });
}

test('close shift -> shift summary slip', async ({ browser }) => {
  await page.goto('/pos');
  await page.waitForTimeout(1500);
  await closeDialogs();
  await page.getByRole('button', { name: 'ปิดกะ', exact: true }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: 'ปิดกะการขาย' });
  await expect(dlg).toBeVisible();
  const expectedText = await dlg.innerText();
  const m = /เงินสดที่ควรมีในลิ้นชัก[\s\S]*?฿([\d,]+(?:\.\d+)?)/.exec(expectedText);
  await dlg.getByPlaceholder('0.00').fill(m ? m[1].replace(/,/g, '') : '0');
  await dlg.getByRole('button', { name: 'ยืนยันปิดกะ' }).click();
  const summary = page.getByRole('dialog').filter({ hasText: 'ใบสรุปปิดกะ' });
  await expect(summary).toBeVisible({ timeout: 20_000 });
  await printTopDialog(browser, 'slip-shift-summary', /พิมพ์สลิป/, 'slip');
  await closeDialogs();
});
