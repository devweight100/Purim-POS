import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, scan, uiLogin } from './helpers';

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
async function pickMember(page: Page, name: string) {
  await page.keyboard.press('Control+m');
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
    const pay = page.getByRole('dialog').filter({ hasText: 'ชำระเงิน' });
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
    await page.getByRole('dialog').getByText(M.l2.name).first().click();
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
