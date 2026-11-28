import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { ADMIN } from './env';
import { api, apiLogin, uiLogin } from './helpers';
import { horizontalOverflow, SIZES, spacingIssues } from './layout';

/**
 * Product supplier, cost & barcode unification + Excel import / export (docs/product-supplier-excel.md):
 * 1. Separate "บาร์โค้ดทั้งหมด" section is gone; supplier rows hold barcode(s) + cost + invoice name/code.
 *    Existing unassigned multi-barcodes appear as separate rows waiting for supplier & cost; scanner Enter in a
 *    supplier barcode moves focus to cost instead of submitting the form.
 * 2. "ผู้จำหน่าย & ต้นทุน (Excel)" exports products with permanent `รหัสระบบ (ห้ามแก้ไข)`, downloads template,
 *    and imports back matching by `รหัสระบบ (ห้ามแก้ไข)` even after SKU changes, warning on new suppliers,
 *    updating cost by mode, and registering supplier barcodes for POS scanning.
 */
test.describe.configure({ mode: 'serial' });

const TAG = String(Date.now()).slice(-6);
const BC1 = `88541${TAG}01`;
const BC2 = `88541${TAG}02`;
const BC3 = `88541${TAG}03`;
const BC_EXCEL = `69041${TAG}99`;
const PROD_MULTI = `ชุดตัวต่อแม่เหล็กเสริมทักษะ ${TAG}`;
const PROD_EXCEL = `ข้อต่อสามทาง PVC หนา ${TAG}`;
const SUP_A = `บจก. สยามของเล่น ${TAG}`;
const SUP_B = `หจก. รวมวัสดุ ${TAG}`;
const SUP_EXCEL_NEW = `บจก. นำเข้าใหม่จากเอ็กเซล ${TAG}`;

let token = '';
let supAId = '';
let supBId = '';
let prodMultiId = '';
let prodExcelId = '';

test.beforeAll(async () => {
  token = await apiLogin(ADMIN);
  supAId = (await api<{ id: string }>('POST', '/suppliers', token, { name: SUP_A, creditTerms: 30 })).id;
  supBId = (await api<{ id: string }>('POST', '/suppliers', token, { name: SUP_B, creditTerms: 15 })).id;

  // Product with 3 barcodes and NO suppliers yet (owner's exact scenario)
  prodMultiId = (
    await api<{ id: string }>('POST', '/products', token, {
      name: PROD_MULTI,
      basePrice: 199,
      priceLevel1: 199,
      costPrice: 110,
      unit: 'กล่อง',
      stockQuantity: 10,
      barcodes: [BC1, BC2, BC3],
    })
  ).id;

  // Product with 0 cost and 0 suppliers to populate via exported Excel + permanent systemId
  prodExcelId = (
    await api<{ id: string }>('POST', '/products', token, {
      name: PROD_EXCEL,
      sku: `SKU-OLD-${TAG}`,
      basePrice: 35,
      priceLevel1: 35,
      costPrice: 0,
      unit: 'ตัว',
      stockQuantity: 25,
    })
  ).id;
});

async function loginToProducts(page: Page) {
  await uiLogin(page, ADMIN.username, ADMIN.password);
  await page.goto('/products');
}

test('product form: no separate BarcodesSection; 3 unassigned barcodes show in supplier section waiting for supplier & cost; scanner Enter moves to cost', async ({
  page,
}) => {
  await loginToProducts(page);

  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    expect(await horizontalOverflow(page), `products page overflow at ${size.width}`).toEqual([]);
    expect(await spacingIssues(page), `products page spacing at ${size.width}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1366, height: 768 });

  await page.getByPlaceholder('ค้นหาชื่อ, รหัส, บาร์โค้ด...').fill(PROD_MULTI);
  await page.locator('tr', { hasText: PROD_MULTI }).getByRole('button', { name: `จัดการสินค้า ${PROD_MULTI}` }).click();
  await page.getByRole('menuitem', { name: 'แก้ไข' }).click();

  const dlg = page.getByRole('dialog').filter({ hasText: 'แก้ไขสินค้า' });
  await expect(dlg).toBeVisible();
  // Old separate barcode section is gone
  await expect(dlg.getByRole('button', { name: /บาร์โค้ดทั้งหมด/ })).toHaveCount(0);
  await expect(dlg.getByRole('button', { name: /ผู้จำหน่าย บาร์โค้ด และต้นทุน/ })).toBeVisible();
  await expect(dlg).toContainText('3 บาร์โค้ดรอระบุผู้จำหน่าย');

  // All 3 barcodes are listed as separate rows with blank supplier & cost
  const rows = dlg.getByTestId('supplier-entry');
  await expect(rows).toHaveCount(3);
  await expect(dlg.getByLabel('บาร์โค้ด ผู้จำหน่าย 1')).toHaveValue(BC1);
  await expect(dlg.getByLabel('บาร์โค้ด ผู้จำหน่าย 2')).toHaveValue(BC2);
  await expect(dlg.getByLabel('บาร์โค้ด ผู้จำหน่าย 3')).toHaveValue(BC3);
  await expect(dlg.getByLabel('ผู้จำหน่าย 1', { exact: true })).toHaveValue('');
  await expect(dlg.getByLabel('ต้นทุน/ชิ้น ผู้จำหน่าย 1')).toHaveValue('');

  // Assign Supplier A to row 1, test scanner Enter jumping to cost without saving the form!
  await dlg.getByLabel('ผู้จำหน่าย 1', { exact: true }).selectOption(supAId);
  await dlg.getByLabel('บาร์โค้ด ผู้จำหน่าย 1').focus();
  await page.keyboard.press('Enter');
  await expect(dlg.getByLabel('ต้นทุน/ชิ้น ผู้จำหน่าย 1')).toBeFocused();
  await expect(dlg).toBeVisible();
  await page.keyboard.type('105');

  // Assign Supplier B to row 2, leave row 3 unassigned
  await dlg.getByLabel('ผู้จำหน่าย 2', { exact: true }).selectOption(supBId);
  await dlg.getByLabel('ต้นทุน/ชิ้น ผู้จำหน่าย 2').fill('100');

  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    expect(await horizontalOverflow(page), `edit dialog overflow at ${size.width}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1366, height: 768 });

  await dlg.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
  await expect(dlg).toBeHidden();

  // Verify backend saved both suppliers + their barcodes AND kept unassigned BC3 scannable!
  const saved = await api<{
    barcodes: { barcode: string }[];
    supplierEntries: { supplierId: string; barcodes: string[]; unitCost: number }[];
  }>('GET', `/products/${prodMultiId}`, token);
  expect(saved.supplierEntries.map((s) => [s.supplierId, s.barcodes, Number(s.unitCost)])).toEqual([
    [supAId, [BC1], 105],
    [supBId, [BC2], 100],
  ]);
  expect(saved.barcodes.map((b) => b.barcode).sort()).toEqual([BC1, BC2, BC3].sort());

  // Reopen edit: 2 linked rows + 1 unassigned row (BC3) still waiting for supplier
  await page.locator('tr', { hasText: PROD_MULTI }).getByRole('button', { name: `จัดการสินค้า ${PROD_MULTI}` }).click();
  await page.getByRole('menuitem', { name: 'แก้ไข' }).click();
  await expect(dlg.getByTestId('supplier-entry')).toHaveCount(3);
  await expect(dlg.getByLabel('บาร์โค้ด ผู้จำหน่าย 3')).toHaveValue(BC3);
  await expect(dlg.getByLabel('ผู้จำหน่าย 3', { exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
});

test('supplier Excel: export with PIN carries รหัสระบบ (ห้ามแก้ไข), matches after SKU rename, creates new supplier, updates zero cost, scans on POS', async ({
  page,
}) => {
  await loginToProducts(page);
  await page.getByTestId('supplier-excel-btn').click();
  const dlg = page.getByTestId('supplier-excel-dialog');
  await expect(dlg).toBeVisible();

  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    expect(await horizontalOverflow(page), `supplier excel dialog overflow at ${size.width}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1366, height: 768 });

  // 1. Download template
  const tplDownloadPromise = page.waitForEvent('download');
  await dlg.getByTestId('supplier-template-btn').click();
  const tplDownload = await tplDownloadPromise;
  const tplPath = test.info().outputPath('supplier-template.xlsx');
  await tplDownload.saveAs(tplPath);
  const tplWb = XLSX.readFile(tplPath);
  expect(tplWb.SheetNames).toEqual(['ผู้จำหน่ายสินค้า', 'รายชื่อผู้จำหน่าย', 'วิธีกรอก']);

  // 2. Export current products (with manager PIN) -> carries permanent systemId
  const expDownloadPromise = page.waitForEvent('download');
  await dlg.getByTestId('supplier-export-submit').click();
  const pinDlg = page.getByRole('dialog').filter({ hasText: 'PIN' });
  await expect(pinDlg).toBeVisible();
  await page.keyboard.type(ADMIN.pin, { delay: 90 });
  await page.keyboard.press('Enter');
  const expDownload = await expDownloadPromise;
  const expPath = test.info().outputPath('supplier-export.xlsx');
  await expDownload.saveAs(expPath);

  const expWb = XLSX.readFile(expPath);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(expWb.Sheets['ผู้จำหน่ายสินค้า'], { defval: '' });
  const targetRow = rows.find((r) => r['รหัสระบบ (ห้ามแก้ไข)'] === prodExcelId);
  expect(targetRow).toBeTruthy();
  expect(targetRow!['รหัสสินค้า (SKU)']).toBe(`SKU-OLD-${TAG}`);

  // Rename the product's SKU on the server BEFORE importing the Excel file back -> tests permanent systemId matching!
  await api('PATCH', `/products/${prodExcelId}`, token, { sku: `SKU-RENAMED-${TAG}` });

  // Fill in new supplier + barcode + cost on targetRow, leaving all other exported rows untouched
  targetRow!['ชื่อผู้จำหน่าย'] = SUP_EXCEL_NEW;
  targetRow!['บาร์โค้ดของผู้จำหน่ายนี้'] = BC_EXCEL;
  targetRow!['ต้นทุนต่อหน่วย'] = 21.5;
  targetRow!['ชื่อสินค้าของผู้ขาย'] = `สามทางหนาพิเศษ ${TAG}`;
  targetRow!['รหัสสินค้าของผู้ขาย'] = `T3-${TAG}`;

  const editedPath = test.info().outputPath('supplier-edited.xlsx');
  const newSheet = XLSX.utils.json_to_sheet(rows);
  expWb.Sheets['ผู้จำหน่ายสินค้า'] = newSheet;
  XLSX.writeFile(expWb, editedPath);

  // 3. Re-open Supplier Excel dialog & upload the edited file
  await page.getByTestId('supplier-excel-btn').click();
  await expect(dlg).toBeVisible();
  await page.getByTestId('supplier-excel-file').setInputFiles(editedPath);

  // Preview shows matched by รหัสระบบ + new supplier warning banner + no horizontal overflow
  await expect(dlg.getByTestId('supplier-import-new-suppliers')).toContainText(SUP_EXCEL_NEW);
  await expect(dlg).toContainText('จับคู่ด้วยรหัสระบบ');
  await expect(dlg).toContainText(`SKU-RENAMED-${TAG}`);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    expect(await horizontalOverflow(page), `supplier preview overflow at ${size.width}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1366, height: 768 });

  // Confirm with Enter
  await expect(dlg.getByTestId('supplier-import-confirm')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();

  // Verify database state: costPrice updated from 0 -> 21.5, supplier created & linked, barcode scannable!
  const updatedProd = await api<{
    costPrice: string;
    supplierEntries: { supplierName: string; barcodes: string[]; unitCost: number; supplierSku: string }[];
  }>('GET', `/products/${prodExcelId}`, token);
  expect(Number(updatedProd.costPrice)).toBe(21.5);
  expect(updatedProd.supplierEntries).toHaveLength(1);
  expect(updatedProd.supplierEntries[0]).toMatchObject({
    supplierName: SUP_EXCEL_NEW,
    barcodes: [BC_EXCEL],
    unitCost: 21.5,
    supplierSku: `T3-${TAG}`,
  });

  // 4. Verify POS finds the product by the newly imported supplier barcode!
  expect((await api<{ id: string }>('GET', `/products/barcode/${BC_EXCEL}`, token)).id).toBe(prodExcelId);
});
