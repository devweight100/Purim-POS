import { expect, test, type Browser, type Page } from '@playwright/test';
import { ELECTRON_STUB, capturePrint } from '../scripts/print-audit/render';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, scan, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * Owner request 2026-11-27 (docs/pos-member-picker.md, "บิลส่งของ"): a held bill prints a delivery note with prices,
 * all lines, the customer's phone and address, discounts, the total and "ยังไม่ได้ชำระเงิน" - not a receipt (no
 * receipt number, no VAT wording, no payment method / change). Printing sells nothing, moves no stock and keeps the
 * held bill. Slip (80 mm) by default, A4 on request; by keyboard. Held online orders print at the agreed prices + fee
 * and the print is logged on the server (print count).
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
const P = {
  cement: { name: `ปูนซีเมนต์ปอร์ตแลนด์ ตราเสือ 50 กก.-${TAG}`, barcode: `8859${TAG}01`, price: 165.5, unit: 'ถุง' },
  drill: { name: `สว่านไฟฟ้าไร้สาย 18V พร้อมแบตเตอรี่-${TAG}`, barcode: `8859${TAG}02`, price: 2890, unit: 'เครื่อง' },
  tape: { name: `เทปพันเกลียวท่อประปา-${TAG}`, barcode: `8859${TAG}03`, price: 25, unit: 'ม้วน' },
};
const MEMBER = {
  name: `ห้างหุ้นส่วนจำกัด ช่างสมชายวัสดุก่อสร้าง-${TAG}`, phone: `083${TAG}11`,
  address: `99/123 หมู่บ้านพฤกษาวิลล์ ซอยรามคำแหง 150 เขตสะพานสูง กรุงเทพมหานคร 10240-${TAG}`,
};
const ids: Record<string, string> = {};
let admin = '';
let online = { id: '', orderNo: '' };

async function ensureShift(page: Page) {
  const shiftDlg = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  await shiftDlg.or(page.getByRole('button', { name: 'ปิดกะ', exact: true })).first().waitFor();
  if (await shiftDlg.isVisible()) {
    const total = shiftDlg.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true });
    await total.fill('500');
    await total.press('Enter');
    await expect(shiftDlg).toBeHidden();
  }
}

async function posPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  await page.addInitScript(ELECTRON_STUB);
  await uiLogin(page, CASHIER.username, CASHIER.password);
  await expect(page).toHaveURL(/\/pos/);
  await ensureShift(page);
  await page.evaluate(() => localStorage.removeItem('purim-pos-cart'));
  const loaded = page.waitForResponse((r) => ['/api/products', '/api/products/sync'].includes(new URL(r.url()).pathname) && r.ok(), { timeout: 30_000 });
  await page.reload();
  await loaded;
  await ensureShift(page);
  await page.waitForTimeout(300);
  return { ctx, page };
}

/** what must not change when a delivery note is printed */
async function snapshot() {
  const orders = (await api<{ meta: { total: number } }>('GET', '/orders?limit=1&statusGroup=all', admin)).meta.total;
  const moves: number[] = [];
  for (const k of Object.keys(P)) moves.push((await api<{ meta: { total: number } }>('GET', `/inventory/movements/page?productId=${ids[k]}`, admin)).meta.total);
  return { orders, moves };
}

const heldBills = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('purim-pos-cart') || '{}').state?.heldBills ?? []);

test.beforeAll(async () => {
  await apiLogin(CASHIER);
  admin = await apiLogin(ADMIN);
  for (const [k, p] of Object.entries(P)) {
    const r = await api<{ id: string }>('POST', '/products', admin, {
      name: p.name, barcodes: [p.barcode], unit: p.unit, basePrice: p.price, priceLevel1: p.price, priceLevel2: p.price, priceLevel3: p.price,
      priceLevel4: 0, priceLevel5: 0, costPrice: Math.round(p.price * 0.7 * 100) / 100,
    });
    ids[k] = r.id;
    await api('POST', '/inventory/adjust', admin, { productId: r.id, type: 'ADD', amount: 500, reason: 'ปรับยอดเริ่มต้น' });
  }
  await api('POST', '/customers', admin, { ...MEMBER, type: 'INDIVIDUAL', priceLevel: 1 });
  // an accepted online delivery order with a fee (shown in the same sheet)
  await api('PUT', '/online-shop/config', admin, { enabled: true });
  const s = await api<{ token: string }>('POST', '/public/shop/session', undefined, { dev: { id: `dn${TAG}`, name: 'ลูกค้าออนไลน์' } });
  online = await api<{ id: string; orderNo: string }>('POST', '/public/shop/orders', s.token, {
    contactName: `คุณออนไลน์ ส่งของ ${TAG}`, contactPhone: '0899998888', fulfillment: 'DELIVERY',
    address: `55 หมู่ 2 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ ${TAG}`,
    items: [{ productId: ids.cement, quantity: 2, unitId: null }],
  });
  await api('PATCH', `/online-shop/orders/${online.id}`, admin, { deliveryFee: 60 });
  await api('POST', `/online-shop/orders/${online.id}/accept`, admin, {});
});

test('held bill -> บิลส่งของ (keyboard): prices, customer address, discounts, unpaid total; slip + A4; nothing sold, bill kept', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  await scan(page, P.cement.barcode);
  await scan(page, P.cement.barcode);
  await scan(page, P.drill.barcode);
  await scan(page, P.tape.barcode);
  await page.keyboard.press('Control+m');
  const picker = page.getByTestId('pos-member-picker');
  await picker.getByPlaceholder(/ค้นหาชื่อ/).pressSequentially(MEMBER.phone, { delay: 60 });
  await expect(picker.getByText(MEMBER.name)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  await page.keyboard.press('F10'); // hold
  await expect.poll(async () => (await heldBills(page)).length).toBe(1);
  // a line discount and a bill discount on the held bill (as the cart stores them), then reload
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('purim-pos-cart')!);
    const b = raw.state.heldBills[0];
    const drill = b.items.find((i: { name: string }) => i.name.startsWith('สว่าน'));
    drill.discountType = 'baht';
    drill.discountValue = 90;
    b.billDiscountType = 'baht';
    b.billDiscountValue = 50;
    b.label = 'ส่งไซต์งาน ' + b.label;
    localStorage.setItem('purim-pos-cart', JSON.stringify(raw));
  });
  await page.reload();
  await ensureShift(page);
  await page.waitForTimeout(500);
  const heldBefore = JSON.stringify(await heldBills(page));
  const before = await snapshot();

  await page.keyboard.press('F10'); // empty cart: the held-bills sheet
  const sheet = page.getByTestId('held-bills-sheet');
  await expect(sheet).toBeVisible();
  const bill = sheet.getByTestId('held-bill').filter({ hasText: MEMBER.name });
  // goods 331 + 2890 - 90 + 25 = 3156, bill discount 50 -> 3106
  await expect(bill).toContainText('฿3,106.00');
  const btn = bill.getByTestId('held-delivery-note');
  await btn.focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByTestId('delivery-note-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('delivery-note-print')).toBeFocused();
  const preview = dlg.getByTestId('delivery-note-preview');
  for (const t of ['บิลส่งของ', 'ยังไม่ได้ชำระเงิน', 'ยอดที่ต้องชำระ', '3,106.00', MEMBER.name, MEMBER.phone, MEMBER.address, P.cement.name, P.drill.name, P.tape.name,
    '2 ถุง x 165.50', '331.00', '-90.00', '2,800.00', 'ส่วนลดท้ายบิล', '-50.00', 'ผู้ส่งของ', 'ผู้รับของ', 'พนักงาน', 'บิลพัก ส่งไซต์งาน']) {
    await expect(preview, t).toContainText(t);
  }
  const text = (await preview.textContent()) || '';
  for (const bad of ['ใบกำกับภาษี', 'VAT', 'ภาษีมูลค่าเพิ่ม', 'เงินทอน', 'รับเงินมา', 'ชำระโดย', 'เลขประจำตัวผู้เสียภาษี', 'IN26']) expect(text, bad).not.toContain(bad);
  expect(await horizontalOverflow(page)).toEqual([]);

  // Enter = print the slip (80 mm job)
  const slip = await capturePrint(page, () => page.keyboard.press('Enter'));
  expect(slip.html).toContain('<meta name="purim-print-format" content="80mm"');
  expect(slip.html).toContain('บิลส่งของ');
  expect(slip.html).toContain('3,106.00');
  expect(slip.html).toContain(MEMBER.address);
  await expect(dlg).toBeHidden();

  // A4 on request
  await expect(sheet).toBeVisible();
  await bill.getByTestId('held-delivery-note').click();
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'กระดาษ A4' }).click();
  await expect(preview.locator('[data-delivery-note="a4"]')).toBeVisible();
  await expect(preview.locator('[data-delivery-line]')).toHaveCount(3);
  for (const s of SIZES) {
    await page.setViewportSize(s);
    await page.waitForTimeout(200);
    expect(await horizontalOverflow(page), `${s.width}x${s.height}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  const a4 = await capturePrint(page, () => dlg.getByTestId('delivery-note-print').click());
  expect(a4.html).not.toContain('content="80mm"');
  expect(a4.html).toContain('บิลส่งของ');
  expect(a4.html).toContain('3,106.00');

  // nothing sold, no stock movement, the held bill untouched
  await page.waitForTimeout(500);
  expect(await snapshot()).toEqual(before);
  expect(JSON.stringify(await heldBills(page))).toBe(heldBefore);

  // Esc closes the preview without printing
  await bill.getByTestId('held-delivery-note').click();
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await ctx.close();
});

test('current cart: Shift+F8 opens its บิลส่งของ before holding', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  await scan(page, P.tape.barcode);
  await scan(page, P.tape.barcode);
  await page.keyboard.press('Shift+F8');
  const dlg = page.getByTestId('delivery-note-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('delivery-note-preview')).toContainText('2 ม้วน x 25.00');
  await expect(dlg.getByTestId('delivery-note-preview')).toContainText('50.00');
  await expect(dlg.getByTestId('delivery-note-preview')).toContainText('ลูกค้าทั่วไป');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  // the cart is still there
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('purim-pos-cart') || '{}').state?.items?.length)).toBe(1);
  await ctx.close();
});

test('held online order: agreed prices + delivery fee; the print is logged with a count; the order is unchanged', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  const before = await api<{ status: string; claim: unknown }>('GET', `/online-shop/orders/${online.id}`, admin);
  const orders = (await api<{ meta: { total: number } }>('GET', '/orders?limit=1&statusGroup=all', admin)).meta.total;
  await page.keyboard.press('F10');
  const row = page.getByTestId('pos-online-order').filter({ hasText: online.orderNo });
  await expect(row).toBeVisible();
  await row.getByTestId('online-delivery-note').click();
  const dlg = page.getByTestId('delivery-note-dialog');
  await expect(dlg).toBeVisible();
  const preview = dlg.getByTestId('delivery-note-preview');
  for (const t of ['บิลส่งของ', online.orderNo, 'ค่าส่ง', '60.00', '391.00', 'ยังไม่ได้ชำระเงิน', 'บางพลีใหญ่', '0899998888', 'ร้านไปส่ง']) await expect(preview, t).toContainText(t);
  const job = await capturePrint(page, () => dlg.getByTestId('delivery-note-print').click());
  expect(job.html).toContain('391.00');
  await expect.poll(async () => (await api<{ printCount: number }>('GET', `/online-shop/orders/${online.id}/delivery-note`, admin)).printCount).toBe(1);
  // reprint: marked "พิมพ์ครั้งที่ 2"
  await row.getByTestId('online-delivery-note').click();
  await expect(preview).toContainText('พิมพ์ครั้งที่ 2');
  await page.keyboard.press('Escape');
  const after = await api<{ status: string; claim: unknown }>('GET', `/online-shop/orders/${online.id}`, admin);
  expect({ status: after.status, claim: after.claim }).toEqual({ status: before.status, claim: before.claim });
  expect((await api<{ meta: { total: number } }>('GET', '/orders?limit=1&statusGroup=all', admin)).meta.total).toBe(orders);
  await ctx.close();
});
