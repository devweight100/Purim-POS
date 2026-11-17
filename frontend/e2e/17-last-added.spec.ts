import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, cartItems, scan, scannerInput, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Owner request: while ringing up a long bill, the cart line that was just added / changed is highlighted
 * (data-last-added), flashes on every scan (also the same item again), shows "+1" on its quantity, is scrolled
 * into view without taking the focus from the scanner input, and "ล่าสุด: ..." confirms it next to the total.
 * Both POS layouts (touch screen + list), reduced motion, layout at the owner's three window sizes.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
const COUNT = 25;
const items = Array.from({ length: COUNT }, (_, i) => ({
  name: `สินค้าสแกนทดสอบ ${String(i + 1).padStart(2, '0')}-${TAG}`,
  sku: `LA-${TAG}-${i + 1}`,
  barcode: `88591${TAG}${String(i + 1).padStart(3, '0')}`,
  price: 10 + i,
}));
const SHOTS = process.env.E2E_SHOT_DIR || '';

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

async function cashierPage(browser: Browser, opts: { reducedMotion?: 'reduce' | 'no-preference'; listView?: boolean } = {}) {
  const ctx = await browser.newContext({
    viewport: SIZES[0], locale: 'th-TH', timezoneId: 'Asia/Bangkok', reducedMotion: opts.reducedMotion ?? 'no-preference',
  });
  const page = await ctx.newPage();
  if (opts.listView) await page.addInitScript(() => localStorage.setItem('pos_screen_mode', 'list_view'));
  await uiLogin(page, CASHIER.username, CASHIER.password);
  await expect(page).toHaveURL(/\/pos/);
  await ensureShift(page);
  await page.evaluate(() => localStorage.removeItem('purim-pos-cart'));
  await page.reload();
  await ensureShift(page);
  return { ctx, page };
}

/** Scan every item once, as fast as the scanner helper types; all must register. Returns the time taken. */
async function scanAll(page: Page) {
  await expect(page.getByText(items[COUNT - 1].name).first().or(scannerInput(page))).toBeAttached();
  // one burst like a fast scanner: codes + Enter back to back, no waiting between scans
  await scannerInput(page).focus();
  const t0 = Date.now();
  await page.keyboard.type(items.map((it) => `${it.barcode}\n`).join(''), { delay: 5 });
  await expect.poll(async () => (await cartItems(page)).length, { timeout: 20_000 }).toBe(COUNT);
  return Date.now() - t0;
}

const lastRow = (page: Page) => page.locator('[data-last-added="true"]');

/** Rescan item #1 and check row 1 is the highlighted, visible, increased line and "ล่าสุด:" names it. */
async function rescanFirst(page: Page, rowId: string, expectedQty: number) {
  await scan(page, items[0].barcode);
  await expect(lastRow(page)).toHaveCount(1);
  await expect(lastRow(page)).toHaveAttribute('id', rowId);
  await expect(lastRow(page)).toContainText(items[0].name);
  await expect.poll(async () => (await cartItems(page)).find((i) => i.sku === items[0].sku)?.quantity).toBe(expectedQty);
  await expect(lastRow(page)).toBeInViewport({ ratio: 0.9 });
  const last = page.getByTestId('pos-last-added');
  await expect(last).toContainText(`ล่าสุด:`);
  await expect(last).toContainText(items[0].name);
  await expect(last).toContainText(`× ${expectedQty} ชิ้น`);
  await expect(last).toContainText('(รายการที่ 1)');
  await expect(lastRow(page).getByTestId('pos-qty-bump')).toHaveText('+1');
  // the keyboard focus stays on the scanner input
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.className || '')).toContain('sr-only');
}

test.beforeAll(async () => {
  await apiLogin(CASHIER);
  adminToken = await apiLogin(ADMIN);
  for (const it of items) {
    const r = await api<{ id: string }>('POST', '/products', adminToken, {
      name: it.name, sku: it.sku, barcodes: [it.barcode], unit: 'ชิ้น', basePrice: it.price, priceLevel1: it.price, costPrice: 1,
    });
    await api('POST', '/inventory/adjust', adminToken, { productId: r.id, type: 'ADD', amount: 200, reason: 'ปรับยอดเริ่มต้น' });
  }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
});

test('touch screen: 25 scans, then item #1 again -> row 1 highlighted, scrolled into view, +1, "ล่าสุด:"', async ({ browser }) => {
  const { ctx, page } = await cashierPage(browser);
  try {
    const ms = await scanAll(page);
    console.log(`[perf] touch screen: ${COUNT} scans registered in ${ms} ms`);
    await expect(lastRow(page)).toHaveAttribute('id', `classic-cart-item-${COUNT - 1}`);
    await expect(page.getByTestId('pos-last-added')).toContainText(`(รายการที่ ${COUNT})`);
    // row 1 is out of view at the bottom of a long bill
    await expect(page.locator('#classic-cart-item-0')).not.toBeInViewport();

    await rescanFirst(page, 'classic-cart-item-0', 2);
    // distinct from the selection (sky) and readable: emerald background + accent bar
    const bg = await lastRow(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    const bar = await lastRow(page).evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
    expect([bg, bar]).toEqual(['rgb(236, 253, 245)', 'rgb(5, 150, 105)']);
    await page.waitForTimeout(900);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'touch-1366x768-row1-highlighted.png') });

    // the same line scanned again flashes again and counts on
    await scan(page, items[0].barcode);
    // the flash (Web Animation on the row), not just a CSS transition
    expect(await lastRow(page).evaluate((el) => el.getAnimations().filter((x) => !(x instanceof CSSTransition)).length)).toBeGreaterThan(0);
    await expect(page.getByTestId('pos-last-added')).toContainText('× 3 ชิ้น');

    // + / - on another line moves the highlight there; removing it clears it
    const row5 = page.locator('#classic-cart-item-4');
    await row5.scrollIntoViewIfNeeded();
    await row5.getByRole('button', { name: `เพิ่มจำนวน ${items[4].name}` }).click();
    await expect(row5).toHaveAttribute('data-last-added', 'true');
    await expect(page.getByTestId('pos-last-added')).toContainText(`${items[4].name}`);
    await row5.getByTitle('ลบรายการนี้ (Del)').click();
    await expect(lastRow(page)).toHaveCount(0);
    await expect(page.getByTestId('pos-last-added')).toHaveCount(0);

    // layout with a highlighted long cart
    await scan(page, items[0].barcode);
    const problems: string[] = [];
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      for (const o of await horizontalOverflow(page)) problems.push(`${size.width}x${size.height} overflow: ${o}`);
      for (const s of await spacingIssues(page, '#pos-cart')) problems.push(`${size.width}x${size.height} spacing: ${s}`);
    }
    expect(problems).toEqual([]);
    await page.setViewportSize(SIZES[0]);

    // clearing the cart clears the highlight
    await page.getByRole('button', { name: 'ล้างตะกร้า' }).click();
    await expect(lastRow(page)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('list view: same flow, highlighted table row 1 and the "ล่าสุด:" strip', async ({ browser }) => {
  const { ctx, page } = await cashierPage(browser, { listView: true });
  try {
    await expect(page.locator('select[aria-label="รูปแบบหน้าจอขาย"]')).toHaveValue('list_view');
    const ms = await scanAll(page);
    console.log(`[perf] list view: ${COUNT} scans registered in ${ms} ms`);
    await expect(lastRow(page)).toHaveAttribute('id', `classic-list-cart-item-${COUNT - 1}`);
    await expect(page.locator('#classic-list-cart-item-0')).not.toBeInViewport();
    await rescanFirst(page, 'classic-list-cart-item-0', 2);
    await page.waitForTimeout(900);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'list-1366x768-row1-highlighted.png') });

    const problems: string[] = [];
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      // the list view's bottom shortcut bar scrolls sideways by design (overflow-x-auto) at 1093 px - unchanged here
      for (const o of await horizontalOverflow(page)) if (!o.startsWith('div.bg-white border-t border-slate-200 px-3')) problems.push(`${size.width}x${size.height} overflow: ${o}`);
    }
    expect(problems).toEqual([]);
    await page.setViewportSize(SIZES[0]);
    await page.keyboard.press('Control+e');
    await expect(lastRow(page)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('reduced motion: static highlight, no flash animation, instant scroll', async ({ browser }) => {
  const { ctx, page } = await cashierPage(browser, { reducedMotion: 'reduce' });
  try {
    await scanAll(page);
    await rescanFirst(page, 'classic-cart-item-0', 2);
    expect(await lastRow(page).evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
    expect(await lastRow(page).getByTestId('pos-qty-bump').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    const bg = await lastRow(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(236, 253, 245)');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'touch-1366x768-reduced-motion.png') });
    await page.getByRole('button', { name: 'ล้างตะกร้า' }).click();
  } finally {
    await ctx.close();
  }
});
