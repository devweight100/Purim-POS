import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, scan, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * Owner bug 2026-11-23: POS prices did not follow the selected member's price level (docs/pos-price-level.md).
 * Each reproduction path (a)-(j) checks the cart prices; on the old code (421fea7) every one of them fails
 * because the POS always sold at ราคา 1. Realistic data: products with ราคา 1-3, packs with and without their own
 * level prices, a product with only ราคา 3, a bundle, members at level 1 / 2 / 3.
 */
// not serial: each path stands alone (a failing path must not hide the others; a new worker seeds its own data)

const TAG = String(Date.now()).slice(-5);
const SHOTS = process.env.E2E_SHOT_DIR || '';
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

// ราคา 1 / 2 / 3; pack of 6 with its own ราคา 1 + 2 (ราคา 3 = 16 x 6 = 96); case of 24 without own prices
export const P = {
  dish: { name: `น้ำยาล้างจานสูตรมะนาวเข้มข้นพิเศษ ขวดใหญ่ 800 มล.-${TAG}`, barcode: `8851${TAG}0001`, pack: `8851${TAG}0006`, l: [20, 18, 16] },
  // only ราคา 1: every level sells at 50
  glue: { name: `กาวร้อนอเนกประสงค์ตราช้างหลอดเล็ก-${TAG}`, barcode: `8851${TAG}0002`, l: [50, 0, 0] },
  // no ราคา 1 / 2: everyone pays ราคา 3 (never 0)
  tape: { name: `เทปพันเกลียวท่อประปาม้วนยาวพิเศษ-${TAG}`, barcode: `8851${TAG}0003`, l: [0, 0, 30] },
  // no price at all
  noprice: { name: `สินค้ายังไม่ตั้งราคา ทดสอบระบบ-${TAG}`, barcode: `8851${TAG}0004`, l: [0, 0, 0] },
  bundle: { name: `ชุดทำความสะอาดครัวสุดคุ้ม (ชุดของขวัญ)-${TAG}`, barcode: `8851${TAG}0005`, l: [100, 90, 80] },
};
export const M = {
  l1: { name: `คุณสมชาย ลูกค้าปลีกประจำ-${TAG}`, phone: `081${TAG}01`, level: 1 },
  l2: { name: `ร้านวัสดุก่อสร้างเจริญรุ่งเรือง (ส่ง)-${TAG}`, phone: `081${TAG}02`, level: 2 },
  l3: { name: `หจก. ช่างประปาพัฒนาการ (ส่งพิเศษ)-${TAG}`, phone: `081${TAG}03`, level: 3 },
};

let adminToken = '';
/** a cashier with POS_SELL only (no discount right): no manual price for an unpriced product */
const SELLER = { username: `lvl${TAG}`, password: `Lvl#E2e${TAG}`, pin: String(3000 + (Number(TAG) % 6000)) };

async function ensureShift(page: Page) {
  const shiftDlg = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  await shiftDlg.or(page.getByRole('button', { name: 'ปิดกะ', exact: true })).first().waitFor();
  if (await shiftDlg.isVisible()) {
    await shiftDlg.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true }).fill('500');
    await shiftDlg.getByRole('button', { name: 'ตกลง' }).click();
    await expect(shiftDlg).toBeHidden();
  }
}

/** A logged-in POS with an empty cart (cashier by default). */
export async function posPage(browser: Browser, who: { username: string; password: string } = CASHIER) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  await uiLogin(page, who.username, who.password);
  await expect(page).toHaveURL(/\/pos/);
  await ensureShift(page);
  await page.evaluate(() => localStorage.removeItem('purim-pos-cart'));
  await reloadPos(page);
  return { ctx, page };
}

/** Reload the POS and wait until the catalogue has been loaded from the server. */
async function reloadPos(page: Page) {
  const loaded = page.waitForResponse((r) => {
    const u = new URL(r.url());
    return (u.pathname === '/api/products' || u.pathname === '/api/products/sync') && r.ok();
  }, { timeout: 30_000 });
  await page.reload();
  await loaded;
  await ensureShift(page);
  await page.waitForTimeout(300);
}

type Line = { name: string; unitName: string; quantity: number; price: number };
/** Cart lines as persisted by the POS: the price each line is charged at (manual price wins). */
async function lines(page: Page): Promise<Line[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('purim-pos-cart');
    const items = raw ? JSON.parse(raw).state.items : [];
    return items.map((i: { name: string; unitName: string; quantity: number; customPrice: number | null; originalPrice: number }) => ({
      name: i.name, unitName: i.unitName, quantity: i.quantity, price: i.customPrice ?? i.originalPrice,
    }));
  });
}
const priceOf = async (page: Page, name: string, factorUnit?: string) =>
  (await lines(page)).find((l) => l.name === name && (!factorUnit || l.unitName === factorUnit))?.price;
async function expectPrice(page: Page, name: string, price: number, unit?: string) {
  await expect.poll(() => priceOf(page, name, unit), { message: `${name} ${unit || ''}` }).toBe(price);
}

/** Pick a member in the member window (Ctrl+M, search, click the row). */
async function pickMember(page: Page, name: string, open: () => Promise<void> = () => page.keyboard.press('Control+m')) {
  await open();
  const dlg = page.getByRole('dialog').filter({ hasText: 'เลือกลูกค้า' });
  await expect(dlg).toBeVisible();
  await dlg.getByPlaceholder(/ค้นหาชื่อ/).fill(name.slice(-12));
  await dlg.getByText(name).first().click();
  await expect(dlg).toBeHidden();
}
async function clearMember(page: Page) {
  await page.keyboard.press('Control+m');
  const dlg = page.getByRole('dialog').filter({ hasText: 'เลือกลูกค้า' });
  await dlg.getByTestId('pos-walkin-btn-1').click();
  await expect(dlg).toBeHidden();
}

test.beforeAll(async () => {
  await apiLogin(CASHIER);
  adminToken = await apiLogin(ADMIN);
  const mk = async (p: { name: string; barcode: string; l: number[] }, extra: Record<string, unknown> = {}) => {
    const r = await api<{ id: string }>('POST', '/products', adminToken, {
      name: p.name, barcodes: [p.barcode], unit: 'ชิ้น', basePrice: p.l[0], priceLevel1: p.l[0], priceLevel2: p.l[1], priceLevel3: p.l[2],
      priceLevel4: 0, priceLevel5: 0, costPrice: 5, ...extra,
    });
    if (!extra.isBundle) await api('POST', '/inventory/adjust', adminToken, { productId: r.id, type: 'ADD', amount: 500, reason: 'ปรับยอดเริ่มต้น' });
    return r.id;
  };
  const dish = await mk(P.dish, {
    packagingUnits: [
      { name: 'แพ็ค', qtyPerPrev: 6, barcode: P.dish.pack, priceLevel1: 110, priceLevel2: 100 },
      { name: 'ลัง', qtyPerPrev: 4 },
    ],
  });
  const glue = await mk(P.glue);
  await mk(P.tape);
  await mk(P.noprice);
  await mk(P.bundle, { isBundle: true, bundleItems: [{ childProductId: dish, quantity: 1 }, { childProductId: glue, quantity: 1 }] });
  for (const m of Object.values(M)) await api('POST', '/customers', adminToken, { name: m.name, phone: m.phone, priceLevel: m.level });
  await api('POST', '/auth/register', adminToken, { username: SELLER.username, password: SELLER.password, fullName: 'แคชเชียร์ไม่มีสิทธิ์ลดราคา', role: 'CASHIER', pinCode: SELLER.pin, permissions: ['POS_SELL'] });
});

test('(a) member first, then scan: level 2 prices, fallback to ราคา 1, ราคา 3 when 1 / 2 are empty; paid bill at those prices', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  try {
    await pickMember(page, M.l2.name);
    await scan(page, P.dish.barcode);
    await scan(page, P.glue.barcode);
    await scan(page, P.tape.barcode);
    await expect.poll(async () => (await lines(page)).length).toBe(3);
    await page.waitForTimeout(400);
    await shot(page, 'cart-level2-member');
    await expectPrice(page, P.dish.name, 18);
    await expectPrice(page, P.glue.name, 50);
    await expectPrice(page, P.tape.name, 30);
    // pay: the server stores the level-2 prices
    await page.keyboard.press('F12');
    const pay = page.getByRole('dialog');
    await expect(pay).toContainText('฿98.00');
    await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
    await pay.getByRole('button', { name: '฿100', exact: true }).click();
    await pay.getByRole('button', { name: 'ยืนยันรับเงินสด' }).click();
    await expect(pay).toContainText('ชำระเงินสำเร็จ!');
    const orders = await api<{ data: { totalAmount: string | number; customer?: { name: string } | null }[] }>('GET', '/orders?limit=5', adminToken);
    expect(Number(orders.data.find((o) => o.customer?.name === M.l2.name)?.totalAmount)).toBe(98);
  } finally {
    await ctx.close();
  }
});

test('(b) items first, then the member: existing lines are re-priced', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  try {
    await scan(page, P.dish.barcode);
    await scan(page, P.glue.barcode);
    await expectPrice(page, P.dish.name, 20);
    await pickMember(page, M.l2.name);
    await expectPrice(page, P.dish.name, 18);
    await expectPrice(page, P.glue.name, 50);
  } finally {
    await ctx.close();
  }
});

test('(c) change member 2 -> 3, then clear the member: re-priced each time', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  try {
    await pickMember(page, M.l2.name);
    await scan(page, P.dish.barcode);
    await expectPrice(page, P.dish.name, 18);
    await pickMember(page, M.l3.name);
    await expectPrice(page, P.dish.name, 16);
    await clearMember(page);
    await expectPrice(page, P.dish.name, 20);
    await pickMember(page, M.l1.name);
    await expectPrice(page, P.dish.name, 20);
  } finally {
    await ctx.close();
  }
});

test('(d) scan a pack barcode: own pack level price; level without a pack price = base level x 6', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  try {
    await pickMember(page, M.l2.name);
    await scan(page, P.dish.pack);
    await expectPrice(page, P.dish.name, 100, 'แพ็ค');
    await pickMember(page, M.l3.name);
    await expectPrice(page, P.dish.name, 96, 'แพ็ค');
  } finally {
    await ctx.close();
  }
});

test('(e) quantity change rolls 7 pieces into 1 pack + 1 piece, both at level 2', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  try {
    await pickMember(page, M.l2.name);
    for (let i = 0; i < 7; i++) await scan(page, P.dish.barcode);
    await expect.poll(async () => (await lines(page)).length).toBe(2);
    await expectPrice(page, P.dish.name, 100, 'แพ็ค');
    await expectPrice(page, P.dish.name, 18, 'ชิ้น');
  } finally {
    await ctx.close();
  }
});

test('(f) held bill recall keeps the member level; clearing the member after recall re-prices', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  try {
    await pickMember(page, M.l2.name);
    await scan(page, P.dish.barcode);
    await expectPrice(page, P.dish.name, 18);
    await page.keyboard.press('F10'); // hold
    await expect.poll(async () => (await lines(page)).length).toBe(0);
    await page.keyboard.press('F10'); // held bills sheet
    await page.getByRole('dialog').getByRole('button', { name: /เรียกคืนบิลนี้/ }).first().click();
    await expectPrice(page, P.dish.name, 18);
    await scan(page, P.dish.barcode);
    await expect.poll(async () => (await lines(page))[0]?.quantity).toBe(2);
    await expectPrice(page, P.dish.name, 18);
    await clearMember(page);
    await expectPrice(page, P.dish.name, 20);
  } finally {
    await ctx.close();
  }
});

test('(g) after a reload with the customer list unreachable (offline / desktop app): the level stays', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  try {
    await pickMember(page, M.l2.name);
    await scan(page, P.dish.barcode);
    await expectPrice(page, P.dish.name, 18);
    // the customer list cannot be fetched after the reload (server unreachable for it)
    await page.route('**/api/customers**', (r) => r.abort());
    await reloadPos(page);
    await scan(page, P.glue.barcode);
    await scan(page, P.dish.barcode);
    await expect.poll(async () => (await lines(page)).find((l) => l.name === P.dish.name)?.quantity).toBe(2);
    await expectPrice(page, P.dish.name, 18);
  } finally {
    await ctx.close();
  }
});

test('(h) member made with the quick-create form at level 3: prices follow at once', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  try {
    await scan(page, P.dish.barcode);
    await page.keyboard.press('Control+m');
    const dlg = page.getByRole('dialog').filter({ hasText: 'เลือกลูกค้า' });
    await dlg.getByRole('button', { name: 'เพิ่มด่วน' }).click();
    await dlg.getByPlaceholder('เช่น คุณสมศรี / บริษัท ปุริม จำกัด').fill(`ช่างใหม่สมัครหน้าร้าน-${TAG}`);
    await dlg.getByPlaceholder('เช่น 081-999-8888').fill(`089${TAG}99`);
    await dlg.locator('select').selectOption('3');
    await dlg.getByRole('button', { name: /บันทึกและเลือกลูกค้า/ }).click();
    await expectPrice(page, P.dish.name, 16);
  } finally {
    await ctx.close();
  }
});

test('(i) bundle item at the member level', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  try {
    await pickMember(page, M.l2.name);
    await scan(page, P.bundle.barcode);
    await expectPrice(page, P.bundle.name, 90);
    await pickMember(page, M.l3.name);
    await expectPrice(page, P.bundle.name, 80);
  } finally {
    await ctx.close();
  }
});

test('(j) a manual price stays manual when the member changes', async ({ browser }) => {
  const { ctx, page } = await posPage(browser, ADMIN);
  try {
    await pickMember(page, M.l2.name);
    await scan(page, P.dish.barcode);
    await scan(page, P.glue.barcode);
    await expectPrice(page, P.dish.name, 18);
    // glue is the selected (last) row: F4 manual price 45
    await page.keyboard.press('F4');
    await page.keyboard.type('45');
    await page.keyboard.press('Enter');
    await expectPrice(page, P.glue.name, 45);
    await pickMember(page, M.l3.name);
    await expectPrice(page, P.glue.name, 45);
    await expectPrice(page, P.dish.name, 16);
  } finally {
    await ctx.close();
  }
});

// ───────────────────────── after the fix: what the cashier sees ─────────────────────────

/** Wait until the POS mirrored the store settings (ClientDbSync) with this value. */
async function waitSetting(page: Page, key: string, value: unknown) {
  await expect.poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem('pos_store_settings_v2') || '{}')[k], key), { timeout: 30_000 }).toEqual(value);
}

async function noOverflow(page: Page) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    // the settings page's receipt preview box scrolls sideways by design (80 mm slip / A4 at 50 %), unchanged here
    const issues = (await horizontalOverflow(page)).filter((x) => !x.startsWith('div.bg-slate-200/70'));
    expect(issues, `${size.width}x${size.height}`).toEqual([]);
  }
  await page.setViewportSize(SIZES[0]);
}

test('level indicator: "ราคา: ส่ง" next to the member, per line when a product falls back to another level', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  try {
    await pickMember(page, M.l2.name);
    await expect(page.getByTestId('pos-price-level')).toHaveText('ราคา: ส่ง');
    await scan(page, P.dish.barcode);
    await scan(page, P.glue.barcode);
    await scan(page, P.tape.barcode);
    await expectPrice(page, P.tape.name, 30);
    const row = (name: string) => page.locator('[data-line-key]').filter({ hasText: name });
    await expect(row(P.dish.name).getByTestId('pos-line-level')).toHaveCount(0);
    await expect(row(P.glue.name).getByTestId('pos-line-level')).toHaveText('ราคา: ปลีก');
    await expect(row(P.tape.name).getByTestId('pos-line-level')).toHaveText('ราคา: ส่งพิเศษ');
    // the product cards show the member's price too
    await page.getByPlaceholder(/ค้นหาชื่อสินค้า/).fill(P.dish.name.slice(-10));
    await expect(page.getByTestId('pos-product-card').filter({ hasText: P.dish.name }).first()).toContainText('฿18.00');
    await page.getByPlaceholder(/ค้นหาชื่อสินค้า/).fill('');
    await page.waitForTimeout(400);
    await shot(page, 'level-indicator');
    await noOverflow(page);
  } finally {
    await ctx.close();
  }
});

test('walk-in level from the customer area (no member): select on the cart, buttons in the member window (Ctrl+M)', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  try {
    await scan(page, P.dish.barcode);
    await expectPrice(page, P.dish.name, 20);
    const sel = page.getByTestId('pos-walkin-level');
    await expect(sel).toHaveValue('1');
    await sel.selectOption('2');
    await expectPrice(page, P.dish.name, 18);
    await shot(page, 'walkin-level-select');
    await page.keyboard.press('Control+m');
    const dlg = page.getByRole('dialog').filter({ hasText: 'เลือกลูกค้า' });
    await expect(dlg.getByTestId('pos-walkin-btn-2')).toBeVisible();
    await shot(page, 'walkin-level-member-window');
    await dlg.getByTestId('pos-walkin-btn-3').click();
    await expect(dlg).toBeHidden();
    await expectPrice(page, P.dish.name, 16);
    await expect(sel).toHaveValue('3');
    // paid at level 3: stored on the bill
    await page.keyboard.press('F12');
    const pay = page.getByRole('dialog');
    await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
    await pay.getByRole('button', { name: '฿20', exact: true }).click();
    await pay.getByRole('button', { name: 'ยืนยันรับเงินสด' }).click();
    await expect(pay).toContainText('ชำระเงินสำเร็จ!');
    const orders = await api<{ data: { totalAmount: string | number; priceLevel?: number | null }[] }>('GET', '/orders?limit=3', adminToken);
    expect(orders.data.some((o) => Number(o.totalAmount) === 16 && o.priceLevel === 3)).toBe(true);
  } finally {
    await ctx.close();
  }
});

test('0-price product: popup "สินค้านี้ยังไม่ได้ตั้งราคา", not added; a manager may type a manual price', async ({ browser }) => {
  const { ctx, page } = await posPage(browser, SELLER);
  try {
    await scan(page, P.noprice.barcode);
    const dlg = page.getByTestId('no-price-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('สินค้านี้ยังไม่ได้ตั้งราคา');
    await expect(dlg).toContainText(P.noprice.name);
    await expect(dlg.getByRole('button', { name: 'ใส่ราคาเอง' })).toHaveCount(0); // cashier without the discount right
    await shot(page, 'no-price-popup');
    await page.keyboard.press('Enter');
    await expect(dlg).toBeHidden();
    expect(await lines(page)).toEqual([]);
  } finally {
    await ctx.close();
  }
  const admin = await posPage(browser, ADMIN);
  try {
    await scan(admin.page, P.noprice.barcode);
    const dlg = admin.page.getByTestId('no-price-dialog');
    await expect(dlg.getByRole('button', { name: 'ใส่ราคาเอง' })).toBeFocused();
    await shot(admin.page, 'no-price-popup-manager');
    await admin.page.keyboard.press('Enter');
    await admin.page.locator('#manual-price-input').fill('25');
    await admin.page.keyboard.press('Enter');
    await expectPrice(admin.page, P.noprice.name, 25);
    await expect(admin.page.getByTestId('pos-line-manual')).toBeVisible();
  } finally {
    await admin.ctx.close();
  }
});

test('start-of-bill dialog (setting on): first scan waits; Enter / Escape = walk-in retail, Alt+2 = ราคาส่ง, member by search; off = no dialog', async ({ browser }) => {
  await api('PATCH', '/settings', adminToken, { posAskCustomerAtStart: true });
  const { ctx, page } = await posPage(browser);
  try {
    await waitSetting(page, 'posAskCustomerAtStart', true);
    const dlg = page.getByTestId('pos-start-dialog');
    // Enter on the empty search = ลูกค้าทั่วไป · ราคาปลีก; the scanned item goes in after the choice
    await scan(page, P.dish.barcode);
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText(P.dish.name);
    expect(await lines(page)).toEqual([]);
    await expect(page.locator('#pos-start-search')).toBeFocused();
    await expect(dlg.getByTestId('pos-start-level-1')).toContainText('ราคาปลีก');
    await expect(dlg.getByTestId('pos-start-level-2')).toContainText('ราคาส่ง');
    await expect(dlg.getByTestId('pos-start-level-3')).toContainText('ราคาส่งพิเศษ');
    await shot(page, 'start-dialog');
    await noOverflow(page);
    await page.keyboard.press('Enter');
    await expect(dlg).toBeHidden();
    await expectPrice(page, P.dish.name, 20);
    // the bill has started: no dialog for the next scans
    await scan(page, P.glue.barcode);
    await expect.poll(async () => (await lines(page)).length).toBe(2);
    await expect(dlg).toBeHidden();

    // new bill: Alt+2 = walk-in at ราคาส่ง
    await page.keyboard.press('Control+e');
    await expect.poll(async () => (await lines(page)).length).toBe(0);
    await scan(page, P.dish.barcode);
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Alt+2');
    await expect(dlg).toBeHidden();
    await expectPrice(page, P.dish.name, 18);
    await expect(page.getByTestId('pos-walkin-level')).toHaveValue('2');

    // new bill: member by search (type, Enter picks the first match)
    await page.keyboard.press('Control+e');
    await expect.poll(async () => (await lines(page)).length).toBe(0);
    await scan(page, P.dish.barcode);
    await expect(dlg).toBeVisible();
    // typed at a person's speed: 12 keys at 0 ms + Enter is a barcode scanner burst on the POS (docs/pos-keyboard-scan.md)
    await page.keyboard.type(M.l3.name.slice(-12), { delay: 60 });
    await expect(dlg.getByRole('option').first()).toContainText(M.l3.name);
    await shot(page, 'start-dialog-member-search');
    await page.keyboard.press('Enter');
    await expect(dlg).toBeHidden();
    await expectPrice(page, P.dish.name, 16);
    await expect(page.getByTestId('pos-price-level')).toHaveText('ราคา: ส่งพิเศษ');

    // new bill: Escape = walk-in retail too
    await page.keyboard.press('Control+e');
    await expect.poll(async () => (await lines(page)).length).toBe(0);
    await scan(page, P.dish.barcode);
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expectPrice(page, P.dish.name, 20);
    expect((await page.evaluate(() => JSON.parse(localStorage.getItem('purim-pos-cart') || '{}').state)).customerId).toBeNull();

    // setting off: the first scan goes straight in
    await api('PATCH', '/settings', adminToken, { posAskCustomerAtStart: false });
    await page.keyboard.press('Control+e');
    await reloadPos(page);
    await waitSetting(page, 'posAskCustomerAtStart', false);
    await scan(page, P.dish.barcode);
    await expectPrice(page, P.dish.name, 20);
    await expect(dlg).toBeHidden();
  } finally {
    await api('PATCH', '/settings', adminToken, { posAskCustomerAtStart: false });
    await ctx.close();
  }
});

test('setting under ตั้งค่า > การขายและใบเสร็จ', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  try {
    await uiLogin(page, ADMIN.username, ADMIN.password);
    await page.goto('/settings?tab=sales');
    const box = page.getByTestId('pos-ask-customer-at-start');
    await expect(box).not.toBeChecked();
    await box.scrollIntoViewIfNeeded();
    await expect(page.getByText('เลือกลูกค้าก่อนเริ่มบิลทุกครั้ง')).toBeVisible();
    await expect(page.getByTestId('walk-in-level-needs-discount')).toBeVisible();
    await shot(page, 'setting');
    await noOverflow(page);
  } finally {
    await ctx.close();
  }
});

test('list layout: member level and a walk-in level bar', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('pos_screen_mode', 'list_view'));
  try {
    await uiLogin(page, CASHIER.username, CASHIER.password);
    await ensureShift(page);
    await page.evaluate(() => localStorage.removeItem('purim-pos-cart'));
    await reloadPos(page);
    const openCustomers = () => page.getByTitle('เลือกลูกค้า / สมาชิก (Ctrl+M)').click();
    await pickMember(page, M.l2.name, openCustomers);
    await scan(page, P.dish.barcode);
    await scan(page, P.glue.barcode);
    await expectPrice(page, P.dish.name, 18);
    await expect(page.getByTestId('pos-price-level')).toHaveText('ราคา: ส่ง');
    await expect(page.getByTestId('pos-line-level')).toHaveText('ราคา: ปลีก');
    await page.waitForTimeout(400);
    await shot(page, 'list-layout-member');
    await noOverflow(page);
    await openCustomers();
    await page.getByRole('dialog').getByTestId('pos-walkin-btn-2').click();
    await expect(page.getByTestId('pos-walkin-level')).toHaveValue('2');
    await expectPrice(page, P.dish.name, 18);
    await page.waitForTimeout(400);
    await shot(page, 'list-layout-walkin-level');
    await noOverflow(page);
  } finally {
    await ctx.close();
  }
});
