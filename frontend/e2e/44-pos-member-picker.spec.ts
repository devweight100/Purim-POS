import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, scan, scannerInput, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Owner request 2026-11-27 (docs/pos-member-picker.md):
 * 1. the POS sales history (Ctrl+H) shows the member's name of a member bill (it showed "ลูกค้าทั่วไป");
 * 2. setting "เปิดหน้าเลือกสมาชิกรอไว้หลังรับชำระเงิน" (default off): after a sale the member picker waits; a member
 *    code typed / scanned picks the member, a product scanned closes it and goes to the cart, Esc = no member;
 * 3. the picker shows each member's address (one line, full text on hover), larger, no sideways scroll.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
const P = {
  cement: { name: `ปูนซีเมนต์ปอร์ตแลนด์ ตราเสือ 50 กก.-${TAG}`, barcode: `8858${TAG}01`, price: 165.5 },
  tape: { name: `เทปพันเกลียวท่อประปา-${TAG}`, barcode: `8858${TAG}02`, price: 25 },
};
const LONG_ADDRESS = `99/123 หมู่บ้านพฤกษาวิลล์ ซอยรามคำแหง 150 แขวงสะพานสูง เขตสะพานสูง กรุงเทพมหานคร 10240 (ส่งของหลังร้าน ติดต่อคุณแดงก่อนเข้า) ${TAG}`;
const M1 = { name: `ห้างหุ้นส่วนจำกัด ช่างสมชายวัสดุก่อสร้างและรับเหมาครบวงจร-${TAG}`, phone: `082${TAG}01`, code: `MB-${TAG}-1`, address: LONG_ADDRESS };
const M2 = { name: `คุณสมหญิง ใจดีมาก-${TAG}`, phone: `082${TAG}02`, code: `MB-${TAG}-2`, address: `45 ถ.มิตรภาพ ต.ในเมือง อ.เมืองนครราชสีมา-${TAG}` };
let admin = '';

const cart = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('purim-pos-cart');
    const st = raw ? JSON.parse(raw).state : {};
    return { items: (st.items || []) as { name: string; quantity: number }[], customerId: (st.customerId ?? null) as string | null, customerName: (st.customerName ?? null) as string | null };
  });
const picker = (page: Page) => page.getByTestId('pos-member-picker');
const pickerSearch = (page: Page) => picker(page).getByPlaceholder(/ค้นหาชื่อ/);

async function scannerBurst(page: Page, code: string) {
  await page.keyboard.type(code, { delay: 5 });
  await page.keyboard.press('Enter');
}

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

async function posPage(browser: Browser, setting: boolean) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  await uiLogin(page, CASHIER.username, CASHIER.password);
  await expect(page).toHaveURL(/\/pos/);
  await ensureShift(page);
  await page.evaluate(() => localStorage.removeItem('purim-pos-cart'));
  const loaded = page.waitForResponse((r) => ['/api/products', '/api/products/sync'].includes(new URL(r.url()).pathname) && r.ok(), { timeout: 30_000 });
  await page.reload();
  await loaded;
  await ensureShift(page);
  // the POS mirrors the shop settings from the server
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pos_store_settings_v2') || '{}').posPickMemberAfterSale === true))
    .toBe(setting);
  await page.waitForTimeout(300);
  return { ctx, page };
}

/** F12 -> เงินสด -> amount -> Enter, then Enter on the success screen (keyboard only) */
async function sellByKeyboard(page: Page, amount: string) {
  await page.keyboard.press('F12');
  const pay = page.getByRole('dialog').filter({ hasText: 'เลือกช่องทางการชำระเงิน' });
  await expect(pay).toBeVisible();
  await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).focus();
  await page.keyboard.press('Enter');
  const cash = page.locator('#pos-cash-received');
  await cash.fill(amount);
  await cash.press('Enter');
  const done = page.getByRole('dialog').filter({ hasText: 'ชำระเงินสำเร็จ!' });
  await expect(done).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(done).toBeHidden();
}

test.beforeAll(async () => {
  await apiLogin(CASHIER);
  admin = await apiLogin(ADMIN);
  for (const p of Object.values(P)) {
    const r = await api<{ id: string }>('POST', '/products', admin, {
      name: p.name, barcodes: [p.barcode], unit: 'ชิ้น', basePrice: p.price, priceLevel1: p.price, priceLevel2: p.price, priceLevel3: p.price,
      priceLevel4: 0, priceLevel5: 0, costPrice: Math.round(p.price * 0.7 * 100) / 100,
    });
    await api('POST', '/inventory/adjust', admin, { productId: r.id, type: 'ADD', amount: 500, reason: 'ปรับยอดเริ่มต้น' });
  }
  for (const m of [M1, M2]) await api('POST', '/customers', admin, { ...m, type: 'INDIVIDUAL', priceLevel: 1 });
  await api('PATCH', '/settings', admin, { posPickMemberAfterSale: false });
});

test.afterAll(async () => {
  await api('PATCH', '/settings', admin, { posPickMemberAfterSale: false }).catch(() => undefined);
});

test('history (Ctrl+H) shows the member of a member bill, walk-in otherwise; setting off: standby after the sale', async ({ browser }) => {
  const { ctx, page } = await posPage(browser, false);
  await scan(page, P.cement.barcode);
  await page.keyboard.press('Control+m');
  await pickerSearch(page).pressSequentially(M2.phone, { delay: 60 });
  await expect(picker(page).getByText(M2.name)).toBeVisible();
  await pickerSearch(page).press('Enter');
  await expect(picker(page)).toBeHidden();
  await expect.poll(async () => (await cart(page)).customerName).toBe(M2.name);
  await sellByKeyboard(page, '200');
  // setting off (default): no picker, back on the scan box
  await page.waitForTimeout(800);
  await expect(picker(page)).toBeHidden();
  await expect(scannerInput(page)).toBeFocused();
  // a walk-in bill
  await scannerBurst(page, P.tape.barcode);
  await expect.poll(async () => (await cart(page)).items.length).toBe(1);
  await sellByKeyboard(page, '25');
  await page.waitForTimeout(800);

  await page.keyboard.press('Control+h');
  const hist = page.getByRole('dialog').filter({ hasText: 'ประวัติการขาย' });
  await expect(hist).toBeVisible();
  const memberRow = hist.locator('tbody tr').filter({ hasText: M2.name });
  await expect(memberRow).toHaveCount(1);
  await expect(memberRow).toContainText(/฿165\.50/);
  await expect(hist.locator('tbody tr').filter({ hasText: '฿25.00' }).first()).toContainText('ลูกค้าทั่วไป');
  // search by the member's name finds the bill
  await hist.getByPlaceholder(/ค้นหาเลขที่บิล/).fill(M2.name.slice(0, 12));
  await expect(hist.locator('tbody tr').filter({ hasText: M2.name })).toHaveCount(1);
  // the item breakdown shows the member too
  await hist.locator('tbody tr').filter({ hasText: M2.name }).getByRole('button', { name: /รายการ/ }).first().click();
  await expect(page.getByRole('dialog').filter({ hasText: `ลูกค้า: ${M2.name}` })).toBeVisible();
  await ctx.close();
});

test('setting on: the member picker waits after each sale; typed member code picks; product scan closes it and goes to the cart; Esc = no member', async ({ browser }) => {
  await api('PATCH', '/settings', admin, { posPickMemberAfterSale: true });
  const { ctx, page } = await posPage(browser, true);

  // sale 1 -> picker opens with the focus in its search (also after the receipt print frame, ~1-2 s)
  await scannerBurst(page, P.tape.barcode);
  await expect.poll(async () => (await cart(page)).items.length).toBe(1);
  await sellByKeyboard(page, '25');
  await expect(picker(page)).toBeVisible();
  await expect(pickerSearch(page)).toBeFocused();
  await page.waitForTimeout(3500);
  await expect(picker(page)).toBeVisible();
  await expect(pickerSearch(page)).toBeFocused();
  // member code typed by a person + Enter: that member for the next bill, back on standby
  await pickerSearch(page).pressSequentially(M1.code, { delay: 60 });
  await expect(picker(page).locator('[data-customer-row]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(picker(page)).toBeHidden();
  await expect.poll(async () => (await cart(page)).customerName).toBe(M1.name);
  await expect(scannerInput(page)).toBeFocused();
  await scannerBurst(page, P.cement.barcode);
  await expect.poll(async () => (await cart(page)).items.length).toBe(1);
  await sellByKeyboard(page, '200');

  // sale 2 done -> picker; a product scanned there closes it, the product is in the cart, no member
  await expect(picker(page)).toBeVisible();
  await expect(pickerSearch(page)).toBeFocused();
  await pickerSearch(page).pressSequentially('สม', { delay: 80 });
  await page.waitForTimeout(200);
  await scannerBurst(page, P.cement.barcode);
  await expect(picker(page)).toBeHidden();
  await expect.poll(async () => (await cart(page)).items.map((i) => [i.name, i.quantity])).toEqual([[P.cement.name, 1]]);
  expect((await cart(page)).customerId).toBeNull();
  await expect(scannerInput(page)).toBeFocused();
  // the next scan goes in as usual
  await scannerBurst(page, P.cement.barcode);
  await expect.poll(async () => (await cart(page)).items[0]?.quantity).toBe(2);
  await sellByKeyboard(page, '400');

  // sale 3 done -> picker; a member code scanned (member card) picks the member
  await expect(picker(page)).toBeVisible();
  await page.waitForTimeout(300);
  await scannerBurst(page, M2.code);
  await expect(picker(page)).toBeHidden();
  await expect.poll(async () => (await cart(page)).customerName).toBe(M2.name);
  await expect.poll(async () => (await cart(page)).items.length).toBe(0);
  await scannerBurst(page, P.tape.barcode);
  await expect.poll(async () => (await cart(page)).items.length).toBe(1);
  await sellByKeyboard(page, '25');

  // sale 4 done -> picker; Esc = sell without a member, standby, scans go in
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeHidden();
  expect((await cart(page)).customerId).toBeNull();
  await expect(scannerInput(page)).toBeFocused();
  await scannerBurst(page, P.tape.barcode);
  await expect.poll(async () => (await cart(page)).items.length).toBe(1);

  // the picker opened with Ctrl+M keeps its behaviour: a product scan adds to the cart and the picker stays open
  await page.keyboard.press('Control+m');
  await expect(picker(page)).toBeVisible();
  await expect(pickerSearch(page)).toBeFocused();
  await page.waitForTimeout(200);
  await scannerBurst(page, P.tape.barcode);
  await expect.poll(async () => (await cart(page)).items[0]?.quantity).toBe(2);
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeHidden();
  await ctx.close();
  await api('PATCH', '/settings', admin, { posPickMemberAfterSale: false });
});

test('member picker: address on each row (one line, full text on hover), search by address, keys, fits every window size', async ({ browser }) => {
  const { ctx, page } = await posPage(browser, false);
  await page.keyboard.press('Control+m');
  await expect(picker(page)).toBeVisible();
  const row = picker(page).locator('[data-customer-row]').filter({ hasText: M1.name });
  await row.scrollIntoViewIfNeeded();
  const addr = row.getByTestId('pos-member-address');
  await expect(addr).toHaveAttribute('title', LONG_ADDRESS);
  await expect(addr).toContainText('หมู่บ้านพฤกษาวิลล์');
  await expect(row).toContainText(M1.phone);
  await expect(row).toContainText(M1.code);
  // one line: the long address is cut with an ellipsis, never wraps
  const oneLine = await addr.locator('span').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { ellipsis: cs.textOverflow === 'ellipsis', nowrap: cs.whiteSpace === 'nowrap', cut: el.scrollWidth > el.clientWidth };
  });
  expect(oneLine).toEqual({ ellipsis: true, nowrap: true, cut: true });

  // search by address
  await pickerSearch(page).pressSequentially(`มิตรภาพ ต.ในเมือง`, { delay: 40 });
  await expect(picker(page).locator('[data-customer-row]')).toHaveCount(1);
  await expect(picker(page).locator('[data-customer-row]')).toContainText(M2.name);
  await pickerSearch(page).fill('');

  for (const s of SIZES) {
    await page.setViewportSize(s);
    await page.waitForTimeout(300);
    expect(await horizontalOverflow(page), `${s.width}x${s.height}`).toEqual([]);
    expect(await spacingIssues(page, '[data-testid="pos-member-picker"]'), `${s.width}x${s.height}`).toEqual([]);
    const box = (await picker(page).boundingBox())!;
    expect(box.x, `${s.width}`).toBeGreaterThanOrEqual(16);
    expect(box.y, `${s.height}`).toBeGreaterThanOrEqual(15.5);
    expect(s.width - (box.x + box.width)).toBeGreaterThanOrEqual(16);
    expect(s.height - (box.y + box.height)).toBeGreaterThanOrEqual(15.5);
    // the list has room for several members
    const list = (await picker(page).getByTestId('pos-member-list').boundingBox())!;
    expect(list.height, `${s.width}x${s.height}`).toBeGreaterThan(200);
  }
  await page.setViewportSize({ width: 1366, height: 768 });

  // ↑ / ↓ + Enter
  await pickerSearch(page).pressSequentially(`-${TAG}`, { delay: 40 });
  await expect(picker(page).locator('[data-customer-row]')).toHaveCount(2);
  await page.keyboard.press('ArrowDown');
  await expect(picker(page).locator('[data-highlighted]')).toHaveAttribute('data-customer-row', '1');
  await page.keyboard.press('ArrowUp');
  await expect(picker(page).locator('[data-highlighted]')).toHaveAttribute('data-customer-row', '0');
  const first = (await picker(page).locator('[data-customer-row="0"] span.truncate').first().textContent())!.trim();
  await page.keyboard.press('Enter');
  await expect(picker(page)).toBeHidden();
  await expect.poll(async () => (await cart(page)).customerName).toBe(first);
  await ctx.close();
});
