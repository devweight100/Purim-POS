import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Online shop opened from LINE (docs/online-shop.md), test profile (LINE not configured, LAN): a customer on a
 * phone (390x844) browses, searches, picks a unit, fills the cart and orders with delivery; the order appears in
 * the back office (badge), staff set the delivery fee and accept; the cashier opens it from the POS held bills and
 * takes cash; the customer sees it paid. Back-office page checked at the owner's 3 window sizes.
 * SHOP_SHOT_DIR=<dir> saves screenshots.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
const CAT = `วัสดุออนไลน์ ${TAG}`;
const CEMENT = `ปูนออนไลน์ ${TAG}`;
const SAND = `ทรายออนไลน์หมด ${TAG}`;
const shots = process.env.SHOP_SHOT_DIR;
const shot = async (page: Page, name: string, fullPage = true) => {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name), fullPage });
};

let adminToken = '';
const state: { orderId?: string; orderNo?: string } = {};
let phone: Page;

/** Customer UI rules: no sideways scroll, readable text, big tap targets. */
async function mobileOk(page: Page) {
  expect(await horizontalOverflow(page)).toEqual([]);
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('main button, main a, main input, main [role="radio"], header a, header button'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        // a radio inside a big label: the whole label is the tap target
        const inLabel = el instanceof HTMLInputElement && el.type === 'radio' && (el.closest('label')?.getBoundingClientRect().height ?? 0) >= 48;
        return r.width > 0 && r.height > 0 && el.offsetParent !== null && !el.closest('p') && !inLabel;
      })
      .filter((el) => el.getBoundingClientRect().height < 47.5)
      .map((el) => `${(el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 20)} ${Math.round(el.getBoundingClientRect().height)}px`),
  );
  expect(small).toEqual([]);
  const body = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.shop-root')!).fontSize));
  expect(body).toBeGreaterThanOrEqual(18);
}

async function phonePage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  return ctx.newPage();
}

test.beforeAll(async ({ browser }) => {
  await apiLogin(CASHIER);
  adminToken = await apiLogin(ADMIN);
  const cat = await api<{ id: string }>('POST', '/categories', adminToken, { name: CAT });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const cement = await api<{ id: string }>('POST', '/products', adminToken, {
    name: CEMENT, categoryId: cat.id, unit: 'ถุง', basePrice: 150, priceLevel1: 150, priceLevel3: 140, costPrice: 100,
    packagingUnits: [{ name: 'แพค', qtyPerPrev: 10, priceLevel1: 1450 }],
    images: [{ dataUrl: `data:image/png;base64,${png}`, thumbDataUrl: `data:image/png;base64,${png}`, name: 'c.png', isCover: true }],
  });
  await api('POST', '/inventory/adjust', adminToken, { productId: cement.id, type: 'ADD', amount: 40, reason: 'ปรับยอดเริ่มต้น' });
  await api('POST', '/products', adminToken, { name: SAND, categoryId: cat.id, unit: 'ถุง', basePrice: 40, priceLevel1: 40 });
  await api('PUT', '/online-shop/config', adminToken, { enabled: true, notice: 'สั่งก่อนบ่ายสามโมง ส่งภายในวัน' });
  phone = await phonePage(browser);
});

test('customer (phone, test profile): browse a category, search, choose the pack unit, cart, order with delivery', async () => {
  const page = phone;
  await page.goto('/shop');
  await expect(page.getByText('โหมดทดสอบ')).toBeVisible();
  await expect(page.getByText('สั่งก่อนบ่ายสามโมง ส่งภายในวัน')).toBeVisible();
  await mobileOk(page);
  await shot(page, 'm-01-home.png');

  // category tile -> both products; the out-of-stock one cannot be added
  await page.getByTestId('shop-category').filter({ hasText: CAT }).click();
  await expect(page.getByRole('heading', { name: new RegExp(CAT) })).toBeVisible();
  const sand = page.getByTestId('shop-product').filter({ hasText: SAND });
  await expect(sand).toContainText('หมด');
  await expect(sand.getByRole('button', { name: 'ใส่ตะกร้า' })).toHaveCount(0);
  await mobileOk(page);

  // search, pick the pack (฿1,450), quantity 2, add
  await page.getByLabel('ค้นหาสินค้า').fill(`ปูนออนไลน์ ${TAG}`);
  await page.getByRole('button', { name: 'ค้นหา' }).click();
  const card = page.getByTestId('shop-product').filter({ hasText: CEMENT });
  await expect(card).toContainText('มีของ');
  await expect(card).toContainText('฿150');
  await card.getByRole('radio', { name: /แพค/ }).click();
  await expect(card).toContainText('฿1,450');
  await card.getByRole('button', { name: 'เพิ่มจำนวน' }).click();
  await card.getByRole('button', { name: 'ใส่ตะกร้า' }).click();
  await expect(card.getByRole('button', { name: '✓ ใส่แล้ว' })).toBeVisible();
  // one more bag (base unit)
  await card.getByRole('radio', { name: /ถุง/ }).click();
  await card.getByRole('button', { name: 'ใส่ตะกร้า' }).click();
  await expect(page.getByTestId('shop-cart-bar')).toContainText('2 รายการ');
  await expect(page.getByTestId('shop-cart-bar')).toContainText('฿3,050');
  await mobileOk(page);
  await shot(page, 'm-02-products.png', false);

  // cart: change quantity, totals from the server
  await page.getByTestId('shop-cart-bar').click();
  await expect(page.getByTestId('shop-cart-line')).toHaveCount(2);
  const bag = page.getByTestId('shop-cart-line').filter({ hasText: 'ถุง' });
  await bag.getByRole('button', { name: 'เพิ่มจำนวน' }).click();
  await expect(page.getByTestId('shop-cart-subtotal')).toHaveText('฿3,200.00');
  await expect(page.getByText('ร้านจะแจ้ง')).toBeVisible();
  await mobileOk(page);
  await shot(page, 'm-03-cart.png');

  // checkout: delivery, contact, note
  await page.getByRole('link', { name: 'สั่งซื้อ' }).click();
  await expect(page.getByText('รับของอย่างไร')).toBeVisible();
  await page.getByText('ให้ร้านไปส่ง', { exact: true }).click();
  await expect(page.getByRole('radio', { name: /ให้ร้านไปส่ง/ })).toBeChecked();
  await page.getByLabel('ชื่อผู้สั่ง').fill('คุณสมใจ ทดสอบ');
  await page.getByLabel('เบอร์โทร').fill('081-222-3333');
  await page.getByLabel('ที่อยู่ส่งของ').fill('12/3 หมู่ 4 ต.ทดสอบ');
  await page.getByLabel('หมายเหตุถึงร้าน (ถ้ามี)').fill('ส่งช่วงบ่าย');
  await expect(page.getByTestId('shop-checkout-fee')).toHaveText('ร้านจะแจ้ง');
  await expect(page.getByTestId('shop-checkout-total')).toHaveText('฿3,200.00 + ค่าส่ง');
  await mobileOk(page);
  await shot(page, 'm-04-checkout.png');
  await page.getByRole('button', { name: 'ยืนยันสั่งซื้อ' }).click();

  await expect(page.getByText('ส่งออเดอร์แล้ว ✓')).toBeVisible();
  state.orderNo = (await page.getByTestId('shop-order-no').textContent())!.trim();
  expect(state.orderNo).toMatch(/^WB\d{4}-\d{4}$/); // round 4 document number
  state.orderId = page.url().split('/shop/orders/')[1].split('?')[0];
  await expect(page.getByTestId('shop-order-total')).toHaveText('฿3,200.00 + ค่าส่ง');
  await mobileOk(page);
  await shot(page, 'm-05-confirmed.png');

  // remembered for next time
  await page.goto('/shop/checkout');
  await expect(page.getByText('ตะกร้ายังว่าง')).toBeVisible();
  await page.goto('/shop/orders');
  await expect(page.getByTestId('shop-order').filter({ hasText: state.orderNo })).toContainText('ใหม่');
});

test('back office: badge, order detail, delivery fee, accept; the page fits 3 window sizes and works by keyboard', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
  await page.goto('/online-orders');
  await expect(page.locator('[data-testid="online-orders-badge"]:visible')).toHaveCount(1);
  const row = page.getByTestId('online-order-row').filter({ hasText: state.orderNo! });
  await expect(row).toContainText('ใหม่');
  // keyboard: focus the row, Enter opens it
  await row.focus();
  await page.keyboard.press('Enter');
  const detail = page.getByTestId('online-order-detail');
  await expect(detail).toContainText(state.orderNo!);
  await expect(detail).toContainText('ส่งช่วงบ่าย');
  await expect(detail).toContainText('ให้ร้านไปส่ง');
  for (const size of SIZES) {
    await page.setViewportSize(size);
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await spacingIssues(page, '[data-testid="online-order-detail"]')).toEqual([]);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await shot(page, 'bo-01-online-orders-1366x768.png', false);
  // accepting without a fee is refused, then fee 60 and accept
  // one next step "รับงาน" (focused: Enter); without a fee it is refused and the fee field gets the focus
  await expect(detail.getByRole('button', { name: 'รับเงิน', exact: true })).toBeDisabled();
  await expect(detail.getByTestId('payment-slot')).toContainText('รับงานก่อนจึงรับเงินได้');
  await expect(detail.getByTestId('step-primary')).toHaveText(/รับงาน/);
  await expect(detail.getByTestId('step-primary')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('กรุณาใส่ค่าส่งก่อนรับออเดอร์')).toBeVisible();
  await expect(detail.getByLabel('ค่าส่ง')).toBeFocused();
  await page.keyboard.type('60');
  await expect(detail).toContainText('฿3,260');
  await page.keyboard.press('Enter'); // Enter in the fee field = รับงาน
  await expect(detail).toContainText('รับแล้ว');
  await expect(detail).toContainText('ไม่ได้ส่ง LINE (โปรไฟล์ทดสอบ)');
  await expect(detail.getByRole('button', { name: 'รับเงิน', exact: true })).toBeEnabled();
  // accepting claimed the order for the admin ("กำลังจัด"); the cashier may take the payment anyway (the claim
  // covers picking only), so it stays with the admin, whose next step is "เริ่มจัดของ"
  await expect(page.getByTestId('claim-bar')).toContainText('คุณกำลังจัด');
  await expect(detail.getByTestId('step-primary')).toHaveText(/เริ่มจัดของ/);
  await expect(detail.getByTestId('step-primary')).toBeEnabled();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await spacingIssues(page, '[data-testid="online-order-detail"]')).toEqual([]);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await shot(page, 'bo-02-accepted-1920x1080.png', false);
  // the settings tab (ADMIN) shows the LINE state, the token box never shows a token
  await page.goto('/settings?tab=online');
  await expect(page.getByText('ร้านออนไลน์ใน LINE')).toBeVisible();
  await expect(page.getByText('ยังไม่ตั้งค่า (ใช้โหมดทดสอบได้เฉพาะในร้าน)')).toBeVisible();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    expect(await horizontalOverflow(page)).toEqual([]);
  }
});

test('the customer sees the accepted total and a PromptPay QR with the amount', async () => {
  await phone.goto(`/shop/orders/${state.orderId}`);
  await expect(phone.getByText('ร้านยืนยันแล้ว')).toBeVisible();
  await expect(phone.getByTestId('shop-order-total')).toHaveText('฿3,260.00');
  // the default bank account has a PromptPay ID (14-promptpay.spec.ts): QR with the amount locked
  const qr = phone.getByTestId('shop-qr');
  await expect(qr).toBeVisible();
  expect(await qr.getAttribute('data-payload')).toContain('54073260.00');
  await mobileOk(phone);
  await shot(phone, 'm-06-accepted.png');
});

test('cashier opens the online order from the POS held bills and takes cash; the order is paid', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  const page = await ctx.newPage();
  try {
    await uiLogin(page, CASHIER.username, CASHIER.password);
    await expect(page).toHaveURL(/\/pos/);
    const shiftDlg = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
    await shiftDlg.or(page.getByRole('button', { name: 'ปิดกะ', exact: true })).first().waitFor();
    if (await shiftDlg.isVisible()) {
      await shiftDlg.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true }).fill('500');
      await shiftDlg.getByRole('button', { name: 'ตกลง' }).click();
      await expect(shiftDlg).toBeHidden();
    }
    await page.getByRole('button', { name: /^บิลพัก/ }).click();
    const sheet = page.getByRole('dialog').filter({ hasText: 'ออเดอร์ออนไลน์ (LINE) รอชำระ' });
    const row = sheet.getByTestId('pos-online-order').filter({ hasText: state.orderNo! });
    await expect(row).toContainText('฿3,260');
    // the admin is still picking it: a warning, not a block
    await expect(row.getByTestId('picking-note')).toContainText('ยังไม่ได้จัดของ · กำลังจัดโดย');
    await row.getByRole('button', { name: 'เปิดบิล' }).click();
    await expect(page.getByTestId('pos-online-banner')).toContainText(state.orderNo!);
    await expect(page.getByTestId('pos-online-banner').getByTestId('picking-note')).toContainText('ยังไม่ได้จัดของ');
    await expect(page.locator('#pos-cart')).toContainText('ค่าส่ง');
    await page.getByRole('button', { name: 'ชำระเงิน' }).last().click();
    const pay = page.getByRole('dialog').filter({ hasText: 'เลือกช่องทางการชำระเงิน' });
    await expect(pay).toContainText('3,260');
    await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
    const cash = page.getByRole('dialog').filter({ hasText: 'รับชำระด้วยเงินสด' });
    await page.keyboard.type('3260');
    await cash.getByRole('button', { name: /ยืนยันรับเงินสด/ }).click();
    await expect(page.getByRole('dialog').filter({ hasText: 'ชำระเงินสำเร็จ!' })).toBeVisible();
    const detail = await api<{ posOrder: { totalAmount: number } | null; status: string }>('GET', `/online-shop/orders/${state.orderId}`, adminToken);
    expect(detail.posOrder?.totalAmount).toBe(3260);
    expect(detail.status).toBe('ACCEPTED'); // delivery: staff close it after delivering
  } finally {
    await ctx.close();
  }
  await phone.goto(`/shop/orders/${state.orderId}`);
  await expect(phone.getByText('ชำระเงินแล้ว')).toBeVisible();
  await expect(phone.getByTestId('shop-qr')).toHaveCount(0);
});
