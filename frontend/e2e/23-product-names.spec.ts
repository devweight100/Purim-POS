import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * Product names (owner option ข, docs/product-names.md): ชื่อร้าน + ชื่อผู้ผลิต, supplier product name / code per
 * supplier row, every search matches them (hint under the result), supplier documents print
 * "ใช้ชื่อร้าน / ใช้ชื่อผู้ผลิต" (stored on the document).
 */
test.describe.configure({ mode: 'serial' });

const TAG = `PN${String(Date.now()).slice(-6)}`;
const SHOP = `ท่อพีวีซี ชั้น 8.5 ขนาด 1 นิ้ว ยาว 4 เมตร สีฟ้า ตราช้าง ${TAG}`;
const MAKER = `SCG PVC Pipe Class 8.5 1in ${TAG}`;
const SUP_NAME = `ท่อ PVC 8.5 1นิ้ว (ฟ้า) ${TAG}`;
const SUP_CODE = `TT-${TAG}`;
const PLAIN = `ข้อต่อตรง PVC 1 นิ้ว ${TAG}`;
const COLLAPSED_KEY = 'purim_sidebar_collapsed';
let token = '';
const made: { sup?: { id: string; name: string }; pipe?: { id: string }; plain?: { id: string } } = {};

test.beforeAll(async () => {
  token = await apiLogin(ADMIN);
  made.sup = await api<{ id: string; name: string }>('POST', '/suppliers', token, { name: `บริษัท ท่อไทย ซัพพลาย ${TAG} จำกัด`, creditTerms: 30 });
  made.pipe = await api<{ id: string }>('POST', '/products', token, {
    name: SHOP, basePrice: 120, priceLevel1: 120, costPrice: 80, unit: 'เส้น', manufacturerName: MAKER,
    supplierEntries: [{ supplierId: made.sup.id, unitCost: 80, supplierProductName: SUP_NAME, supplierSku: SUP_CODE }],
  });
  made.plain = await api<{ id: string }>('POST', '/products', token, {
    name: PLAIN, basePrice: 15, priceLevel1: 15, costPrice: 9, unit: 'ตัว', supplierEntries: [{ supplierId: made.sup.id, unitCost: 9 }],
  });
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

test('product form: ชื่อผู้ผลิต in ข้อมูลเพิ่มเติม, ชื่อ/รหัสสินค้าของผู้ขาย per supplier row; saved, shown again, keyboard order', async ({ page }) => {
  await login(page);
  await page.goto('/products');
  await page.getByRole('button', { name: 'เพิ่มสินค้าใหม่' }).click();
  const form = page.getByRole('dialog').filter({ hasText: 'เพิ่มสินค้าใหม่' });
  const name = `ข้องอ 90 องศา PVC ${TAG}`;
  await form.getByLabel('ชื่อสินค้า *', { exact: true }).fill(name);
  // Tab from the name reaches the cost next (owner's order, docs/product-form-bank-logos.md); the manufacturer name
  // is in "ข้อมูลเพิ่มเติม" below
  await form.getByLabel('ชื่อสินค้า *', { exact: true }).press('Tab');
  await expect(form.getByLabel('ต้นทุน', { exact: true })).toBeFocused();
  await form.getByLabel('ชื่อผู้ผลิต (ไม่บังคับ)').focus();
  await page.keyboard.type(`  SCG Elbow 90 1in ${TAG}  `);
  await form.getByLabel('ราคา 1', { exact: true }).fill('25');
  await form.getByRole('button', { name: 'เพิ่มแถวผู้จำหน่าย' }).click();
  await form.getByLabel('ผู้จำหน่าย 1', { exact: true }).selectOption(made.sup!.id);
  await form.getByLabel('ต้นทุน/ชิ้น ผู้จำหน่าย 1').fill('14');
  await form.getByLabel('ชื่อสินค้าของผู้ขาย 1').fill(`ข้องอ PVC 1นิ้ว ${TAG}`);
  await form.getByLabel('รหัสสินค้าของผู้ขาย 1').fill(`EL-${TAG}`);
  // no sideways scroll in the form at 1366x768
  expect(await horizontalOverflow(page)).toEqual([]);
  await form.getByRole('button', { name: 'บันทึกสินค้า' }).click();
  await expect(form).toBeHidden();
  const list = await api<{ data: { id: string }[] }>('GET', `/products/page?page=1&limit=5&q=${encodeURIComponent(name)}`, token);
  const saved = await api<{ manufacturerName: string; supplierEntries: { supplierId: string; supplierProductName: string; supplierSku: string }[] }>('GET', `/products/${list.data[0].id}`, token);
  expect(saved.manufacturerName).toBe(`SCG Elbow 90 1in ${TAG}`);
  expect(saved.supplierEntries[0]).toMatchObject({ supplierId: made.sup!.id, supplierProductName: `ข้องอ PVC 1นิ้ว ${TAG}`, supplierSku: `EL-${TAG}` });

  // the products list finds it by the supplier code, with the hint; the edit form shows the saved names
  await page.getByPlaceholder('ค้นหาชื่อ, รหัส, บาร์โค้ด...').fill(`el-${TAG}`.toLowerCase());
  const row = page.locator('tr', { hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('search-match-hint')).toHaveText(`รหัสผู้ขาย: EL-${TAG}`);
  await row.getByRole('button', { name: `จัดการสินค้า ${name}` }).click();
  await page.getByRole('menuitem', { name: 'แก้ไข' }).click();
  const edit = page.getByRole('dialog').filter({ hasText: 'แก้ไขสินค้า' });
  await expect(edit.getByLabel('ชื่อผู้ผลิต (ไม่บังคับ)')).toHaveValue(`SCG Elbow 90 1in ${TAG}`);
  await expect(edit.getByLabel('ชื่อสินค้าของผู้ขาย 1')).toHaveValue(`ข้องอ PVC 1นิ้ว ${TAG}`);
  await expect(edit.getByLabel('รหัสสินค้าของผู้ขาย 1')).toHaveValue(`EL-${TAG}`);
  await edit.getByLabel('ชื่อผู้ผลิต (ไม่บังคับ)').fill('');
  await edit.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
  await expect(edit).toBeHidden();
  expect((await api<{ manufacturerName: string | null }>('GET', `/products/${list.data[0].id}`, token)).manufacturerName).toBeNull();
});

test('POS search finds a product by its manufacturer name and shows "ผู้ผลิต: …" under the shop name', async ({ page }) => {
  await login(page);
  await page.goto('/pos');
  // no shift open on this terminal: skip opening one (searching needs no shift)
  await page.getByRole('button', { name: 'ข้ามการเปิดกะ' }).click();
  const search = page.getByRole('textbox', { name: /ค้นหาสินค้า/ }).first();
  await search.fill(`scg pvc pipe class 8.5 1in ${TAG}`.toLowerCase());
  const card = page.getByTestId('pos-product-card').filter({ hasText: SHOP });
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('search-match-hint')).toHaveText(`ผู้ผลิต: ${MAKER}`);
  // and by the supplier code
  await search.fill(SUP_CODE.toLowerCase());
  await expect(page.getByTestId('pos-product-card').filter({ hasText: SHOP }).getByTestId('search-match-hint')).toHaveText(`รหัสผู้ขาย: ${SUP_CODE}`);
  // the shop name itself matches without a hint
  await search.fill(`สีฟ้า ตราช้าง ${TAG}`);
  await expect(page.getByTestId('pos-product-card').filter({ hasText: SHOP }).getByTestId('search-match-hint')).toHaveCount(0);
});

test('PO in supplier-name mode: screen + A4 PDF print the supplier names, switching updates, a reprint keeps the stored mode', async ({ page }) => {
  await login(page);
  await page.goto('/purchase-orders');
  await page.getByRole('button', { name: /เปิดใบสั่งซื้อใหม่/ }).click();
  await page.getByPlaceholder('ค้นหาชื่อผู้จำหน่าย หรือ เบอร์โทร...').fill(TAG);
  await page.getByRole('button', { name: new RegExp(made.sup!.name.replace(/[()]/g, '.')) }).click();
  // default from the settings = ใช้ชื่อร้าน; choose ใช้ชื่อผู้ผลิต by keyboard (→)
  const toggle = page.getByTestId('doc-name-mode').first();
  await expect(toggle.getByRole('radio', { name: 'ใช้ชื่อร้าน' })).toHaveAttribute('aria-checked', 'true');
  await toggle.getByRole('radio', { name: 'ใช้ชื่อร้าน' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(toggle.getByRole('radio', { name: 'ใช้ชื่อผู้ผลิต' })).toHaveAttribute('aria-checked', 'true');
  // the PO item picker finds the pipe by the supplier's code (hint), Enter adds it
  const picker = page.getByPlaceholder('พิมพ์ค้นหาสินค้า (↑/↓ เลื่อน, Enter เลือก)...');
  await picker.fill(SUP_CODE.toLowerCase());
  await expect(page.getByTestId('search-match-hint').filter({ hasText: `รหัสผู้ขาย: ${SUP_CODE}` }).first()).toBeVisible();
  await picker.press('Enter');
  await picker.fill(PLAIN);
  await picker.press('Enter');
  // the order table previews the printed names
  await expect(page.getByTestId('po-line-name').filter({ hasText: SUP_NAME })).toHaveCount(1);
  await expect(page.getByTestId('po-line-name').filter({ hasText: PLAIN })).toHaveCount(1);
  await expect(page.getByTestId('po-line-sub').filter({ hasText: `รหัสผู้ขาย: ${SUP_CODE}` })).toHaveCount(1);
  expect(await horizontalOverflow(page)).toEqual([]);
  await page.getByRole('button', { name: /สร้างใบสั่งซื้อ \(Ctrl \+ Enter\)/ }).click();

  // the A4 document opens: supplier names + code column
  const pdf = page.getByRole('dialog').filter({ hasText: 'เอกสารใบสั่งซื้อ' });
  await expect(pdf.getByTestId('po-pdf-line-name').filter({ hasText: SUP_NAME })).toHaveCount(1);
  await expect(pdf.getByTestId('po-pdf-line-name').filter({ hasText: PLAIN })).toHaveCount(1); // no other name: shop name
  await expect(pdf.getByTestId('po-pdf-supplier-code').filter({ hasText: SUP_CODE })).toHaveCount(1);
  const poNumber = (await pdf.locator('h3').first().innerText()).match(/PO:\s*([^)]+)\)/)![1].trim();
  const stored = await api<{ data: { id: string; docNameMode: string }[] }>('GET', `/purchase-orders?search=${poNumber}`, token);
  expect(stored.data[0].docNameMode).toBe('SUPPLIER');
  const poId = stored.data[0].id;

  // switch to the shop names in the document itself
  await pdf.getByTestId('doc-name-mode').getByRole('radio', { name: 'ใช้ชื่อร้าน' }).click();
  await expect(pdf.getByTestId('po-pdf-line-name').filter({ hasText: SHOP })).toHaveCount(1);
  await expect(pdf.getByTestId('po-pdf-supplier-code')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(pdf).toBeHidden();

  // reprint (detail -> PDF) keeps the stored mode; the detail screen switches back to the supplier names
  await page.reload();
  await page.locator('tr', { hasText: poNumber }).first().click();
  const detail = page.getByRole('dialog').filter({ hasText: `รายละเอียดใบสั่งซื้อ ${poNumber}` });
  await expect(detail.getByTestId('doc-name-mode').getByRole('radio', { name: 'ใช้ชื่อร้าน' })).toHaveAttribute('aria-checked', 'true');
  await expect(detail.getByTestId('po-line-name').filter({ hasText: SHOP })).toHaveCount(1);
  await detail.getByTestId('doc-name-mode').getByRole('radio', { name: 'ใช้ชื่อผู้ผลิต' }).click();
  await expect(detail.getByTestId('po-line-name').filter({ hasText: SUP_NAME })).toHaveCount(1);
  await expect(detail.getByTestId('po-line-sub').filter({ hasText: `ชื่อร้าน: ${SHOP}` })).toHaveCount(1);
  await detail.getByRole('button', { name: 'ดู/พิมพ์ PDF' }).click();
  const again = page.getByRole('dialog').filter({ hasText: 'เอกสารใบสั่งซื้อ' });
  await expect(again.getByTestId('po-pdf-line-name').filter({ hasText: SUP_NAME })).toHaveCount(1);
  await expect(again.getByTestId('po-pdf-supplier-code').filter({ hasText: SUP_CODE })).toHaveCount(1);
  expect((await api<{ docNameMode: string }>('GET', `/purchase-orders/${poId}`, token)).docNameMode).toBe('SUPPLIER');
});

test('settings: the default name for supplier documents is saved; no sideways scroll on the new screens', async ({ page }) => {
  await login(page);
  await page.goto('/settings?tab=stock');
  const box = page.getByTestId('supplier-doc-name-setting');
  await box.getByRole('radio', { name: 'ใช้ชื่อผู้ผลิต' }).click();
  await page.getByRole('button', { name: /บันทึก/ }).first().click();
  await expect.poll(async () => (await api<{ supplierDocNameMode: string }>('GET', '/settings', token)).supplierDocNameMode).toBe('SUPPLIER');
  // a new PO now starts in supplier-name mode
  await page.goto('/purchase-orders');
  await page.getByRole('button', { name: /เปิดใบสั่งซื้อใหม่/ }).click();
  await page.getByPlaceholder('ค้นหาชื่อผู้จำหน่าย หรือ เบอร์โทร...').fill(TAG);
  await page.getByRole('button', { name: new RegExp(made.sup!.name.replace(/[()]/g, '.')) }).click();
  await expect(page.getByTestId('doc-name-mode').first().getByRole('radio', { name: 'ใช้ชื่อผู้ผลิต' })).toHaveAttribute('aria-checked', 'true');
  for (const collapsed of [false, true]) {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      if (collapsed !== (await page.evaluate((k) => localStorage.getItem(k) === '1', COLLAPSED_KEY))) await page.keyboard.press('Control+b');
      await page.waitForTimeout(250);
      expect({ size, collapsed, overflow: await horizontalOverflow(page) }).toEqual({ size, collapsed, overflow: [] });
    }
  }
  await api('PATCH', '/settings', token, { supplierDocNameMode: 'SHOP' });
});
