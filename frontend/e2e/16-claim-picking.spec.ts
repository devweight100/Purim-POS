import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ELECTRON_STUB, capturePrint, type CapturedPrint } from '../scripts/print-audit/render';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, expectCartQty, scan, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Claim lock + picking slip (docs/online-shop.md "Claim lock + picking slip"):
 * two cashiers in two browsers look at the same online order; one claims it, the other sees "กำลังจัดโดย …"
 * live (no reload) with the picking buttons disabled (payment stays open: owner 2026-11-17 "picking is for the
 * picker"). A picks and presses "จัดของเสร็จ", B opens the bill, takes the cash and marks it กำลังไปส่ง / เสร็จ. The holder prints the picking slip (desktop app path: the
 * HTML job sent to the slip printer is captured and rendered at 80 mm and 58 mm); the POS prints the cart's slip
 * with F8 (bundle parts, no prices) and a reprint from the sales history; a plain browser prints the slip as a
 * picture (print preview path); a 40-line order with long names wraps and continues on the roll.
 * PICK_SHOT_DIR=<dir> saves the slip images and a screenshot of the claim badge.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
const OUT = process.env.PICK_SHOT_DIR;
const C2 = { username: `cashier2_${TAG}`, password: `Cash2#Pk${TAG}`, fullName: 'สมหญิง แคชเชียร์สอง' };
const HOLDER = 'สมศรี พนักงานขาย'; // cashier1 (seed)
const P = {
  cement: { sku: `PK-CEM-${TAG}`, name: 'ปูนซีเมนต์ปอร์ตแลนด์ ตราเสือ 50 กก.', unit: 'ถุง', price: 165.5 },
  rebar: { sku: `PK-RB-${TAG}`, name: 'เหล็กเส้นกลม 9 มม. ยาว 10 เมตร (มอก.)', unit: 'เส้น', price: 89.25 },
  faucet: { sku: `PK-FC-${TAG}`, name: 'ก๊อกน้ำบอลวาล์ว ½ นิ้ว', unit: 'ตัว', price: 120 },
  tape: { sku: `PK-TP-${TAG}`, name: 'เทปพันเกลียว', unit: 'ม้วน', price: 15 },
  bundle: { sku: `PK-SET-${TAG}`, name: 'ชุดก๊อกน้ำพร้อมเทป', unit: 'ชุด', price: 149 },
};
const ids: Record<string, string> = {};
const longIds: string[] = [];
let adminToken = '';
const orders: Record<string, { id: string; orderNo: string }> = {};

/** anything money-like that must never be on a picking slip */
const MONEY = /฿|บาท|ราคา|ยอดรวม|ยอดสุทธิ|ภาษี|VAT|ส่วนลด|ค่าส่ง|\d\.\d{2}\b|165\.5|89\.25/;

function save(name: string, data: Buffer | string) {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), data);
}

/**
 * Lay the print job out like the desktop raster printer (288 CSS px, print media) and capture it `dots` wide
 * (576 = 80 mm, 384 = 58 mm); also the 1-bit picture (threshold 160) the printer gets.
 */
async function renderSlipAt(browser: Browser, html: string, dots: number, name?: string) {
  const ctx = await browser.newContext({ viewport: { width: 288, height: 600 }, deviceScaleFactor: dots / 288 });
  const p = await ctx.newPage();
  try {
    await p.emulateMedia({ media: 'print' });
    await p.setContent(html, { waitUntil: 'networkidle' });
    await p.evaluate(async () => {
      await (document as Document & { fonts: FontFaceSet }).fonts.ready;
    });
    const info = await p.evaluate(() => {
      let m = 0;
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.height > 0) m = Math.max(m, r.bottom + window.scrollY);
      }
      const nameHeights = Array.from(document.querySelectorAll<HTMLElement>('[data-picking-line] > div > span.flex-1')).map((s) => s.getBoundingClientRect().height);
      return {
        cssHeight: Math.ceil(m + 8),
        scrollWidth: document.documentElement.scrollWidth,
        lines: document.body.innerText.split('\n').map((l) => l.trim()).filter(Boolean),
        ticks: document.querySelectorAll('[data-tick]').length,
        nameHeights,
      };
    });
    if (name) {
      await p.setViewportSize({ width: 288, height: Math.max(100, info.cssHeight) });
      const buf = await p.screenshot({ clip: { x: 0, y: 0, width: 288, height: info.cssHeight } });
      save(`${name}.png`, buf);
      const oneBit = await p.evaluate(async (dataUrl) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < d.data.length; i += 4) {
          const lum = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
          d.data[i] = d.data[i + 1] = d.data[i + 2] = lum < 160 ? 0 : 255;
          d.data[i + 3] = 255;
        }
        g.putImageData(d, 0, 0);
        return { url: c.toDataURL('image/png'), width: c.width };
      }, `data:image/png;base64,${buf.toString('base64')}`);
      expect(oneBit.width).toBe(dots);
      save(`${name}-1bit.png`, Buffer.from(oneBit.url.split(',')[1], 'base64'));
      save(`${name}.html`, html);
    }
    return info;
  } finally {
    await ctx.close();
  }
}

/** A slip job sent to the desktop app: 80 mm (raster printer), fits 288 px, no money anywhere. */
async function checkSlipJob(browser: Browser, job: CapturedPrint, name: string) {
  expect(job.format).toBe('80mm');
  expect(job.html).toContain('<meta name="purim-print-format" content="80mm"');
  const r80 = await renderSlipAt(browser, job.html, 576, `${name}-80mm`);
  const r58 = await renderSlipAt(browser, job.html, 384, `${name}-58mm`);
  for (const r of [r80, r58]) expect(r.scrollWidth, `${name}: nothing past the printable width`).toBeLessThanOrEqual(288);
  expect(r58.lines).toEqual(r80.lines); // same layout scaled to the 58 mm head
  expect(r80.lines).toContain('ใบจัดของ');
  expect(r80.lines.join(' ')).not.toMatch(MONEY);
  expect(r80.lines.some((l) => /\?{3,}/.test(l))).toBe(false);
  return r80;
}

async function placeOrder(dev: string, fulfillment: 'PICKUP' | 'DELIVERY', items: { productId: string; quantity: number }[]) {
  const s = await api<{ token: string }>('POST', '/public/shop/session', undefined, { dev: { id: `${dev}${TAG}`, name: 'ลูกค้าทดสอบ' } });
  return api<{ id: string; orderNo: string }>('POST', '/public/shop/orders', s.token, {
    contactName: dev === 'long' ? 'บริษัท รับเหมาก่อสร้าง ทดสอบยาว จำกัด' : 'คุณมานี มีของ',
    contactPhone: '0812345678',
    fulfillment,
    address: fulfillment === 'DELIVERY' ? '12/3 หมู่ 4 ซอยวัดใหม่ ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ' : undefined,
    note: fulfillment === 'DELIVERY' ? 'โทรก่อนส่ง วางของหน้าบ้าน' : undefined,
    items: items.map((i) => ({ ...i, unitId: null })),
  });
}

async function newCashierPage(browser: Browser, opts: { desktop: boolean; username: string; password: string }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  if (opts.desktop) await page.addInitScript(ELECTRON_STUB);
  await uiLogin(page, opts.username, opts.password);
  await expect(page).toHaveURL(/\/pos/);
  return { ctx, page };
}

async function ensureShift(page: Page) {
  const shiftDlg = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  await shiftDlg.or(page.getByRole('button', { name: 'ปิดกะ', exact: true })).first().waitFor();
  if (await shiftDlg.isVisible()) {
    await shiftDlg.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true }).fill('500');
    await shiftDlg.getByRole('button', { name: 'ตกลง' }).click();
    await expect(shiftDlg).toBeHidden();
  }
}

let A: { ctx: BrowserContext; page: Page };
let B: { ctx: BrowserContext; page: Page };

test.beforeAll(async ({ browser }) => {
  await apiLogin(CASHIER);
  adminToken = await apiLogin(ADMIN);
  const mk = async (key: keyof typeof P, extra: Record<string, unknown> = {}) => {
    const p = P[key];
    const r = await api<{ id: string }>('POST', '/products', adminToken, { name: p.name, sku: p.sku, unit: p.unit, basePrice: p.price, priceLevel1: p.price, costPrice: 1, ...extra });
    ids[key] = r.id;
    if (!extra.isBundle) await api('POST', '/inventory/adjust', adminToken, { productId: r.id, type: 'ADD', amount: 500, reason: 'ปรับยอดเริ่มต้น' });
  };
  await mk('cement');
  await mk('rebar');
  await mk('faucet');
  await mk('tape');
  await mk('bundle', { isBundle: true, bundleItems: [{ childProductId: ids.faucet, quantity: 1 }, { childProductId: ids.tape, quantity: 2 }] });
  for (let i = 1; i <= 40; i++) {
    const long = i % 5 === 0 ? ' ชนิดพิเศษสำหรับงานโครงสร้างภายนอกอาคาร ทนแดดทนฝน รับประกันสิบปี' : '';
    const r = await api<{ id: string }>('POST', '/products', adminToken, { name: `วัสดุรายการที่ ${i}${long}`, sku: `PK-L${i}-${TAG}`, unit: i % 3 ? 'ชิ้น' : 'กล่อง', basePrice: 10 + i, priceLevel1: 10 + i, costPrice: 1 });
    await api('POST', '/inventory/adjust', adminToken, { productId: r.id, type: 'ADD', amount: 100, reason: 'ปรับยอดเริ่มต้น' });
    longIds.push(r.id);
  }
  // second cashier
  await api('POST', '/auth/register', adminToken, { username: C2.username, password: C2.password, fullName: C2.fullName, role: 'CASHIER', pinCode: String(3000 + (Number(TAG) % 6000)), permissions: ['POS_SELL'] });
  await api('PUT', '/online-shop/config', adminToken, { enabled: true });
  orders.short = await placeOrder('short', 'DELIVERY', [{ productId: ids.cement, quantity: 3 }, { productId: ids.rebar, quantity: 12 }]);
  orders.long = await placeOrder('long', 'PICKUP', longIds.map((productId, i) => ({ productId, quantity: (i % 4) + 1 })));

  A = await newCashierPage(browser, { desktop: true, username: CASHIER.username, password: CASHIER.password });
  B = await newCashierPage(browser, { desktop: false, username: C2.username, password: C2.password });
});

test.afterAll(async () => {
  await A?.ctx.close();
  await B?.ctx.close();
});

test('two cashiers: one claims, the other sees "กำลังจัดโดย …" live and the buttons disabled with the reason', async () => {
  for (const { page } of [A, B]) {
    await page.goto('/online-orders');
    const row = page.getByTestId('online-order-row').filter({ hasText: orders.short.orderNo });
    await expect(row.getByTestId('claim-badge')).toHaveText('ยังไม่มีคนจัด');
    await row.click();
    await expect(page.getByTestId('claim-bar')).toContainText('ยังไม่มีใครรับจัด');
  }
  const a = A.page.getByTestId('online-order-detail');
  const b = B.page.getByTestId('online-order-detail');
  await a.getByRole('button', { name: 'รับจัดออเดอร์นี้' }).click();
  await expect(A.page.getByTestId('claim-bar')).toContainText('คุณกำลังจัด');
  await expect(a.getByRole('button', { name: 'ปล่อยงาน' })).toBeVisible();

  // the other terminal: live (realtime event, no reload)
  await expect(B.page.getByTestId('claim-bar')).toContainText(`กำลังจัดโดย ${HOLDER}`);
  await expect(B.page.getByTestId('online-order-row').filter({ hasText: orders.short.orderNo }).getByTestId('claim-badge')).toContainText(`กำลังจัดโดย ${HOLDER}`);
  for (const name of ['รับออเดอร์', /พิมพ์ใบจัดของ/, /ยกเลิกออเดอร์/]) await expect(b.getByRole('button', { name })).toBeDisabled();
  await expect(b.getByRole('button', { name: 'รับจัดออเดอร์นี้' })).toHaveCount(0);
  await expect(b.getByRole('button', { name: 'ปลดล็อก/โอนมาที่ฉัน' })).toHaveCount(0); // cashier: no takeover
  await expect(b).toContainText('งานจัดของทำไม่ได้จนกว่าจะปล่อยงาน');
  await expect(b.getByLabel('ค่าส่ง')).toHaveCount(0); // no edits
  for (const size of SIZES) {
    await B.page.setViewportSize(size);
    expect(await horizontalOverflow(B.page)).toEqual([]);
    expect(await spacingIssues(B.page, 'main')).toEqual([]);
  }
  await B.page.setViewportSize({ width: 1366, height: 768 });
  if (OUT) save('online-orders-claim-badge-1366x768.png', await B.page.screenshot());
  await B.page.setViewportSize({ width: 1920, height: 1080 });
  if (OUT) save('online-orders-claim-badge-1920x1080.png', await B.page.screenshot());
  await B.page.setViewportSize({ width: 1366, height: 768 });
  for (const size of SIZES) {
    await A.page.setViewportSize(size);
    expect(await horizontalOverflow(A.page)).toEqual([]);
    expect(await spacingIssues(A.page, 'main')).toEqual([]);
  }
  await A.page.setViewportSize({ width: 1366, height: 768 });
});

test('the holder prints the picking slip (desktop raster job): no prices, delivery details; 2nd print is a reprint', async ({ browser }) => {
  const a = A.page.getByTestId('online-order-detail');
  const job = await capturePrint(A.page, () => a.getByRole('button', { name: /^พิมพ์ใบจัดของ/ }).click());
  const r = await checkSlipJob(browser, job, 'online-short');
  expect(r.lines).toEqual(expect.arrayContaining(['ออเดอร์ออนไลน์', orders.short.orderNo, 'คุณมานี มีของ', 'ส่ง (ร้านไปส่ง)', '0812345678', P.cement.name, '3 ถุง', P.rebar.name, '12 เส้น', 'รวม 2 รายการ', 'ผู้จัด', 'ผู้ตรวจ']));
  expect(r.lines.join(' ')).toContain('ที่อยู่: 12/3 หมู่ 4');
  expect(r.lines.join(' ')).toContain('หมายเหตุ: โทรก่อนส่ง');
  expect(r.lines.some((l) => l.includes('พิมพ์ซ้ำ'))).toBe(false);
  expect(r.ticks).toBe(2);
  await expect(A.page.getByTestId('claim-bar')).toContainText('พิมพ์ใบจัดของแล้ว 1 ครั้ง');
  const again = await capturePrint(A.page, () => a.getByRole('button', { name: /^พิมพ์ใบจัดของ/ }).click());
  expect(again.html).toContain('พิมพ์ซ้ำ');
  // the holder accepts (fee 50); the other terminal follows live and stays locked
  await a.getByLabel('ค่าส่ง').fill('50');
  await a.getByRole('button', { name: 'รับออเดอร์' }).click();
  await expect(a).toContainText('รับแล้ว');
  const b = B.page.getByTestId('online-order-detail');
  await expect(b).toContainText('รับแล้ว');
  // picking stays A's; taking the payment does not
  await expect(b.getByRole('button', { name: 'จัดของเสร็จ' })).toBeDisabled();
  await expect(b.getByRole('button', { name: 'รับเงินที่หน้าขาย' })).toBeEnabled();
  await expect(a.getByRole('button', { name: 'จัดของเสร็จ' })).toBeEnabled();
});

test('POS: the other cashier sees "ยังไม่ได้จัดของ · กำลังจัดโดย …" and may open the bill; F8 prints the cart slip with bundle parts; history reprint', async ({ browser }) => {
  // cashier 2 (plain browser): held bills show who is picking the order; "เปิดบิล" stays enabled (a warning only)
  await B.page.goto('/pos');
  await ensureShift(B.page);
  await B.page.getByRole('button', { name: /^บิลพัก/ }).click();
  const sheetRow = B.page.getByRole('dialog').getByTestId('pos-online-order').filter({ hasText: orders.short.orderNo });
  await expect(sheetRow.getByTestId('picking-note')).toHaveText(new RegExp(`ยังไม่ได้จัดของ · กำลังจัดโดย ${HOLDER}`));
  await expect(sheetRow.getByRole('button', { name: 'เปิดบิล' })).toBeEnabled();
  await B.page.keyboard.press('Escape');

  // cashier 1 (desktop app): cart with a bundle -> F8
  await A.page.goto('/pos');
  await ensureShift(A.page);
  await scan(A.page, P.cement.sku);
  await scan(A.page, P.cement.sku);
  await scan(A.page, P.bundle.sku);
  await expectCartQty(A.page, P.cement.sku, 2);
  await expectCartQty(A.page, P.bundle.sku, 1);
  const job = await capturePrint(A.page, () => A.page.keyboard.press('F8'));
  const r = await checkSlipJob(browser, job, 'pos-cart-bundle');
  expect(r.lines).toEqual(expect.arrayContaining([P.cement.name, '2 ถุง', P.bundle.name, '1 ชุด', P.faucet.name, '1 ตัว', P.tape.name, '2 ม้วน', 'รวม 2 รายการ']));
  expect(r.ticks).toBe(4); // 2 lines + 2 bundle parts
  // the cart button does the same
  const viaButton = await capturePrint(A.page, () => A.page.locator('#pos-cart').getByRole('button', { name: 'ใบจัดของ' }).click());
  expect(viaButton.html).toContain(P.bundle.name);

  // sell it, then reprint the picking slip from the sales history
  await A.page.getByRole('button', { name: 'ชำระเงิน' }).last().click();
  const pay = A.page.getByRole('dialog').filter({ hasText: 'เลือกช่องทางการชำระเงิน' });
  await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
  const cash = A.page.getByRole('dialog').filter({ hasText: 'รับชำระด้วยเงินสด' });
  await A.page.keyboard.type('1000');
  const receipt = await capturePrint(A.page, () => cash.getByRole('button', { name: /ยืนยันรับเงินสด/ }).click());
  const orderNumber = /ORD-\d+/.exec(receipt.html)?.[0] || '';
  expect(orderNumber).not.toBe('');
  expect(receipt.html).not.toContain('ใบจัดของ'); // auto picking slip is off by default
  await A.page.getByRole('button', { name: 'ปิดหน้าต่าง (เริ่มออเดอร์ใหม่)' }).click({ timeout: 3000 }).catch(() => undefined);
  for (let i = 0; i < 3 && (await A.page.getByRole('dialog').count()) > 0; i++) await A.page.keyboard.press('Escape');
  await A.page.getByRole('button', { name: /ประวัติ/ }).first().click();
  const histRow = A.page.getByRole('dialog').last().locator('tr').filter({ hasText: orderNumber });
  await histRow.getByRole('button', { name: /เครื่องมือ/ }).click();
  const reprint = await capturePrint(A.page, () => A.page.getByRole('menuitem', { name: 'พิมพ์ใบจัดของ' }).click());
  const rr = await checkSlipJob(browser, reprint, 'pos-history-reprint');
  expect(rr.lines).toEqual(expect.arrayContaining(['บิลขาย', orderNumber, P.cement.name, '2 ถุง', P.bundle.name, P.tape.name, '2 ม้วน']));
  expect(rr.lines.some((l) => /^\*\*\* พิมพ์ซ้ำ .* \*\*\*$/.test(l))).toBe(true);
  for (let i = 0; i < 3 && (await A.page.getByRole('dialog').count()) > 0; i++) await A.page.keyboard.press('Escape');

  // orders page detail: same reprint
  await A.page.goto('/orders');
  await A.page.getByText(orderNumber).first().click();
  const fromOrders = await capturePrint(A.page, () => A.page.getByRole('dialog').last().getByRole('button', { name: 'พิมพ์ใบจัดของ' }).click());
  expect(fromOrders.html).toContain(orderNumber);
  expect(fromOrders.html).toContain('พิมพ์ซ้ำ');
});

test('A presses "จัดของเสร็จ"; B opens the bill, takes the cash and hands over (กำลังไปส่ง / เสร็จ) without any claim', async () => {
  await A.page.goto('/online-orders');
  await A.page.getByTestId('online-order-row').filter({ hasText: orders.short.orderNo }).click();
  const a = A.page.getByTestId('online-order-detail');
  await expect(a).toContainText(orders.short.orderNo);
  // keyboard: the button is reachable and pressed with Enter
  await a.getByRole('button', { name: 'จัดของเสร็จ' }).focus();
  await A.page.keyboard.press('Enter');
  await expect(A.page.getByTestId('claim-bar')).toContainText(`จัดโดย ${HOLDER}`);
  await expect(a).toContainText('จัดเสร็จ รอรับเงิน/รอส่ง');
  await expect(a.getByRole('button', { name: 'จัดของเสร็จ' })).toHaveCount(0);
  for (const size of SIZES) {
    await A.page.setViewportSize(size);
    expect(await horizontalOverflow(A.page)).toEqual([]);
    expect(await spacingIssues(A.page, 'main')).toEqual([]);
  }
  await A.page.setViewportSize({ width: 1366, height: 768 });
  if (OUT) save('online-orders-picked-1366x768.png', await A.page.screenshot());

  // B: held bills say who picked it; open, pay cash
  const page = B.page;
  await page.goto('/pos');
  await ensureShift(page);
  await page.getByRole('button', { name: /^บิลพัก/ }).click();
  const sheet = page.getByRole('dialog').filter({ hasText: 'ออเดอร์ออนไลน์ (LINE) รอชำระ' });
  const row = sheet.getByTestId('pos-online-order').filter({ hasText: orders.short.orderNo });
  await expect(row.getByTestId('picking-note')).toContainText(`จัดโดย ${HOLDER}`);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    expect(await horizontalOverflow(page)).toEqual([]);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  if (OUT) save('pos-held-bills-picked-1366x768.png', await page.screenshot());
  await row.getByRole('button', { name: 'เปิดบิล' }).click();
  await expect(page.getByTestId('pos-online-banner').getByTestId('picking-note')).toContainText(`จัดโดย ${HOLDER}`);
  await page.getByRole('button', { name: 'ชำระเงิน' }).last().click();
  const pay = page.getByRole('dialog').filter({ hasText: 'เลือกช่องทางการชำระเงิน' });
  await expect(pay).toContainText('1,617.50'); // 3 x 165.50 + 12 x 89.25 + ค่าส่ง 50
  await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
  const cash = page.getByRole('dialog').filter({ hasText: 'รับชำระด้วยเงินสด' });
  await page.keyboard.type('2000');
  await cash.getByRole('button', { name: /ยืนยันรับเงินสด/ }).click();
  await expect(page.getByRole('dialog').filter({ hasText: 'ชำระเงินสำเร็จ!' })).toBeVisible();
  const d = await api<{ status: string; posOrder: { totalAmount: number } | null; picked: { name: string } | null; claim: unknown }>('GET', `/online-shop/orders/${orders.short.id}`, adminToken);
  expect(d).toMatchObject({ status: 'READY', posOrder: { totalAmount: 1617.5 }, picked: { name: HOLDER }, claim: null });
  await page.getByRole('button', { name: 'ปิดหน้าต่าง (เริ่มออเดอร์ใหม่)' }).click();
  await expect(page.getByTestId('pos-online-banner')).toHaveCount(0); // the cart starts empty

  // B hands it over: delivery steps need no claim
  await page.goto('/online-orders');
  await page.getByTestId('online-order-row').filter({ hasText: orders.short.orderNo }).click();
  const b = page.getByTestId('online-order-detail');
  await expect(b).toContainText('รับเงินแล้ว');
  await b.getByRole('button', { name: 'กำลังไปส่ง' }).click();
  await expect(b.getByRole('button', { name: 'กำลังไปส่ง' })).toHaveCount(0);
  await expect(b.getByText('กำลังไปส่ง', { exact: true })).toBeVisible();
  await b.getByRole('button', { name: 'เสร็จแล้ว' }).click();
  await expect(b.getByRole('button', { name: 'เสร็จแล้ว' })).toHaveCount(0);
  await expect(b.getByText('เสร็จแล้ว', { exact: true })).toBeVisible();
  await expect(b.getByTestId('picked-note')).toContainText(`จัดโดย ${HOLDER}`);
});

test('plain browser: F8 prints the slip as a picture through the print preview', async () => {
  const page = B.page;
  await page.goto('/pos');
  await ensureShift(page);
  await scan(page, P.rebar.sku);
  await expectCartQty(page, P.rebar.sku, 1);
  await page.keyboard.press('F8');
  // the browser path renders the slip to a PNG (Thai drawn by the browser) inside a hidden print iframe
  const src = await expect
    .poll(
      () =>
        page.evaluate(() => {
          for (const f of Array.from(document.querySelectorAll('iframe'))) {
            const img = f.contentDocument?.querySelector('img');
            if (img?.src.startsWith('data:image/png')) return img.src;
          }
          return '';
        }),
      { timeout: 15_000 },
    )
    .not.toBe('')
    .then(() =>
      page.evaluate(() => {
        for (const f of Array.from(document.querySelectorAll('iframe'))) {
          const img = f.contentDocument?.querySelector('img');
          if (img?.src.startsWith('data:image/png')) return { src: img.src, title: f.contentDocument?.title || '', w: img.naturalWidth, h: img.naturalHeight };
        }
        return null;
      }),
    );
  expect(src).not.toBeNull();
  expect(src!.title).toContain('ใบจัดของ');
  expect(src!.w).toBeGreaterThanOrEqual(576);
  expect(src!.h).toBeGreaterThan(200);
  save('browser-print-preview-picture.png', Buffer.from(src!.src.split(',')[1], 'base64'));
  await page.getByRole('button', { name: 'ล้างตะกร้า' }).click();
});

test('long order (40 lines, long names): names wrap, everything fits the width and continues on the roll', async ({ browser }) => {
  await A.page.goto('/online-orders');
  await A.page.getByTestId('online-order-row').filter({ hasText: orders.long.orderNo }).click();
  const a = A.page.getByTestId('online-order-detail');
  await expect(a).toContainText(orders.long.orderNo);
  const job = await capturePrint(A.page, () => a.getByRole('button', { name: /^พิมพ์ใบจัดของ/ }).click());
  const r = await checkSlipJob(browser, job, 'online-long-40-lines');
  expect(r.lines).toContain('รวม 40 รายการ');
  expect(r.lines).toContain('รับเองที่ร้าน');
  expect(r.lines.join(' ')).not.toContain('ที่อยู่');
  expect(r.ticks).toBe(40);
  for (let i = 1; i <= 40; i++) expect(r.lines.join('\n')).toContain(`วัสดุรายการที่ ${i}`);
  // long names take several lines (wrapped, not cut); the slip is one long picture
  expect(Math.max(...r.nameHeights)).toBeGreaterThan(Math.min(...r.nameHeights) * 2.5);
  expect(r.cssHeight).toBeGreaterThan(40 * 25);
  await expect(A.page.getByTestId('claim-bar')).toContainText('คุณกำลังจัด'); // printing claimed it
});
