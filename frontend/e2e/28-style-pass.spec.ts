import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow } from './layout';

/**
 * Style pass (docs/ui-style.md, owner 2026-11-22):
 * - one table style: header / body cells sampled on several pages must have the same computed font, colour, weight
 *   and padding (first / last column 16 px = the card edge, inner cells 12 px left = right); one page title style;
 * - no chips around plain values (category, quantity) in the products table;
 * - stock-card tab: its count is the number of movements and the list shows them (it used to say "(100)" over an
 *   empty list: the type filter started as 'ALL' but was compared with 'all');
 * - enable / disable: the ⋯ menu and the bulk bar offer only the action that applies;
 * - collapsed sidebar: a group icon opens its flyout on hover (100 ms), the flyout stays while the pointer moves
 *   into it (250 ms close delay), Escape closes it; click and keyboard still work.
 */
test.describe.configure({ mode: 'serial' });

const TAG = Date.now().toString(36).slice(-5);
const COLLAPSED_KEY = 'purim_sidebar_collapsed';
const ACTIVE = `สินค้าสไตล์ใช้งาน ${TAG}`;
const ACTIVE2 = `สินค้าสไตล์ใช้งานสอง ${TAG}`;
const INACTIVE = `สินค้าสไตล์ปิดอยู่ ${TAG}`;
let A = '';
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  A = await apiLogin(ADMIN);
  const cat = await api<{ id: string }>('POST', '/categories', A, { name: `หมวดสไตล์ ${TAG}` }).catch(() => null);
  for (const [k, name] of [['a', ACTIVE], ['b', ACTIVE2], ['c', INACTIVE]] as const) {
    const p = await api<{ id: string }>('POST', '/products', A, {
      name, basePrice: 125.5, priceLevel1: 125.5, priceLevel2: 120, priceLevel3: 118, priceLevel4: 115, priceLevel5: 110, unit: 'ชิ้น',
      ...(cat ? { categoryId: cat.id } : {}),
    });
    ids[k] = p.id;
    // a few movements for the stock card
    await api('POST', '/inventory/adjust', A, { productId: p.id, type: 'SET', amount: 40, reason: 'ยอดยกมา' });
    await api('POST', '/inventory/adjust', A, { productId: p.id, type: 'ADD', amount: 5, reason: 'รับเพิ่ม' });
  }
  await api('POST', '/products/set-active', A, { ids: [ids.c], isActive: false });
});

async function login(page: Page, collapsed = false) {
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

type CellStyle = { fontSize: string; fontWeight: string; color: string; textTransform: string; fontFamily: string; letterSpacing: string; pl: string; pr: string; bg?: string };

/** Computed style of the first table's header cell, its first / middle / last body cells, and the page title. */
function sample(page: Page) {
  return page.evaluate(() => {
    const table = document.querySelector('main table.tbl') as HTMLTableElement | null;
    if (!table) return null;
    const pick = (el: Element | null | undefined) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, textTransform: cs.textTransform, fontFamily: cs.fontFamily, letterSpacing: cs.letterSpacing, pl: cs.paddingLeft, pr: cs.paddingRight, bg: cs.backgroundColor };
    };
    const ths = Array.from(table.querySelectorAll(':scope > thead > tr > th')).filter((t) => (t as HTMLElement).offsetParent !== null && !t.classList.contains('cell-tight'));
    const row = Array.from(table.querySelectorAll(':scope > tbody > tr')).find((r) => r.children.length > 2 && !r.querySelector('.tbl-empty'));
    const tds = row ? Array.from(row.children).filter((t) => (t as HTMLElement).offsetParent !== null) : [];
    const middle = tds.slice(1, -1).find((t) => !t.classList.contains('cell-tight'));
    const title = document.querySelector('main h1');
    const rowBox = row?.getBoundingClientRect();
    return {
      th: pick(ths[1] ?? ths[0]),
      tdFirst: tds[0] ? { pl: getComputedStyle(tds[0]).paddingLeft } : null,
      tdLast: tds.length ? { pr: getComputedStyle(tds[tds.length - 1]).paddingRight } : null,
      td: pick(middle),
      rowHeight: rowBox ? Math.round(rowBox.height) : 0,
      title: title ? { cls: title.className, fontSize: getComputedStyle(title).fontSize, fontWeight: getComputedStyle(title).fontWeight } : null,
    };
  });
}

const PAGES = ['/products', '/orders', '/customers', '/debts', '/payables', '/purchase-orders', '/inventory', '/claims', '/shifts', '/supplier-returns', '/claim-inventory', '/users'];

test('one table style on every sampled page (header, body, padding, page title)', async ({ page }) => {
  await login(page);
  const seen: Record<string, NonNullable<Awaited<ReturnType<typeof sample>>>> = {};
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator('main table.tbl').first()).toBeVisible({ timeout: 20_000 });
    // wait for a data row when the page has data
    await page.locator('main table.tbl > tbody > tr').first().waitFor();
    await page.waitForTimeout(500);
    const s = await sample(page);
    expect(s, path).not.toBeNull();
    seen[path] = s!;
  }
  const want: Partial<CellStyle> = { fontSize: '13px', fontWeight: '500', color: 'rgb(100, 116, 139)', textTransform: 'none', letterSpacing: 'normal', bg: 'rgb(248, 250, 252)' };
  const ref = seen['/products'];
  for (const [path, s] of Object.entries(seen)) {
    // header cell
    expect({ path, ...pickKeys(s.th!, Object.keys(want)) }).toEqual({ path, ...want });
    expect({ path, font: s.th!.fontFamily }).toEqual({ path, font: ref.th!.fontFamily });
    // page title
    expect({ path, title: s.title }).toEqual({ path, title: { cls: 'page-title', fontSize: '22px', fontWeight: '600' } });
    // first / last column line up with the card edge (16 px)
    expect({ path, first: s.tdFirst, last: s.tdLast }).toEqual({ path, first: { pl: '16px' }, last: { pr: '16px' } });
    if (!s.td) continue; // a table without data rows on this database
    expect({ path, size: s.td.fontSize, font: s.td.fontFamily, transform: s.td.textTransform, pl: s.td.pl, pr: s.td.pr })
      .toEqual({ path, size: '14px', font: ref.th!.fontFamily, transform: 'none', pl: '12px', pr: '12px' });
    expect(s.rowHeight, path).toBeGreaterThanOrEqual(40);
  }
  expect(Object.keys(seen)).toHaveLength(PAGES.length);
});

function pickKeys(o: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}

test('products: category and quantity are plain text (no chip), money with 2 decimals', async ({ page }) => {
  await login(page);
  await page.goto('/products');
  await page.getByLabel(/^ค้นหาสินค้า/).fill(TAG);
  const row = page.locator('[data-testid="product-row"]').filter({ hasText: ACTIVE }).first();
  await expect(row).toBeVisible();
  const plain = async (testId: string) => row.getByTestId(testId).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius };
  });
  for (const id of ['product-category', 'product-qty']) {
    if (await row.getByTestId(id).count()) expect({ id, ...(await plain(id)) }).toEqual({ id, bg: 'rgba(0, 0, 0, 0)', border: '0px', radius: '0px' });
  }
  await expect(row.getByTestId('product-price-1')).toHaveText('฿125.50');
  await expect(row.getByTestId('product-price-2')).toHaveText('฿120.00');
});

test('stock-card tab: the count is the number of movements and the list shows them', async ({ page }) => {
  await login(page);
  await page.goto('/inventory');
  const tab = page.getByRole('button', { name: /ประวัติสต็อกการ์ด \(/ });
  await expect(tab).toBeVisible();
  const total = Number((await tab.innerText()).match(/\(([\d,]+)\)/)![1].replace(/,/g, ''));
  expect(total).toBeGreaterThanOrEqual(6);
  await tab.click();
  const rows = page.locator('main table.tbl > tbody > tr');
  await expect(page.getByTestId('movements-empty')).toHaveCount(0);
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBe(Math.min(total, 10));
  await expect(page.getByText(new RegExp(`จากทั้งหมด\\s*${total.toLocaleString()}\\s*รายการ`)).first()).toBeVisible();
  // a filter narrows the server list; the search finds this run's products (6 movements)
  await page.getByPlaceholder(/ค้นหาชื่อสินค้า, SKU/).fill(TAG);
  await expect(page.getByText(/จากทั้งหมด\s*6\s*รายการ/).first()).toBeVisible();
  await expect(rows).toHaveCount(6);
  await page.locator('select').filter({ hasText: 'ประเภทความเคลื่อนไหวทั้งหมด' }).selectOption('ADJUST_ADD');
  await expect(rows).toHaveCount(3);
  // the tab count stays the number of all movements
  await expect(tab).toHaveText(new RegExp(`\\(${total.toLocaleString()}\\)`));
  expect(await horizontalOverflow(page)).toEqual([]);
});

test('enable / disable: the ⋯ menu and the bulk bar show only the action that applies', async ({ page }) => {
  await login(page);
  await page.goto('/products');
  await page.getByTestId('product-status-filter').getByRole('button', { name: 'ทั้งหมด' }).click();
  await page.getByLabel(/^ค้นหาสินค้า/).fill(TAG);
  const rowOf = (name: string) => page.locator('[data-testid="product-row"]').filter({ hasText: name }).first();
  await expect(rowOf(INACTIVE)).toHaveAttribute('data-inactive', 'true');

  const menuItems = async (name: string) => {
    await rowOf(name).getByRole('button', { name: `จัดการสินค้า ${name}` }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const items = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    return items;
  };
  const active = await menuItems(ACTIVE);
  expect(active).toContain('ปิดการใช้งาน');
  expect(active).not.toContain('เปิดใช้งาน');
  const inactive = await menuItems(INACTIVE);
  expect(inactive).toContain('เปิดใช้งาน');
  expect(inactive).not.toContain('ปิดการใช้งาน');

  const check = (name: string) => rowOf(name).getByRole('checkbox').click();
  const enable = page.getByTestId('bulk-enable');
  const disable = page.getByTestId('bulk-disable');
  // all active -> ปิด only
  await check(ACTIVE);
  await check(ACTIVE2);
  await expect(disable).toBeVisible();
  await expect(enable).toHaveCount(0);
  // mixed -> both
  await check(INACTIVE);
  await expect(disable).toBeVisible();
  await expect(enable).toBeVisible();
  // all inactive -> เปิด only
  await check(ACTIVE);
  await check(ACTIVE2);
  await expect(enable).toBeVisible();
  await expect(disable).toHaveCount(0);
  await page.getByRole('button', { name: 'ยกเลิกเลือก' }).click();
});

test('collapsed sidebar: hover opens the group flyout after a short delay, the pointer can move into it, Escape closes', async ({ page }) => {
  await login(page, true);
  await page.goto('/products');
  const side = page.locator('#backoffice-sidebar');
  await expect(side).toHaveAttribute('data-collapsed', 'true');
  const group = side.getByTestId('rail-group-inventory');
  const flyout = page.getByTestId('sidebar-flyout');
  const box = (await group.boundingBox())!;

  // pointing at the icon opens its flyout without a click
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(flyout).toBeVisible();
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  // move across the gap into the flyout: it stays open
  const fb = (await flyout.boundingBox())!;
  await page.mouse.move(box.x + box.width + 4, box.y + box.height / 2, { steps: 2 });
  await page.mouse.move(fb.x + 20, fb.y + 20, { steps: 3 });
  await page.waitForTimeout(400);
  await expect(flyout).toBeVisible();
  // its links work
  await expect(flyout.getByRole('link', { name: 'คลังสินค้า & สต็อก' })).toBeVisible();
  // leaving both closes it after the delay
  await page.mouse.move(700, 400, { steps: 3 });
  await expect(flyout).toBeHidden();
  // passing over an icon quickly opens nothing
  const other = (await side.getByTestId('rail-group-sales').boundingBox())!;
  await page.mouse.move(other.x + other.width / 2, other.y + other.height / 2);
  await page.mouse.move(700, 400);
  await page.waitForTimeout(300);
  await expect(flyout).toBeHidden();
  // hover open + Escape closes
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(flyout).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(flyout).toBeHidden();
  // a click pins it: it stays when the pointer leaves, a click outside closes it
  await page.mouse.move(700, 400);
  await group.click();
  await expect(flyout).toBeVisible();
  await page.mouse.move(700, 400, { steps: 3 });
  await page.waitForTimeout(400);
  await expect(flyout).toBeVisible();
  await page.mouse.click(700, 400);
  await expect(flyout).toBeHidden();
  // keyboard still works: Enter opens with the focus on the first page, Escape closes and refocuses the icon
  await group.focus();
  await page.keyboard.press('Enter');
  await expect(flyout).toBeVisible();
  await expect(flyout.getByRole('link').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(flyout).toBeHidden();
  await expect(group).toBeFocused();
});
