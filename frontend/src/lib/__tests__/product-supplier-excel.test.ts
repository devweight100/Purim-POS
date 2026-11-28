import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildSupplierExportWorkbook,
  buildSupplierTemplateWorkbook,
  readSupplierImportFile,
} from '../product-supplier-excel';
import { productToForm } from '@/components/products/product-helpers';
import { parseSupplierImportRow } from '@shared/product-supplier-import';

describe('product-supplier-excel & unassigned barcode form mapping', () => {
  it('maps existing unassigned barcodes into separate supplierEntries rows with blank supplier and cost', () => {
    const form = productToForm({
      id: 'prod-abc-123',
      name: 'รถบังคับ 4WD',
      sku: '2001234567893',
      barcodes: ['8850001', '8850002', '8850003'],
      supplierEntries: [],
    });
    expect(form.mainBarcode).toBe('8850001');
    expect(form.supplierEntries).toEqual([
      { supplierId: '', barcode: '8850001', lastCost: '', supplierProductName: '', supplierSku: '' },
      { supplierId: '', barcode: '8850002', lastCost: '', supplierProductName: '', supplierSku: '' },
      { supplierId: '', barcode: '8850003', lastCost: '', supplierProductName: '', supplierSku: '' },
    ]);

    // Regression: a product with 0 barcodes (where barcodeForSelling = sku) must NEVER copy sku into mainBarcode!
    const noBcForm = productToForm({
      id: 'prod-no-bc',
      name: 'สินค้าไม่มีบาร์โค้ด',
      sku: '2003953215741',
      barcodeForSelling: '2003953215741',
      barcodes: [],
      supplierEntries: [{ supplierId: 'sup-1', lastCost: 12 }],
    });
    expect(noBcForm.mainBarcode).toBe('');
    expect(noBcForm.supplierEntries).toEqual([
      { supplierId: 'sup-1', barcode: '', lastCost: '12', supplierProductName: '', supplierSku: '' },
    ]);
  });

  it('keeps linked supplier rows and appends remaining unassigned barcodes without duplicating mainBarcode', () => {
    const form = productToForm({
      id: 'prod-abc-456',
      name: 'ท่อ PVC',
      sku: '2009998887771',
      barcodes: ['8850001', '8850002', '8850003'],
      supplierEntries: [
        { supplierId: 'sup-1', lastCost: 45, barcodes: ['8850001'], supplierProductName: 'ท่อฟ้า', supplierSku: 'P-01' },
      ],
    });
    expect(form.mainBarcode).toBe('8850001');
    expect(form.supplierEntries).toEqual([
      { supplierId: 'sup-1', barcode: '8850001', lastCost: '45', supplierProductName: 'ท่อฟ้า', supplierSku: 'P-01' },
      { supplierId: '', barcode: '8850002', lastCost: '', supplierProductName: '', supplierSku: '' },
      { supplierId: '', barcode: '8850003', lastCost: '', supplierProductName: '', supplierSku: '' },
    ]);
  });

  it('builds template workbook and reads it back with exact 13-digit barcodes', () => {
    const wb = buildSupplierTemplateWorkbook(XLSX, [{ id: 's1', name: 'บจก. สยามทอยส์' }]);
    expect(wb.SheetNames).toEqual(['ผู้จำหน่ายสินค้า', 'รายชื่อผู้จำหน่าย', 'วิธีกรอก']);
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const parsed = readSupplierImportFile(XLSX, out, 'template.xlsx');
    expect(parsed.hasSupplierColumn).toBe(true);
    expect(parsed.hasProductKeyColumn).toBe(true);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].values.supplierName).toBe('บจก. สยามทอยส์');
    expect(parsed.rows[1].values.supplierBarcodes).toBe('8850001111111, 6900009998887');
  });

  it('exports products with permanent systemId ("รหัสระบบ (ห้ามแก้ไข)") and unassigned barcode rows for round-trip', () => {
    const wb = buildSupplierExportWorkbook(
      XLSX,
      [
        {
          id: 'sys-uuid-1',
          sku: 'SKU-LINKED',
          name: 'สินค้ามีผู้จำหน่ายแล้ว',
          barcodes: [{ barcode: '8851111111111' }],
          supplierEntries: [
            {
              supplierId: 'sup-1',
              supplierName: 'บจก. เอ',
              unitCost: 88.5,
              barcodes: ['8851111111111'],
              supplierProductName: 'ชื่อบิลเอ',
              supplierSku: 'A-01',
              isPreferred: true,
            },
          ],
        },
        {
          id: 'sys-uuid-2',
          sku: 'SKU-UNLINKED',
          name: 'สินค้ามี 2 บาร์โค้ด รอผูกผู้จำหน่าย',
          barcodes: [{ barcode: '8852222222221' }, { barcode: '8852222222222' }],
          supplierEntries: [],
        },
      ],
      [{ id: 'sup-1', name: 'บจก. เอ' }],
      { withCost: true, includeUnlinked: true },
    );

    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const read = readSupplierImportFile(XLSX, out, 'export.xlsx');
    expect(read.rows).toHaveLength(3);

    // Row 1: linked supplier with systemId
    expect(read.rows[0].values).toMatchObject({
      systemId: 'sys-uuid-1',
      sku: 'SKU-LINKED',
      supplierName: 'บจก. เอ',
      supplierBarcodes: '8851111111111',
      unitCost: '88.5',
      isPreferred: 'ใช่',
    });

    // Rows 2 & 3: unlinked product's 2 barcodes carry systemId and skipBlankSupplier when left unedited
    expect(read.rows[1].values).toMatchObject({
      systemId: 'sys-uuid-2',
      supplierBarcodes: '8852222222221',
    });
    expect(read.rows[2].values).toMatchObject({
      systemId: 'sys-uuid-2',
      supplierBarcodes: '8852222222222',
    });
    expect(parseSupplierImportRow(read.rows[1]).data.skipBlankSupplier).toBe(true);
  });
});
