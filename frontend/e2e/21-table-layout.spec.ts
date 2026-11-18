import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * UI round 3 (owner 2026-11-18):
 * - products table: price levels are their own columns ("ราคา 1".."ราคา 5" with the shop's level names), at least
 *   ราคา 1-3 at 1366x768 / 1093x614 and 1-5 at 1920x1080, without sideways scroll, with the sidebar open or collapsed;
 * - the back-office sidebar collapses to an icon rail (button + Ctrl+B), remembered per device, keyboard usable;
 * - every back-office table page: no sideways scroll and 8 / 16 px spacing at the 3 sizes in both sidebar states.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-6);
const LONG = `ท่อพีวีซี ชั้น 8.5 ขนาด 1 นิ้ว ยาว 4 เมตร สีฟ้า ตราช้าง สำหรับงานประปาภายในและภายนอกอาคาร ${TAG}`;
const SUPPLIER = `บริษัท ไทยวัสดุภัณฑ์ อุตสาหกรรม (ประเทศไทย) จำกัด (มหาชน) สำนักงานใหญ่ ${TAG}`;
const CUSTOMER = `บริษัท ทรัพย์ทวีคูณ คอนสตรัคชั่น แอนด์ เอ็นจิเนียริ่ง จำกัด ${TAG}`;
const COLLAPSED_KEY = 'purim_sidebar_collapsed';

const TABLE_PAGES = [
  '/products', '/inventory', '/categories', '/claim-inventory',
  '/online-orders', '/orders', '/customers', '/debts', '/claims', '/shifts',
  '/purchase-orders', '/payables', '/supplier-returns', '/suppliers',
  '/reports/sales', '/reports/bestsellers', '/reports/inventory', '/reports/payments', '/reports/customers', '/reports/purchases',
  '/finance', '/accounts', '/approvals', '/users',
];

test.beforeAll(async () => {
  const token = await apiLogin(ADMIN);
  const cat = await api<{ id: string }>('POST', '/categories', token, { name: `วัสดุประปาและอุปกรณ์ท่อ ${TAG}` });
  const sup = await api<{ id: string }>('POST', '/suppliers', token, {
    name: SUPPLIER, contactName: 'คุณวิไลวรรณ ประเสริฐศักดิ์ (ฝ่ายขาย)', phone: '02-123-4567',
    email: `sales.department.${TAG}@thaiwasadu-industrial.co.th`, creditTerms: 30,
  });
  for (let i = 0; i < 3; i++) {
    await api('POST', '/products', token, {
      name: `${LONG} รุ่น ${i + 1}`, unit: 'เส้น', categoryId: cat.id, supplierId: sup.id, costPrice: 1234.5,
      basePrice: 1599 + i, priceLevel1: 1599 + i, priceLevel2: 1550 + i, priceLevel3: 1500 + i, priceLevel4: 1450 + i, priceLevel5: 1400 + i,
      barcodes: [1, 2, 3, 4].map((k) => `8857${k}${TAG}${i}`),
      packagingUnits: [{ name: 'มัด', qtyPerPrev: 10, barcode: `88578${TAG}${i}`, priceLevel1: 15000 }],
    });
  }
  await api('POST', '/customers', token, { name: CUSTOMER, phone: `08${TAG}11` });
});

async function login(page: Page, collapsed: boolean) {
  await page.addInitScript(([key, v]) => {
    try {
      if (!sessionStorage.getItem('e2e-sidebar-set')) {
        localStorage.setItem(key, v);
        sessionStorage.setItem('e2e-sidebar-set', '1');
      }
    } catch { /* ignore */ }
  }, [COLLAPSED_KEY, collapsed ? '1' : '0']);
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
}

const sidebar = (page: Page) => page.locator('#backoffice-sidebar');

for (const collapsed of [false, true]) {
  test(`products: price levels as columns, no sideways scroll (sidebar ${collapsed ? 'collapsed' : 'open'})`, async ({ page }) => {
    await login(page, collapsed);
    await page.goto('/products');
    await expect(sidebar(page)).toHaveAttribute('data-collapsed', String(collapsed));
    await page.getByLabel(/^ค้นหาสินค้า/).fill(TAG);
    const rows = page.locator('[data-row-nav]');
    await expect(rows).toHaveCount(3);
    const row = rows.filter({ hasText: `${LONG} รุ่น 1` });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      // 1920x1080 shows ราคา 1-5; 1366x768 and 1093x614 at least ราคา 1-3
      // (1093x614 with the sidebar collapsed has room for all 5, with it open for 1-3)
      const levels = size.width !== 1093 || collapsed ? [1, 2, 3, 4, 5] : [1, 2, 3];
      for (const n of levels) {
        const head = page.getByTestId(`price-head-${n}`);
        await expect(head, `${size.width} ราคา ${n}`).toBeVisible();
        await expect(head).toContainText(`ราคา ${n}`);
        await expect(row.getByTestId(`product-price-${n}`)).toBeVisible();
      }
      await expect(row.getByTestId('product-price-5')).toBeVisible({ visible: levels.length === 5 });
      // every price cell is inside the window
      const last = (await row.getByTestId(`product-price-${levels.length}`).boundingBox())!;
      expect(last.x + last.width).toBeLessThanOrEqual(size.width - 16);
      expect({ size, overflow: await horizontalOverflow(page) }).toEqual({ size, overflow: [] });
    }
    // values and the level names (online shop defaults: ราคาปลีก / ราคาส่ง / ราคาส่งพิเศษ) as subtitles
    await page.setViewportSize(SIZES[1]);
    await expect(row.getByTestId('product-price-1')).toContainText('1,599');
    await expect(row.getByTestId('product-price-5')).toContainText('1,400');
    await expect(page.getByTestId('price-head-1')).toContainText('ปลีก');
    await expect(page.getByTestId('price-head-2')).toContainText('ส่ง');
    // sort by ราคา 2 (desc puts รุ่น 3 first, asc รุ่น 1)
    const sort2 = page.getByTestId('price-head-2').getByRole('button');
    await sort2.click();
    await expect(rows.first()).toContainText(`${LONG} รุ่น 1`);
    await sort2.click();
    await expect(rows.first()).toContainText(`${LONG} รุ่น 3`);
    // narrow + open sidebar: "แสดงราคา 4–5" brings 4-5 in, still no sideways scroll
    await page.setViewportSize(SIZES[2]);
    await page.waitForTimeout(300);
    const force = page.getByText('แสดงราคา 4–5');
    if (await force.isVisible()) {
      await force.click();
      await expect(row.getByTestId('product-price-5')).toBeVisible();
      expect(await horizontalOverflow(page)).toEqual([]);
      await force.click();
    }
    // row keyboard pattern and the chevron still work
    await page.getByLabel(/^ค้นหาสินค้า/).press('ArrowDown');
    await expect(rows.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog').filter({ hasText: 'แก้ไขสินค้า' })).toBeVisible();
    await page.keyboard.press('Escape');
    await row.getByRole('button', { name: `แสดงขนาดบรรจุ ${LONG} รุ่น 1` }).click();
    await expect(page.locator('tr', { hasText: '× 10 เส้น' }).first()).toBeVisible(); // pack row (round 4: no barcode shown)
  });
}

test('sidebar: collapse / expand by button and Ctrl+B, remembered after reload, rail and flyout by keyboard', async ({ page }) => {
  await login(page, false);
  await page.goto('/orders');
  const side = sidebar(page);
  const main = page.locator('main');
  await expect(side).toHaveAttribute('data-collapsed', 'false');
  const wideLeft = (await main.boundingBox())!.x;
  expect(wideLeft).toBeGreaterThanOrEqual(239);

  // button (its tooltip names the shortcut)
  const toggle = side.getByTestId('sidebar-toggle');
  await expect(toggle).toHaveAttribute('aria-label', 'ย่อแถบเมนู (Ctrl+B)');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(side).toHaveAttribute('data-collapsed', 'true');
  expect((await side.boundingBox())!.width).toBeLessThanOrEqual(64);
  await expect.poll(async () => (await main.boundingBox())!.x).toBeLessThanOrEqual(64);
  expect(await page.evaluate((k) => localStorage.getItem(k), COLLAPSED_KEY)).toBe('1');

  // remembered after a reload
  await page.reload();
  await expect(side).toHaveAttribute('data-collapsed', 'true');
  await expect(side.getByTestId('rail-pos')).toBeVisible();

  // keyboard: every rail control is reachable with Tab and has a name
  const railNames = await side.locator('a[href], button').evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getAttribute('aria-label') || ''),
  );
  expect(railNames.every((n) => n.length > 0)).toBe(true);
  expect(railNames).toEqual(expect.arrayContaining(['หน้าขายหน้าร้าน (POS)', 'ค้นหาเอกสารทั้งหมด (F3)', 'ขยายแถบเมนู (Ctrl+B)', 'ภาพรวม & รายงาน', 'ออกจากระบบ']));
  await side.getByTestId('rail-group-overview').focus();
  await page.keyboard.press('Tab');
  await expect(side.getByTestId('rail-group-inventory')).toBeFocused();

  // a group opens its flyout (Enter), focus goes to the first page, ↓ moves, Escape closes and gives focus back
  const group = side.getByTestId('rail-group-sales');
  await group.focus();
  await page.keyboard.press('Enter');
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  const flyout = page.getByTestId('sidebar-flyout');
  await expect(flyout).toBeVisible();
  await expect(flyout.getByRole('link', { name: /ออเดอร์ออนไลน์/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(flyout.getByRole('link', { name: /ประวัติการขาย/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(flyout).toBeHidden();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(group).toBeFocused();
  // a click opens it too; a page in it navigates and closes the flyout
  await side.getByTestId('rail-group-inventory').click();
  await page.getByTestId('sidebar-flyout').getByRole('link', { name: 'คลังสินค้า & สต็อก' }).click();
  await expect(page).toHaveURL(/\/inventory/);
  await expect(page.getByTestId('sidebar-flyout')).toBeHidden();
  expect(await horizontalOverflow(page)).toEqual([]);

  // Ctrl+B expands (and collapses again)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+b');
  await expect(side).toHaveAttribute('data-collapsed', 'false');
  await expect(side.getByRole('button', { name: 'ภาพรวม & รายงาน' })).toBeVisible();
  await page.keyboard.press('Control+b');
  await expect(side).toHaveAttribute('data-collapsed', 'true');
  await page.keyboard.press('Control+b');
  await expect(side).toHaveAttribute('data-collapsed', 'false');
  expect(await page.evaluate((k) => localStorage.getItem(k), COLLAPSED_KEY)).toBe('0');
  await page.reload();
  await expect(side).toHaveAttribute('data-collapsed', 'false');

  // phones keep the drawer (no rail, Ctrl+B does nothing there)
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Toggle Menu' })).toBeVisible();
  await expect(side).toBeHidden();
});

for (const collapsed of [false, true]) {
  test(`table pages: no sideways scroll and button spacing at 3 sizes (sidebar ${collapsed ? 'collapsed' : 'open'})`, async ({ page }) => {
    test.setTimeout(300_000);
    await login(page, collapsed);
    const problems: string[] = [];
    for (const path of TABLE_PAGES) {
      await page.setViewportSize(SIZES[0]);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(sidebar(page)).toHaveAttribute('data-collapsed', String(collapsed));
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await page.waitForTimeout(250);
        for (const o of await horizontalOverflow(page)) problems.push(`${path} ${size.width}x${size.height} overflow: ${o}`);
        for (const s of await spacingIssues(page)) problems.push(`${path} ${size.width}x${size.height} spacing: ${s}`);
      }
    }
    expect(problems).toEqual([]);
  });
}
