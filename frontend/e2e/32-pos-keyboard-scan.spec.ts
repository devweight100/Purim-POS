import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, CASHIER } from './env';
import { api, apiLogin, scan, scannerInput, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * Owner bugs 2026-11-25 (docs/pos-keyboard-scan.md), keyboard-first shop with USB scanners (keyboard + Enter):
 * 1. the manager PIN pad (claim -> discount over the limit -> approval at payment) works from the keyboard;
 * 2. after a payment the POS is back on standby (focus on the scan box); a scan is recognised wherever the focus is
 *    (customer search, item fields ...) without leaving its characters there; not added while paying (notice);
 * 3. Enter = the primary action of the POS dialogs; a scanner's Enter submits nothing.
 * A scanner = keys 5 ms apart + Enter; a person = 120 ms apart.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-5);
const SHOTS = process.env.E2E_SHOT_DIR || '';
const P = {
  drill: { name: `สว่านไฟฟ้าไร้สาย 18V พร้อมแบตเตอรี่ 2 ก้อน-${TAG}`, barcode: `8857${TAG}01`, price: 2890 },
  cement: { name: `ปูนซีเมนต์ปอร์ตแลนด์ ตราเสือ 50 กก.-${TAG}`, barcode: `8857${TAG}02`, price: 165.5 },
  tape: { name: `เทปพันเกลียวท่อประปา-${TAG}`, barcode: `8857${TAG}03`, price: 25 },
};
const MEMBER = { name: `คุณสมหญิง ใจดีมาก ลูกค้าประจำ-${TAG}`, phone: `089${TAG}11` };

/** like a USB scanner: very fast keys, then Enter */
async function scannerBurst(page: Page, code: string) {
  await page.keyboard.type(code, { delay: 5 });
  await page.keyboard.press('Enter');
}

type Line = { name: string; quantity: number };
const lines = (page: Page): Promise<Line[]> =>
  page.evaluate(() => {
    const raw = localStorage.getItem('purim-pos-cart');
    return raw ? JSON.parse(raw).state.items : [];
  });
const qtyOf = async (page: Page, name: string) => (await lines(page)).find((l) => l.name === name)?.quantity ?? 0;
const activeInfo = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return { tag: a?.tagName || '', tabindex: a?.getAttribute('tabindex') || '', id: a?.id || '', label: a?.getAttribute('aria-label') || '' };
  });
const expectStandby = (page: Page) => expect(scannerInput(page)).toBeFocused();

async function ensureShift(page: Page) {
  const shiftDlg = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  await shiftDlg.or(page.getByRole('button', { name: 'ปิดกะ', exact: true })).first().waitFor();
  if (await shiftDlg.isVisible()) {
    const total = shiftDlg.getByLabel('ยอดเงินรวมในลิ้นชัก', { exact: true });
    await total.fill('500');
    // Enter in the open-shift dialog = ตกลง (bug 3)
    await total.press('Enter');
    await expect(shiftDlg).toBeHidden();
  }
}

async function posPage(browser: Browser) {
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
  await page.waitForTimeout(300);
  return { ctx, page };
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** F12 -> เงินสด -> amount -> Enter (keyboard only). */
async function payCashByKeyboard(page: Page, amount: string) {
  await page.keyboard.press('F12');
  const pay = page.getByRole('dialog').filter({ hasText: 'เลือกช่องทางการชำระเงิน' });
  await expect(pay).toBeVisible();
  const cashCard = pay.getByRole('button', { name: /เงินสด \(Cash\)/ });
  await cashCard.focus();
  await page.keyboard.press('Enter');
  const cash = page.locator('#pos-cash-received');
  await expect(cash).toBeVisible();
  await cash.fill(amount);
  await cash.press('Enter');
}

test.beforeAll(async () => {
  await apiLogin(CASHIER);
  const admin = await apiLogin(ADMIN);
  for (const p of Object.values(P)) {
    const r = await api<{ id: string }>('POST', '/products', admin, {
      name: p.name, barcodes: [p.barcode], unit: 'ชิ้น', basePrice: p.price, priceLevel1: p.price, priceLevel2: p.price, priceLevel3: p.price,
      priceLevel4: 0, priceLevel5: 0, costPrice: Math.round(p.price * 0.7 * 100) / 100,
    });
    await api('POST', '/inventory/adjust', admin, { productId: r.id, type: 'ADD', amount: 500, reason: 'ปรับยอดเริ่มต้น' });
  }
  await api('POST', '/customers', admin, { name: MEMBER.name, phone: MEMBER.phone, type: 'INDIVIDUAL', priceLevel: 1 });
});

test('claim -> manager PIN by keyboard only (numpad + main row, Backspace, Esc, Enter); then standby on the scan box', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  await scan(page, P.drill.barcode);
  await scan(page, P.drill.barcode);
  await expect.poll(() => qtyOf(page, P.drill.name)).toBe(2);

  // เคลม 1 of the 2 (no customer quota): discount above the cashier's 10% -> manager approval at payment
  await page.getByRole('button', { name: 'เคลม', exact: true }).first().click();
  const claim = page.getByRole('dialog').filter({ hasText: 'บันทึกสินค้าเคลม' });
  const claimQty = claim.getByLabel('จำนวนที่เคลม');
  await expect(claimQty).toBeFocused();
  await claimQty.fill('1');
  await claimQty.press('Enter'); // Enter = บันทึกสินค้าเคลม (bug 3)
  await expect(claim).toBeHidden();

  await payCashByKeyboard(page, '5000');
  const appr = page.getByTestId('approval-pin-dialog');
  await expect(appr).toBeVisible();
  const pin = appr.getByLabel('PIN ผู้อนุมัติ');
  await expect(pin).toBeFocused();
  await shot(page, 'after-pin-dialog');

  // Esc = cancel (only the PIN dialog closes; the payment stays)
  await page.keyboard.press('Escape');
  await expect(appr).toBeHidden();
  await expect(page.locator('#pos-cash-received')).toBeVisible();
  await page.locator('#pos-cash-received').press('Enter');
  await expect(appr).toBeVisible();
  await expect(pin).toBeFocused();

  // numeric keypad + a wrong digit removed with Backspace, then the main row; Thai layout keys come by physical code
  await page.keyboard.press(`Numpad${ADMIN.pin[0]}`);
  await page.keyboard.press(`Numpad${ADMIN.pin[1]}`);
  await page.keyboard.press('Digit5');
  await page.keyboard.press('Backspace');
  await page.keyboard.press(`Digit${ADMIN.pin[2]}`);
  await page.keyboard.press(`Digit${ADMIN.pin[3]}`);
  await expect(pin).toHaveValue(ADMIN.pin);
  // letters are ignored
  await page.keyboard.press('KeyA');
  await expect(pin).toHaveValue(ADMIN.pin);
  await page.keyboard.press('Enter');

  const pay = page.getByRole('dialog').filter({ hasText: 'ชำระเงินสำเร็จ!' });
  await expect(pay).toBeVisible();
  // success screen: Enter = ปิดหน้าต่าง (เริ่มออเดอร์ใหม่)
  await page.keyboard.press('Enter');
  await expect(pay).toBeHidden();
  await expect.poll(async () => (await lines(page)).length).toBe(0);
  // bug 2: back on standby, ready to scan (also after the receipt print frame took the focus)
  await expectStandby(page);
  await page.waitForTimeout(3500);
  await expectStandby(page);
  await scannerBurst(page, P.cement.barcode);
  await expect.poll(() => qtyOf(page, P.cement.name)).toBe(1);
  await ctx.close();
});

test('focus is back on the scan box after every payment (opened from the pay button too), and the next scan goes in', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  await scan(page, P.tape.barcode);
  // opened with the mouse from the bill note field: closing must not leave the focus there / on the button
  await page.getByPlaceholder('ระบุโน้ต / หมายเหตุท้ายบิล...').click();
  await page.getByRole('button', { name: /^ชำระเงิน/ }).first().click();
  const pay = page.getByRole('dialog').filter({ hasText: 'เลือกช่องทางการชำระเงิน' });
  await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
  await page.locator('#pos-cash-received').fill('100');
  await page.locator('#pos-cash-received').press('Enter');
  await expect(page.getByText('ชำระเงินสำเร็จ!')).toBeVisible();
  await page.getByRole('button', { name: /ปิดหน้าต่าง/ }).click();
  await expect(page.getByText('ชำระเงินสำเร็จ!')).toBeHidden();
  await expectStandby(page);
  // the 5-second auto close also ends on standby
  // the browser prints the receipt from a hidden frame a moment later: the focus must come back from it
  await page.waitForTimeout(3500);
  await expectStandby(page);
  await scannerBurst(page, P.tape.barcode);
  await expect.poll(() => qtyOf(page, P.tape.name)).toBe(1);
  await payCashByKeyboard(page, '25');
  await expect(page.getByText('ชำระเงินสำเร็จ!')).toBeVisible();
  await expect(page.getByText('ชำระเงินสำเร็จ!')).toBeHidden({ timeout: 10_000 });
  await page.waitForTimeout(3500);
  await expectStandby(page);
  await scannerBurst(page, P.cement.barcode);
  await expect.poll(() => qtyOf(page, P.cement.name)).toBe(1);
  await ctx.close();
});

test('scan while typing in the customer search adds to the cart; the search keeps its text; human typing is unaffected', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  await page.keyboard.press('Control+m');
  const dlg = page.getByRole('dialog').filter({ hasText: 'เลือกลูกค้า' });
  const search = dlg.getByPlaceholder(/ค้นหาชื่อ/);
  await expect(search).toBeFocused();
  await search.pressSequentially('สม', { delay: 120 });
  // scanner burst: product added, the search box keeps "สม", the burst's Enter picked no member and closed nothing
  await scannerBurst(page, P.cement.barcode);
  await expect.poll(() => qtyOf(page, P.cement.name)).toBe(1);
  await expect(search).toHaveValue('สม');
  await expect(search).toBeFocused();
  await expect(dlg).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('purim-pos-cart') || '{}').state?.customerId ?? null)).toBeNull();
  // the same digits typed by a person stay in the field and add nothing
  await search.fill('');
  await search.pressSequentially(P.cement.barcode, { delay: 120 });
  await expect(search).toHaveValue(P.cement.barcode);
  await expect.poll(() => qtyOf(page, P.cement.name)).toBe(1);
  // Enter picks the highlighted member (bug 3)
  await search.fill(MEMBER.phone);
  await expect(dlg.getByText(MEMBER.name)).toBeVisible();
  await search.press('Enter');
  await expect(dlg).toBeHidden();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('purim-pos-cart') || '{}').state?.customerName ?? null)).toBe(MEMBER.name);

  // bill note field: a scan there adds the item and the note keeps what was typed
  const note = page.getByPlaceholder('ระบุโน้ต / หมายเหตุท้ายบิล...');
  await note.click();
  await note.pressSequentially('ส่งด่วน', { delay: 120 });
  await scannerBurst(page, P.tape.barcode);
  await expect.poll(() => qtyOf(page, P.tape.name)).toBe(1);
  await expect(note).toHaveValue('ส่งด่วน');

  // quantity numpad (F2) open: the scan goes to the cart, the numpad keeps its value and stays open
  await page.keyboard.press('F2');
  const numpad = page.getByRole('dialog').filter({ hasText: 'ระบุจำนวน' });
  await expect(numpad).toBeVisible();
  await page.keyboard.press('Digit3');
  await scannerBurst(page, P.cement.barcode);
  await expect.poll(() => qtyOf(page, P.cement.name)).toBe(2);
  await expect(numpad).toBeVisible();
  await expect(numpad.locator('.font-mono').first()).toHaveText('3');
  await page.keyboard.press('Escape');
  await expect(numpad).toBeHidden();
  await ctx.close();
});

test('payment dialog open: a scan adds nothing and shows "ปิดหน้ารับเงินก่อนสแกนสินค้า"; the cash field is untouched', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  await scan(page, P.cement.barcode);
  await page.keyboard.press('F12');
  const pay = page.getByRole('dialog').filter({ hasText: 'เลือกช่องทางการชำระเงิน' });
  await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
  const cash = page.locator('#pos-cash-received');
  await cash.fill('200');
  await cash.focus();
  await scannerBurst(page, P.tape.barcode);
  await expect(page.getByText('ปิดหน้ารับเงินก่อนสแกนสินค้า')).toBeVisible();
  await shot(page, 'after-payment-open-scan-notice');
  await expect(cash).toHaveValue('200');
  // the scanner's Enter did not confirm the payment
  await expect(page.getByText('ชำระเงินสำเร็จ!')).toHaveCount(0);
  expect(await qtyOf(page, P.tape.name)).toBe(0);
  expect(await qtyOf(page, P.cement.name)).toBe(1);
  await page.keyboard.press('Escape');
  await ctx.close();
});

test('Enter submits each POS dialog (qty, price, item discount, bill discount, cash drawer, QR payment, 0-baht claim bill)', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  await scan(page, P.cement.barcode);
  await expect.poll(() => qtyOf(page, P.cement.name)).toBe(1);

  // F2 quantity numpad: type + Enter
  await page.keyboard.press('F2');
  await expect(page.getByRole('dialog').filter({ hasText: 'ระบุจำนวน' })).toBeVisible();
  await page.keyboard.press('Digit4');
  await page.keyboard.press('Enter');
  await expect.poll(() => qtyOf(page, P.cement.name)).toBe(4);
  await expectStandby(page);

  // F4 price numpad (cashier: manual price on the line)
  await page.keyboard.press('F4');
  const priceDlg = page.getByRole('dialog').filter({ hasText: 'แก้ไขราคาขาย' });
  await expect(priceDlg).toBeVisible();
  for (const k of ['Digit1', 'Digit7', 'Digit0']) await page.keyboard.press(k);
  await page.keyboard.press('NumpadEnter');
  await expect(priceDlg).toBeHidden();
  await expect.poll(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('purim-pos-cart') || '{}').state.items[0].customPrice))).toBe(170);

  // F3 item dialog: discount 5 baht + Enter in the field
  await page.keyboard.press('F3');
  const item = page.getByRole('dialog').filter({ hasText: 'แก้ไขรายการ' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: '฿ บาท' }).click();
  const disc = item.getByPlaceholder('ระบุจำนวนเงิน (บาท)');
  await disc.fill('5');
  await disc.press('Enter');
  await expect(item).toBeHidden();
  await expect.poll(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('purim-pos-cart') || '{}').state.items[0].discountValue))).toBe(5);

  // bill discount: Enter in the field
  await page.getByRole('button', { name: 'ส่วนลดท้ายบิล' }).click();
  const bill = page.getByRole('dialog').filter({ hasText: 'ระบุส่วนลดท้ายบิล' });
  await bill.getByRole('button', { name: '฿ บาท' }).click();
  await bill.getByPlaceholder('ระบุจำนวนเงิน (บาท)').fill('3');
  await bill.getByPlaceholder('ระบุจำนวนเงิน (บาท)').press('Enter');
  await expect(bill).toBeHidden();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('purim-pos-cart') || '{}').state.billDiscountValue)).toBe(3);
  // a held-down Enter (auto-repeat) does nothing extra; invalid value: Enter keeps the dialog open
  await page.getByRole('button', { name: 'ส่วนลดท้ายบิล' }).click();
  await bill.getByRole('button', { name: 'เปอร์เซ็นต์' }).click();
  await bill.getByPlaceholder('ระบุเปอร์เซ็นต์ (%)').fill('150');
  await bill.getByPlaceholder('ระบุเปอร์เซ็นต์ (%)').press('Enter');
  await expect(bill).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bill).toBeHidden();

  // F9 cash drawer: amount + reason, Enter in the reason field
  await page.keyboard.press('F9');
  const drawer = page.getByRole('dialog').filter({ hasText: 'เปิดลิ้นชัก / จัดการเงินสด' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: /นำเงินเข้า/ }).click();
  await drawer.getByPlaceholder('0.00').fill('100');
  const reason = drawer.getByPlaceholder(/เช่น เติมเงินทอน/);
  await reason.fill('เติมเงินทอนรอบบ่าย');
  await reason.press('Enter');
  await expect(drawer).toBeHidden();
  await expect(page.getByText(/บันทึกนำเงินเข้าลิ้นชัก ฿100 สำเร็จ/)).toBeVisible();

  // QR payment: Enter = ลูกค้าชำระเงินเรียบร้อยแล้ว; success: Enter closes; standby
  await page.keyboard.press('F12');
  const pay = page.getByRole('dialog').filter({ hasText: 'เลือกช่องทางการชำระเงิน' });
  await pay.getByRole('button', { name: /QR PromptPay/ }).click();
  await expect(page.getByRole('button', { name: /ลูกค้าชำระเงินเรียบร้อยแล้ว/ })).toBeVisible();
  // focus inside the dialog (not on a button): Enter confirms
  await page.getByRole('dialog').filter({ hasText: 'รับชำระผ่าน QR' }).getByRole('heading').first().click();
  await page.keyboard.press('Enter');
  await expect(page.getByText('ชำระเงินสำเร็จ!')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('ชำระเงินสำเร็จ!')).toBeHidden();
  await expectStandby(page);

  // ฿0 bill (whole line claimed): Enter on the confirm screen saves it once (approval asked once, PIN by keyboard)
  await scan(page, P.tape.barcode);
  await page.getByRole('button', { name: 'เคลม', exact: true }).first().click();
  const claim = page.getByRole('dialog').filter({ hasText: 'บันทึกสินค้าเคลม' });
  await claim.getByLabel('จำนวนที่เคลม').fill('1');
  await page.keyboard.press('Enter');
  await expect(claim).toBeHidden();
  await page.keyboard.press('F12');
  await expect(page.getByRole('button', { name: /ยืนยันบันทึกบิล ฿0.00/ })).toBeVisible();
  await page.getByRole('dialog').getByRole('heading').first().click();
  await page.keyboard.press('Enter');
  const appr = page.getByTestId('approval-pin-dialog');
  const done = page.getByText(/บันทึกบิลเคลม \/ ชำระ ฿0 สำเร็จ!/);
  await expect(appr.or(done)).toBeVisible();
  if (await appr.isVisible()) {
    await page.keyboard.type(ADMIN.pin, { delay: 60 });
    await page.keyboard.press('Enter');
  }
  await expect(done).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(done).toBeHidden();
  await expectStandby(page);
  // one bill only (no double submit)
  const info = await activeInfo(page);
  expect(info.tabindex).toBe('-1');
  await ctx.close();
});

test('PIN dialog fits without horizontal scroll at 1366x768, 1920x1080, 1093x614', async ({ browser }) => {
  const { ctx, page } = await posPage(browser);
  await scan(page, P.drill.barcode);
  await scan(page, P.drill.barcode);
  await page.getByRole('button', { name: 'เคลม', exact: true }).first().click();
  const claim = page.getByRole('dialog').filter({ hasText: 'บันทึกสินค้าเคลม' });
  await claim.getByLabel('จำนวนที่เคลม').fill('1');
  await page.keyboard.press('Enter');
  await payCashByKeyboard(page, '5000');
  const appr = page.getByTestId('approval-pin-dialog');
  await expect(appr).toBeVisible();
  for (const s of SIZES) {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.waitForTimeout(200);
    expect(await horizontalOverflow(page), `${s.width}x${s.height}`).toEqual([]);
    // the approve button is reachable inside the dialog
    await appr.getByRole('button', { name: /อนุมัติ/ }).scrollIntoViewIfNeeded();
    await expect(appr.getByRole('button', { name: /อนุมัติ/ })).toBeInViewport();
  }
  await page.keyboard.press('Escape');
  await ctx.close();
});
