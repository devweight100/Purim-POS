import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES } from './layout';

/**
 * PO entry grid (docs/po-grid-entry.md): type a partial code / name + Enter -> search popup with that text; an exact
 * SKU / barcode picks the product directly, a pack barcode also its unit; Enter walks code -> qty -> unit -> price ->
 * discount -> next row; per-unit discount "5" / "5%"; Ctrl+Delete deletes a row; Enter never saves (Ctrl+S does);
 * the default price is the last price paid to this supplier in that unit. Product form: category combobox.
 */
test.describe.configure({ mode: 'serial' });

const TAG = `PG${String(Date.now()).slice(-6)}`;
let token = '';
const ids: Record<string, string> = {};
let supName = '';

test.beforeAll(async () => {
  token = await apiLogin(ADMIN);
  const sup = await api<{ id: string; name: string }>('POST', '/suppliers', token, { name: `ผู้จำหน่ายกริด ${TAG} วัสดุก่อสร้างครบวงจร`, creditTerms: 30 });
  ids.sup = sup.id;
  supName = sup.name;
  const mk = async (key: string, body: Record<string, unknown>) => {
    const r = await api<{ id: string }>('POST', '/products', token, { basePrice: 50, priceLevel1: 50, unit: 'ชิ้น', ...body });
    ids[key] = r.id;
  };
  await mk('pipe', { name: `ท่อพีวีซีกริด ${TAG} 1/2 นิ้ว`, sku: `${TAG}-PIPE`, barcodes: [`88${TAG.slice(2)}001`], costPrice: 40, unit: 'เส้น' });
  await mk('tape', {
    name: `เทปพันเกลียวกริด ${TAG}`, sku: `${TAG}-TAPE`, barcodes: [`88${TAG.slice(2)}002`], costPrice: 8.5, unit: 'ม้วน',
    packagingUnits: [{ name: 'กล่อง', qtyPerPrev: 12, barcode: `88${TAG.slice(2)}012` }, { name: 'ลัง', qtyPerPrev: 10 }],
  });
  await mk('glue', { name: `กาวทาท่อกริด ${TAG}`, sku: `${TAG}-GLUE`, costPrice: 39, unit: 'กระป๋อง' });
  // an earlier PO from this supplier: กล่อง of tape at 95 -> the default price of a กล่อง line
  const tape = await api<{ packagingUnits: { id: string; name: string }[] }>('GET', `/products/${ids.tape}`, token);
  await api('POST', '/purchase-orders', token, { supplierId: ids.sup, items: [{ productId: ids.tape, quantity: 1, unitCost: 95, unitId: tape.packagingUnits.find((u) => u.name === 'กล่อง')!.id }] });
});

async function openGrid(page: Page) {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await page.goto('/purchase-orders');
  await page.getByRole('button', { name: /เปิดใบสั่งซื้อใหม่/ }).click();
  await page.getByPlaceholder('ค้นหาชื่อผู้จำหน่าย หรือ เบอร์โทร...').fill(TAG);
  await page.getByRole('button', { name: new RegExp(`ผู้จำหน่ายกริด ${TAG}`) }).first().click();
  await expect(page.getByTestId('po-grid')).toBeVisible();
}
const cell = (page: Page, col: string, row: number) => page.getByTestId(`po-cell-${col}-${row}`);

test('grid: partial code -> popup, exact codes direct, Enter through the cells, pack unit, discount %, delete, save', async ({ page }) => {
  await openGrid(page);
  // the first code cell has the focus
  await expect(cell(page, 'code', 0)).toBeFocused();
  // partial code + Enter -> popup with that text and the matches
  await page.keyboard.type(TAG.toLowerCase());
  await page.keyboard.press('Enter');
  const dlg = page.getByTestId('po-search-dialog');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('po-search-input')).toHaveValue(TAG.toLowerCase());
  await expect(dlg.getByTestId('po-search-input')).toBeFocused();
  await expect(dlg.getByTestId('po-search-option')).toHaveCount(3);
  // Esc goes back to the cell, the text kept
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(cell(page, 'code', 0)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dlg).toBeVisible();
  await dlg.getByTestId('po-search-input').fill(`พีวีซีกริด ${TAG}`);
  await expect(dlg.getByTestId('po-search-option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  // picked: the name is shown, the focus is on the quantity (name cell skipped)
  await expect(page.getByTestId('po-line-name').first()).toHaveText(`ท่อพีวีซีกริด ${TAG} 1/2 นิ้ว`);
  await expect(cell(page, 'qty', 0)).toBeFocused();
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'unit', 0)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cell(page, 'price', 0)).toBeFocused();
  await expect(cell(page, 'price', 0)).toHaveValue('40'); // no earlier PO: the product cost
  await page.keyboard.type('42');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'discount', 0)).toBeFocused();
  await page.keyboard.type('5%');
  await page.keyboard.press('Enter');
  // next row's code cell; ราคารวม = 3 x (42 - 5%) = 119.70
  await expect(cell(page, 'code', 1)).toBeFocused();
  await expect(cell(page, 'total', 0)).toHaveText('฿119.70');
  // Shift+Enter goes back
  await page.keyboard.press('Shift+Enter');
  await expect(cell(page, 'discount', 0)).toBeFocused();
  await page.keyboard.press('Enter');

  // exact pack barcode -> tape in กล่อง, default price = the last price to this supplier in กล่อง (95)
  await page.keyboard.type(`88${TAG.slice(2)}012`);
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  await expect(cell(page, 'qty', 1)).toBeFocused();
  await expect(cell(page, 'unit', 1)).toHaveValue('1');
  await expect(cell(page, 'unit', 1).locator('option:checked')).toHaveText('กล่อง ×12');
  await expect(cell(page, 'price', 1)).toHaveValue('95');
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  // ↓ in the unit cell: ลัง (x120) -> price converted from the กล่อง price (95 / 12 x 120 = 950); back to กล่อง
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, 'unit', 1).locator('option:checked')).toHaveText('ลัง ×120');
  await expect(cell(page, 'price', 1)).toHaveValue('950');
  await page.keyboard.press('ArrowUp');
  await expect(cell(page, 'price', 1)).toHaveValue('95');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('2.5'); // 2.50 baht off each กล่อง
  await page.keyboard.press('Enter');
  await expect(cell(page, 'code', 2)).toBeFocused();
  await expect(cell(page, 'total', 1)).toHaveText('฿185.00');

  // exact SKU (any case) -> direct; then delete that row with Ctrl+Delete
  await page.keyboard.type(`${TAG}-glue`.toLowerCase());
  await page.keyboard.press('Enter');
  await expect(cell(page, 'qty', 2)).toBeFocused();
  await expect(page.getByTestId('po-grid-row')).toHaveCount(4); // 3 lines + the empty row
  await page.keyboard.press('Control+Delete');
  await expect(page.getByTestId('po-grid-row')).toHaveCount(3);
  await expect(cell(page, 'code', 2)).toBeFocused();

  // name cell: partial name + Enter -> popup with it
  await page.keyboard.press('Enter'); // empty code: stays
  await cell(page, 'name', 2).click();
  await page.keyboard.type('กาวทาท่อ');
  await page.keyboard.press('Enter');
  await expect(dlg.getByTestId('po-search-input')).toHaveValue('กาวทาท่อ');
  await expect(dlg.getByTestId('po-search-option').filter({ hasText: TAG })).toHaveCount(1);
  await dlg.getByTestId('po-search-option').filter({ hasText: TAG }).click();
  await expect(cell(page, 'qty', 2)).toBeFocused();
  await page.keyboard.press('Enter');

  // Enter never saved anything
  const before = await api<{ meta: { total: number } }>('GET', `/purchase-orders?supplierId=${ids.sup}`, token);
  expect(before.meta.total).toBe(1);
  // the window fits: no sideways scroll at the owner's sizes
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    expect({ size, overflow: await horizontalOverflow(page) }).toEqual({ size, overflow: [] });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  // bill discount in the footer, total = 119.70 + 185 + 39 - 10 = 333.70
  await page.getByTestId('po-bill-discount').fill('10');
  await expect(page.getByTestId('po-total')).toHaveText('฿333.70');
  await page.keyboard.press('Control+s');

  const pdf = page.getByRole('dialog').filter({ hasText: 'เอกสารใบสั่งซื้อ' });
  await expect(pdf).toBeVisible();
  await expect(pdf.getByTestId('po-pdf-qty').nth(1)).toHaveText('2 กล่อง');
  await expect(pdf.getByTestId('po-pdf-pack')).toContainText('กล่อง ละ 12 ม้วน');
  const list = await api<{ data: { id: string; totalAmount: string; items: { productId: string; unitName: string | null; unitFactor: number; quantity: string; unitCost: string; discountType: string; discountValue: string }[] }[] }>(
    'GET', `/purchase-orders?supplierId=${ids.sup}&limit=5`, token,
  );
  const po = list.data[0];
  expect(Number(po.totalAmount)).toBe(333.7);
  expect(po.items.map((i) => [i.productId, i.unitName, i.unitFactor, Number(i.quantity), Number(i.unitCost), i.discountType, Number(i.discountValue)])).toEqual([
    [ids.pipe, null, 1, 3, 42, 'percent', 5],
    [ids.tape, 'กล่อง', 12, 2, 95, 'unit', 2.5],
    [ids.glue, null, 1, 1, 39, 'unit', 0],
  ]);
  ids.po = po.id;
});

test('edit: the stored lines come back with their pack unit and per-unit discount; receiving 1 กล่อง adds 12 ม้วน', async ({ page }) => {
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  const full = await api<{ poNumber: string; items: { id: string; productId: string }[] }>('GET', `/purchase-orders/${ids.po}`, token);
  await page.goto('/purchase-orders');
  await page.locator('tr', { hasText: full.poNumber }).first().click();
  const detail = page.getByRole('dialog').filter({ hasText: `รายละเอียดใบสั่งซื้อ ${full.poNumber}` });
  await expect(detail).toContainText('2 กล่อง');
  await expect(detail).toContainText('= 24 ม้วน');
  await detail.getByRole('button', { name: /แก้ไข/ }).first().click();
  await expect(page.getByTestId('po-grid')).toBeVisible();
  await expect(cell(page, 'unit', 1).locator('option:checked')).toHaveText('กล่อง ×12');
  await expect(cell(page, 'discount', 1)).toHaveValue('2.5');
  await expect(cell(page, 'discount', 0)).toHaveValue('5%');
  await expect(page.getByTestId('po-bill-discount')).toHaveValue('10');
  await expect(page.getByTestId('po-total')).toHaveText('฿333.70');
  await page.getByRole('button', { name: 'ยกเลิกการแก้ไข' }).click();

  // receive one กล่อง (server: base stock + FIFO cost per ม้วน)
  const tapeLine = full.items.find((i) => i.productId === ids.tape)!;
  await api('POST', `/purchase-orders/${ids.po}/issue`, token);
  const stock0 = (await api<{ computedStock: number }>('GET', `/products/${ids.tape}/stock`, token)).computedStock;
  await api('POST', `/purchase-orders/${ids.po}/receive`, token, { clientReceiptId: `pg-${TAG}-receive-0001`, items: [{ purchaseOrderItemId: tapeLine.id, receivedQty: 1, unitCost: 95 }] });
  expect((await api<{ computedStock: number }>('GET', `/products/${ids.tape}/stock`, token)).computedStock).toBe(Number(stock0) + 12);
  const after = await api<{ stockBatches: { productId: string; quantityReceived: string; unitCost: string }[] }>('GET', `/purchase-orders/${ids.po}`, token);
  const b = after.stockBatches.find((x) => x.productId === ids.tape)!;
  // (2 x (95 - 2.5) = 185, less its share of the 10 bill discount) / 2 / 12
  expect(Number(b.quantityReceived)).toBe(12);
  expect(Number(b.unitCost)).toBeGreaterThan(7.4);
  expect(Number(b.unitCost)).toBeLessThan(7.71);
});

test('product form: category is a searchable dropdown (type, ↓/Enter, Esc keeps the dialog)', async ({ page }) => {
  const cats: string[] = [];
  for (const n of ['ท่อและอุปกรณ์ประปา', 'สีและอุปกรณ์ทาสี', 'ท่อร้อยสายไฟ', 'เครื่องมือช่าง']) {
    const c = await api<{ id: string; name: string }>('POST', '/categories', token, { name: `${n} ${TAG}` });
    cats.push(c.id);
  }
  await uiLogin(page, ADMIN.username, ADMIN.password, { start: 'stay' });
  await page.goto('/products');
  await page.getByRole('button', { name: 'เพิ่มสินค้าใหม่' }).click();
  const form = page.getByRole('dialog').filter({ hasText: 'เพิ่มสินค้าใหม่' });
  const name = `สินค้าหมวดค้นหา ${TAG}`;
  await form.getByLabel('ชื่อสินค้า *').fill(name);
  const box = page.locator('#product-form-category');
  await box.click();
  await page.keyboard.type(`ท่อ`);
  const opts = page.getByTestId('product-form-category-box').getByRole('option');
  await expect(opts.filter({ hasText: TAG })).toHaveCount(2);
  // Esc closes only the list
  await page.keyboard.press('Escape');
  await expect(opts).toHaveCount(0);
  await expect(form).toBeVisible();
  await box.click();
  await page.keyboard.type(`ร้อยสายไฟ ${TAG}`);
  await expect(opts).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter'); // picks; does not save the form
  await expect(box).toHaveValue(new RegExp(`ท่อร้อยสายไฟ ${TAG}`));
  await expect(form).toBeVisible();
  // now Enter saves the product as usual
  await page.keyboard.press('Enter');
  await expect(form).toBeHidden();
  const found = await api<{ data: { id: string; categoryId?: string; category?: { id?: string } | string | null }[] }>('GET', `/products/page?q=${encodeURIComponent(name)}&status=all`, token);
  const id = found.data[0].id;
  const p = await api<{ categoryId: string }>('GET', `/products/${id}`, token);
  expect(p.categoryId).toBe(cats[2]);
});
