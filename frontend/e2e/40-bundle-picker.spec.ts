import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * Product form, สินค้าชุด (docs/round-shift-today-bundle-replace.md): bundle items are added with a type-to-search
 * picker (server search by name / SKU / barcode, Thai), keyboard only: type, ↓, Enter adds it and focuses its
 * quantity. The bundle itself, other bundles and disabled products are listed greyed with the reason and cannot be
 * picked. Saved bundle rows come back on edit.
 */
test.describe.configure({ mode: 'serial' });
test.use({ deviceScaleFactor: 2 });

const OUT = process.env.E2E_SCREENSHOT_DIR || '';
const TAG = `BP${String(Date.now()).slice(-6)}`;
let token = '';
const ids: Record<string, string> = {};

async function shots(page: Page, name: string, before?: () => Promise<void>) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
    if (before) await before();
    expect(await horizontalOverflow(page), `${name} ${size.width}x${size.height}`).toEqual([]);
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: `${OUT}/after-${name}-${size.width}x${size.height}.png` });
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
}

test.beforeAll(async () => {
  token = await apiLogin(ADMIN);
  const mk = async (key: string, name: string, extra: Record<string, unknown> = {}) => {
    const r = await api<{ id: string }>('POST', '/products', token, { name, basePrice: 120, priceLevel1: 120, priceLevel2: 115, priceLevel3: 110, priceLevel4: 105, priceLevel5: 100, costPrice: 80, unit: 'ชิ้น', ...extra });
    ids[key] = r.id;
    return r.id;
  };
  await mk('tap', `ก๊อกน้ำอ่างล้างจานสแตนเลส 304 แบบติดผนัง ${TAG}`, { barcodes: [`88${String(Date.now()).slice(-9)}1`, `88${String(Date.now()).slice(-9)}2`] });
  await mk('tape', `เทปพันเกลียว ตราช้าง ม้วนใหญ่ ${TAG}`, { sku: `TAPE-${TAG}` });
  await mk('old', `ก๊อกน้ำรุ่นเก่า เลิกขายแล้ว ${TAG}`);
  await api('POST', '/products/set-active', token, { ids: [ids.old], isActive: false });
  for (let i = 1; i <= 25; i++) await mk(`filler${i}`, `ก๊อกน้ำทดสอบรายการที่ ${i} ${TAG}`);
  await api('POST', '/inventory/adjust', token, { productId: ids.tap, type: 'ADD', amount: 30, reason: 'ยอดยกมา' });
  await api('POST', '/inventory/adjust', token, { productId: ids.tape, type: 'ADD', amount: 50, reason: 'ยอดยกมา' });
  await mk('otherBundle', `ชุดก๊อกน้ำสำเร็จรูป ${TAG}`, { isBundle: true, bundleItems: [{ childProductId: ids.tape, quantity: 1 }] });
});

test('bundle items: type, ↓, Enter adds and focuses the quantity; self / bundles / disabled cannot be picked; saved', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await page.goto('/products');
  await page.getByRole('button', { name: 'เพิ่มสินค้าใหม่' }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: 'เพิ่มสินค้าใหม่' });
  await dlg.locator('#product-form-price-1').fill('599');
  await dlg.locator('#product-form-name').fill(`ชุดก๊อกน้ำพร้อมเทปพันเกลียว สำหรับช่างประปา ${TAG}`);
  await dlg.getByRole('button', { name: /สินค้าจัดเซ็ต/ }).click();
  const picker = dlg.getByRole('combobox', { name: 'ค้นหาสินค้าเพื่อเพิ่มเข้าชุด' });
  await expect(picker).toBeVisible();

  // Thai search, server side: 28 products match "ก๊อกน้ำ"; the disabled one and the other bundle are marked
  await picker.fill(`ก๊อกน้ำ`);
  const options = dlg.getByTestId('product-pick-option');
  await expect(options.first()).toBeVisible();
  await picker.fill(`ชุดก๊อกน้ำสำเร็จรูป ${TAG}`);
  await expect(options.filter({ hasText: 'ชุดก๊อกน้ำสำเร็จรูป' })).toHaveAttribute('aria-disabled', 'true');
  await expect(options.filter({ hasText: 'ชุดก๊อกน้ำสำเร็จรูป' })).toContainText('ใส่ชุดซ้อนชุดไม่ได้');
  await picker.fill(`รุ่นเก่า เลิกขายแล้ว ${TAG}`);
  await expect(options.filter({ hasText: 'รุ่นเก่า' })).toContainText('ปิดใช้งานอยู่');
  await picker.press('Enter'); // nothing pickable: nothing added, the form is not saved
  await expect(dlg.getByTestId('bundle-item-row')).toHaveCount(0);
  await expect(dlg).toBeVisible();

  // keyboard: type, ↓, Enter -> added, quantity focused
  await picker.fill(`ติดผนัง ${TAG}`);
  await expect(options).toHaveCount(1);
  await picker.press('ArrowDown');
  await picker.press('Enter');
  const rows = dlg.getByTestId('bundle-item-row');
  await expect(rows).toHaveCount(1);
  const qtyTap = rows.first().getByRole('spinbutton');
  await expect(qtyTap).toBeFocused();
  await page.keyboard.type('2');
  await expect(qtyTap).toHaveValue('2');
  // by SKU, then back in the picker and pick it again: no second row, its quantity gets the focus
  await picker.fill(`TAPE-${TAG}`);
  await expect(options).toHaveCount(1);
  await picker.press('Enter');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).getByRole('spinbutton')).toBeFocused();
  await page.keyboard.type('3');
  await picker.fill(`ติดผนัง ${TAG}`);
  await expect(options).toHaveCount(1);
  await picker.press('Enter');
  await expect(rows).toHaveCount(2);
  await expect(qtyTap).toBeFocused();
  await expect(dlg.getByTestId('bundle-items')).toContainText('สต็อกชุดที่จัดได้สูงสุด');
  await shots(page, 'bundle-items', async () => { await dlg.getByTestId('bundle-items').scrollIntoViewIfNeeded(); });
  // listbox open, at the three sizes
  await picker.fill(`ก๊อกน้ำ`);
  await expect(options.first()).toBeVisible();
  await shots(page, 'bundle-picker-open', async () => { await picker.scrollIntoViewIfNeeded(); });
  await picker.fill('');

  await dlg.getByRole('button', { name: 'บันทึกสินค้า' }).click();
  await expect(dlg).toBeHidden();
  const saved = await api<{ data: { id: string; bundleItems: { childProductId: string; quantity: string | number }[] }[] }>(
    'GET', `/products/page?q=${encodeURIComponent('ชุดก๊อกน้ำพร้อมเทปพันเกลียว')}&status=all`, token,
  );
  const bundle = saved.data[0];
  const items = Object.fromEntries(bundle.bundleItems.map((b) => [b.childProductId, Number(b.quantity)]));
  expect(items).toEqual({ [ids.tap]: 2, [ids.tape]: 3 });

  // server: a bundle in a bundle or a disabled product is refused
  await expect(api('PATCH', `/products/${bundle.id}`, token, { bundleItems: [{ childProductId: ids.otherBundle, quantity: 1 }] })).rejects.toThrow(/400/);
  await expect(api('PATCH', `/products/${bundle.id}`, token, { bundleItems: [{ childProductId: ids.old, quantity: 1 }] })).rejects.toThrow(/400/);
  await expect(api('PATCH', `/products/${bundle.id}`, token, { bundleItems: [{ childProductId: bundle.id, quantity: 1 }] })).rejects.toThrow(/400/);
});
