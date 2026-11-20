import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * Round "start screen" follow-ups (docs/round-start-dashboard.md, owner 2026-11-20):
 * - back-office debt payment: no default shift, save disabled until a shift / "ไม่เข้ากะ" is picked; no card button;
 * - dashboard: no KPI cards repeating the banner, no + / - / = before the banner amounts;
 * - sidebar: accordion that fits 1366x768, remembered per device; stays in the window while a long page scrolls.
 * (The chooser for a POS-only cashier is in 26-start-dashboard.spec.ts.)
 */
test.describe.configure({ mode: 'serial' });

const TAG = Date.now().toString(36).slice(-5);
const CUSTOMER = { name: `ลูกค้ารับชำระเลือกกะ ${TAG}`, phone: `09${String(Date.now()).slice(-8)}` };
let A = '';
const s: Record<string, { id: string; shiftNumber?: string }> = {};

test.beforeAll(async () => {
  A = await apiLogin(ADMIN);
  const C = await apiLogin(CASHIER);
  const product = await api<{ id: string }>('POST', '/products', A, { name: `สินค้าเลือกกะ ${TAG}`, basePrice: 300, priceLevel1: 300, unit: 'ชิ้น' });
  s.customer = await api<{ id: string }>('POST', '/customers', A, CUSTOMER);
  s.shift = (await api<{ shift: { id: string; shiftNumber: string } }>('POST', '/shifts/open', C, { startingCash: 100, terminalId: `pw-rs2-${TAG}` })).shift;
  await api('POST', '/orders/checkout', C, {
    clientOrderId: randomUUID(), shiftId: s.shift.id, customerId: s.customer.id,
    items: [{ productId: product.id, quantity: 3, unitPrice: 300 }], payments: [{ method: 'CREDIT_DEBT', amount: 900 }],
  });
});

test.afterAll(async () => {
  if (s.shift) {
    const sum = await api<{ expectedCash: number }>('GET', `/shifts/${s.shift.id}/summary`, A).catch(() => null);
    if (sum) await api('POST', `/shifts/${s.shift.id}/close`, A, { actualCash: sum.expectedCash }).catch(() => undefined);
  }
});

test('back-office debt payment: no default shift, save disabled until chosen (keyboard), saves with ไม่เข้ากะ and with a shift; no card', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await page.goto(`/debts?customerId=${s.customer.id}&customerName=${encodeURIComponent(CUSTOMER.name)}`);
  const openPay = async () => {
    await page.getByRole('button', { name: 'รับชำระ' }).first().click();
    const dlg = page.getByRole('dialog').filter({ has: page.getByTestId('pay-debt-shift') });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('pay-debt-shift').locator('option', { hasText: s.shift.shiftNumber! })).toHaveCount(1);
    return dlg;
  };
  const closeReceipt = async () => {
    const receipt = page.getByRole('dialog').filter({ hasText: 'ใบเสร็จรับเงินชำระหนี้' });
    await expect(receipt).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(receipt).toBeHidden();
  };

  let dlg = await openPay();
  const picker = dlg.getByTestId('pay-debt-shift');
  const save = dlg.getByRole('button', { name: /ยืนยันรับชำระ/ });
  // no default: nothing picked, saving disabled with a hint
  await expect(picker).toHaveValue('');
  await expect(save).toBeDisabled();
  await expect(dlg.getByTestId('pay-debt-save-hint')).toContainText('เลือกกะที่รับเงิน');
  // the server takes cash / QR / transfer only: no card button
  await expect(dlg.getByRole('button', { name: 'เงินสด' })).toBeVisible();
  await expect(dlg.getByRole('button', { name: /บัตรเครดิต/ })).toHaveCount(0);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    expect(await horizontalOverflow(page), `pay dialog ${size.width}x${size.height}`).toEqual([]);
  }
  await page.setViewportSize(SIZES[0]);

  // keyboard: the hint label focuses the picker; arrows pick "ไม่เข้ากะแคชเชียร์" (the last option)
  await dlg.getByTestId('pay-debt-save-hint').click();
  await expect(picker).toBeFocused();
  await picker.selectOption('NONE');
  await expect(save).toBeEnabled();
  await expect(dlg.getByTestId('pay-debt-save-hint')).toHaveCount(0);
  await dlg.getByRole('button', { name: /แบ่งชำระ/ }).click();
  await dlg.locator('input[type=number]').fill('100');
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  await closeReceipt();

  // reopening starts without a choice again; a picked shift saves into that shift
  dlg = await openPay();
  await expect(dlg.getByTestId('pay-debt-shift')).toHaveValue('');
  await expect(dlg.getByRole('button', { name: /ยืนยันรับชำระ/ })).toBeDisabled();
  await dlg.getByTestId('pay-debt-shift').selectOption(s.shift.id);
  await dlg.getByRole('button', { name: /แบ่งชำระ/ }).click();
  await dlg.locator('input[type=number]').fill('50');
  await dlg.getByRole('button', { name: /ยืนยันรับชำระ/ }).click();
  await expect(dlg).toBeHidden();
  await closeReceipt();

  const debts = await api<{ data: { payments: { amount: string; shiftId: string | null }[] }[] }>('GET', `/debts?customerId=${s.customer.id}`, A);
  expect(debts.data[0].payments.map((p) => [Number(p.amount), p.shiftId])).toEqual(expect.arrayContaining([[100, null], [50, s.shift.id]]));
});

test('dashboard: no KPI cards that repeat the banner, no + / - / = before the banner amounts', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await page.goto('/dashboard');
  const cards = page.getByTestId('kpi-cards');
  await expect(cards.getByTestId('credit-card')).toBeVisible();
  await expect(cards).toContainText('ออเดอร์สำเร็จ');
  await expect(cards).not.toContainText('รายได้สุทธิ');
  await expect(cards).not.toContainText('คืนเงิน');
  // each label once on the page (banner only)
  await expect(page.getByText('รายได้สุทธิ (Net Sales)')).toHaveCount(0);
  await expect(page.getByText('คืนเงิน & ยกเลิกบิล', { exact: true })).toHaveCount(0);
  // the 2 cards fill the row
  const boxes = await cards.locator(':scope > *').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(boxes).toHaveLength(2);
  const rowWidth = (await cards.boundingBox())!.width;
  expect(boxes[0] + boxes[1]).toBeGreaterThan(rowWidth - 24);
  // banner amounts: "฿46,729", not "+฿..." / "-฿..." / "=฿..."
  const amounts = await page.locator('.font-mono.text-xl').allTextContents();
  expect(amounts).toHaveLength(3);
  for (const a of amounts) expect(a.trim()).toMatch(/^฿/);
  await expect(page.getByText(/[+=−-]฿/)).toHaveCount(0);
});

/** Group header buttons of the desktop sidebar. */
const groupHeads = (page: Page) => page.locator('#backoffice-sidebar button[aria-controls^="nav-group-"]');

test('sidebar: accordion fits 1366x768 (all groups visible, current group open), opened groups remembered; scroll hint at 1093x614', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await page.evaluate(() => { localStorage.removeItem('purim_sidebar_groups'); localStorage.setItem('purim_sidebar_collapsed', '0'); });
  await page.goto('/debts');
  const side = page.locator('#backoffice-sidebar');
  const panel = page.getByTestId('sidebar-panel');
  const nav = panel.getByTestId('sidebar-nav');
  await expect(groupHeads(page)).toHaveCount(6);
  // only the current page's group is open
  expect(await groupHeads(page).evaluateAll((els) => els.map((e) => [e.textContent?.trim(), e.getAttribute('aria-expanded')]))).toEqual([
    ['ภาพรวม & รายงาน', 'false'], ['สินค้า & คลังสินค้า', 'false'], ['งานขาย & ลูกค้า', 'true'],
    ['จัดซื้อ & ผู้จำหน่าย', 'false'], ['การเงิน', 'false'], ['ตั้งค่า & ระบบ', 'false'],
  ]);
  await expect(side.getByRole('link', { name: 'ลูกหนี้ & ค้างชำระ' })).toHaveAttribute('aria-current', 'page');
  // everything fits: no menu scrolling, every header inside the panel, user box + logout at the bottom
  expect(await nav.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('sidebar-scroll-hint')).toHaveCount(0);
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.height).toBe(768);
  for (const h of await groupHeads(page).all()) {
    const b = (await h.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(panelBox.height - 100);
  }
  const logout = side.getByRole('button', { name: 'ออกจากระบบ' });
  expect((await logout.boundingBox())!.y + (await logout.boundingBox())!.height).toBeGreaterThan(768 - 40);

  // open another group: remembered on this device (reload, another page)
  await side.getByRole('button', { name: 'การเงิน' }).click();
  await expect(side.getByRole('link', { name: /บัญชีธนาคาร/ })).toBeVisible();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('purim_sidebar_groups'))) || '{}')).toEqual({ finance: true });
  await page.goto('/products');
  await expect(side.getByRole('button', { name: 'การเงิน' })).toHaveAttribute('aria-expanded', 'true');
  await expect(side.getByRole('button', { name: 'สินค้า & คลังสินค้า' })).toHaveAttribute('aria-expanded', 'true'); // current page
  await expect(side.getByRole('button', { name: 'งานขาย & ลูกค้า' })).toHaveAttribute('aria-expanded', 'false');
  // closing is remembered too
  await side.getByRole('button', { name: 'การเงิน' }).click();
  await page.reload();
  await expect(side.getByRole('button', { name: 'การเงิน' })).toHaveAttribute('aria-expanded', 'false');

  // keyboard: a header opens with Enter, its links are reachable by Tab
  const overview = side.getByRole('button', { name: 'ภาพรวม & รายงาน' });
  await overview.focus();
  await page.keyboard.press('Enter');
  await expect(overview).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(side.getByRole('link', { name: 'แดชบอร์ดสรุปภาพรวม' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard$/);

  // 1093x614 with the long reports group open: the menu scrolls, a hint shows, the current page is in view
  await page.setViewportSize({ width: 1093, height: 614 });
  await page.goto('/reports/purchases');
  const active = side.getByRole('link', { name: 'ยอดจัดซื้อ & สถิติของเคลม' });
  await expect(active).toHaveAttribute('aria-current', 'page');
  await expect(active).toBeInViewport();
  const overflow = await nav.evaluate((el) => el.scrollHeight - el.clientHeight);
  if (overflow > 1) {
    await nav.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
    await expect(page.getByTestId('sidebar-scroll-hint')).toBeVisible();
    await nav.evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
    await expect(page.getByTestId('sidebar-scroll-hint')).toHaveCount(0);
  }
  await expect(side.getByRole('button', { name: 'ออกจากระบบ' })).toBeInViewport();
  for (const collapsed of ['0', '1']) {
    await page.evaluate((v) => localStorage.setItem('purim_sidebar_collapsed', v), collapsed);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/dashboard');
      await expect(side).toHaveAttribute('data-collapsed', collapsed === '1' ? 'true' : 'false');
      expect(await horizontalOverflow(page), `dashboard ${size.width}x${size.height} collapsed=${collapsed}`).toEqual([]);
    }
  }
  await page.evaluate(() => { localStorage.setItem('purim_sidebar_collapsed', '0'); localStorage.removeItem('purim_sidebar_groups'); });
  await page.setViewportSize(SIZES[0]);
});

test('sidebar stays in the window, full height, while a long page scrolls (open and rail)', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await page.evaluate(() => localStorage.setItem('purim_sidebar_collapsed', '0'));
  await page.goto('/dashboard');
  const side = page.locator('#backoffice-sidebar');
  const panel = page.getByTestId('sidebar-panel');
  await expect(side.getByRole('button', { name: 'ภาพรวม & รายงาน' })).toBeVisible();
  for (const collapsed of [false, true]) {
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(pageHeight).toBeGreaterThan(768 + 200); // a long page
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    const box = (await panel.boundingBox())!;
    expect(box.y).toBe(0);
    expect(box.height).toBe(768);
    // the column (background + border) runs down the whole page: nothing empty beside the content
    const col = await side.evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.abs(col - pageHeight)).toBeLessThanOrEqual(2);
    await expect(collapsed ? side.getByTestId('rail-pos') : side.getByRole('button', { name: 'ออกจากระบบ' })).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 0));
    if (!collapsed) {
      await page.keyboard.press('Control+b');
      await expect(side).toHaveAttribute('data-collapsed', 'true');
    }
  }
  await page.keyboard.press('Control+b');
  await expect(side).toHaveAttribute('data-collapsed', 'false');
});
