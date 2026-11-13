import { expect, test, type Browser, type Page } from '@playwright/test';
import { ELECTRON_STUB, capturePrint, type CapturedPrint } from '../scripts/print-audit/render';
import { ADMIN } from './env';
import { expectCartQty, scan, uiLogin } from './helpers';

/**
 * Receipt slips print the same from every entry point (desktop app path).
 *
 * The desktop bridge is stubbed (window.electronAPI.printSilent records the job), so the test sees
 * the exact HTML the shop's app would print. A cash sale prints its slip on the POS; the same bill
 * is then reprinted from the orders page, the POS sales history and the document search (F3).
 * Every job must be an 80 mm job marked as such (the desktop app sends it to the raster printer,
 * never to the driver as text), lay out within the 288 px printable width, and say the same thing
 * (a reprint adds only the "พิมพ์ซ้ำ" line; cash received / change are not stored on the server).
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
let orderNumber = '';
const jobs: Record<string, CapturedPrint> = {};

const WATER = { sku: 'DRK-SINGHA-600', name: 'น้ำดื่มสิงห์ 600ml' };

async function closeDialogs() {
  for (let i = 0; i < 4 && (await page.getByRole('dialog').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}

/** Lay the job out like the desktop raster printer (288 CSS px, print media) and read it back. */
async function render(browser: Browser, job: CapturedPrint) {
  const ctx = await browser.newContext({ viewport: { width: 288, height: 600 } });
  const p = await ctx.newPage();
  try {
    await p.emulateMedia({ media: 'print' });
    await p.setContent(job.html, { waitUntil: 'networkidle' });
    return await p.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      lines: document.body.innerText.split('\n').map((l) => l.trim()).filter(Boolean),
    }));
  } finally {
    await ctx.close();
  }
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.addInitScript(ELECTRON_STUB);
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await expect(page).toHaveURL(/\/pos/);
});

test.afterAll(async () => {
  await page?.close();
});

test('a cash sale prints its slip; history, orders page and document search reprint the same slip', async ({ browser }) => {
  const openShift = page.getByRole('dialog').filter({ hasText: 'ระบุเงินในลิ้นชัก' });
  if (await openShift.waitFor({ timeout: 8000 }).then(() => true, () => false)) {
    await openShift.getByLabel('ยอดเงินรวมในลิ้นชัก').fill('1000');
    await openShift.getByRole('button', { name: 'ตกลง' }).click();
    await expect(openShift).toBeHidden();
  }

  // POS sale: the slip prints right after payment
  await scan(page, WATER.sku);
  await scan(page, WATER.sku);
  await expectCartQty(page, WATER.sku, 2);
  await page.getByRole('button', { name: 'ชำระเงิน' }).click();
  const pay = page.getByRole('dialog');
  await pay.getByRole('button', { name: /เงินสด \(Cash\)/ }).click();
  await pay.getByRole('button', { name: '฿100', exact: true }).click();
  jobs.pos = await capturePrint(page, () => pay.getByRole('button', { name: 'ยืนยันรับเงินสด' }).click());
  await expect(pay).toContainText('ชำระเงินสำเร็จ!');
  orderNumber = /ORD-\d+/.exec(jobs.pos.html)?.[0] || '';
  expect(orderNumber).not.toBe('');
  await page.getByRole('button', { name: 'ปิดหน้าต่าง (เริ่มออเดอร์ใหม่)' }).click({ timeout: 3000 }).catch(() => undefined);
  await closeDialogs();

  // POS sales history
  await page.getByRole('button', { name: /ประวัติ/ }).first().click();
  const row = page.getByRole('dialog').last().locator('tr').filter({ hasText: orderNumber });
  await row.getByRole('button', { name: /เครื่องมือ/ }).click();
  await page.getByRole('menuitem', { name: 'ดูใบเสร็จ' }).click();
  let dlg = page.getByRole('dialog').filter({ hasText: 'ตัวอย่างใบเสร็จรับเงิน' });
  jobs.history = await capturePrint(page, () => dlg.getByRole('button', { name: /^พิมพ์ใบเสร็จ/ }).click());
  await closeDialogs();

  // document search (F3)
  await page.keyboard.press('F3');
  const search = page.getByRole('dialog').last();
  await search.locator('input').first().fill(orderNumber);
  await search.getByText(orderNumber, { exact: true }).first().waitFor();
  await search.locator(`xpath=.//*[normalize-space(text())="${orderNumber}"]/ancestor::div[.//button][1]//button`).last().click();
  dlg = page.getByRole('dialog').filter({ hasText: 'ตัวอย่างใบเสร็จรับเงิน' });
  jobs.search = await capturePrint(page, () => dlg.getByRole('button', { name: /^พิมพ์ใบเสร็จ/ }).click());
  await closeDialogs();

  // orders page
  await page.goto('/orders');
  await page.getByText(orderNumber).first().click();
  await page.getByRole('dialog').last().getByRole('button', { name: /พิมพ์สลิป 80mm/ }).click();
  dlg = page.getByRole('dialog').filter({ hasText: 'ตัวอย่างใบเสร็จรับเงิน' });
  jobs.orders = await capturePrint(page, () => dlg.getByRole('button', { name: /^พิมพ์ใบเสร็จ/ }).click());
  await closeDialogs();

  const rendered: Record<string, { scrollWidth: number; lines: string[] }> = {};
  for (const [name, job] of Object.entries(jobs)) {
    // an 80 mm job, marked so the desktop app routes it to the raster printer even without `format`
    expect(job.format, name).toBe('80mm');
    expect(job.html, name).toContain('<meta name="purim-print-format" content="80mm"');
    rendered[name] = await render(browser, job);
    expect(rendered[name].scrollWidth, `${name}: nothing past the 288 px printable width`).toBeLessThanOrEqual(288);
  }

  // same slip everywhere: reprints add the "พิมพ์ซ้ำ" line; the sale also shows cash received / change
  const reprintLine = (l: string) => /^\*\*\* พิมพ์ซ้ำ .* \*\*\*$/.test(l);
  const comparable = (lines: string[]) => {
    const out = lines.filter((l) => !reprintLine(l));
    // label + value pairs of the cash lines that only the sale knows
    for (const label of ['รับเงิน', 'เงินทอน']) {
      const i = out.indexOf(label);
      if (i >= 0) out.splice(i, 2);
    }
    return out;
  };
  for (const name of ['history', 'search', 'orders']) {
    expect(rendered[name].lines.some(reprintLine), `${name} is marked as a reprint`).toBe(true);
    expect(comparable(rendered[name].lines), `${name} == POS sale slip`).toEqual(comparable(rendered.pos.lines));
  }
  expect(rendered.pos.lines).toContain('เงินทอน');
  expect(rendered.pos.lines).toContain(`${WATER.name}`);
});
