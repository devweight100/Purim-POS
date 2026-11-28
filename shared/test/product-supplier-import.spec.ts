import {
  computeAverageSupplierCost,
  normalizeBarcodeCode,
  parseSupplierImportRow,
  splitBarcodeList,
  supplierImportColumnOf,
} from '../src/product-supplier-import';

describe('shared/product-supplier-import', () => {
  it('maps template headers and common aliases to canonical column keys', () => {
    expect(supplierImportColumnOf('รหัสระบบ (ห้ามแก้ไข)')).toBe('systemId');
    expect(supplierImportColumnOf('รหัสระบบ (System ID - ห้ามแก้ไข)')).toBe('systemId');
    expect(supplierImportColumnOf('รหัสสินค้า (SKU)')).toBe('sku');
    expect(supplierImportColumnOf('ชื่อผู้จำหน่าย *')).toBe('supplierName');
    expect(supplierImportColumnOf('บาร์โค้ดของผู้จำหน่ายนี้')).toBe('supplierBarcodes');
    expect(supplierImportColumnOf('ต้นทุนต่อหน่วย')).toBe('unitCost');
    expect(supplierImportColumnOf('คำสั่ง')).toBe('command');
    expect(supplierImportColumnOf('คอลัมน์แปลก')).toBeNull();
  });

  it('normalizes scientific notation barcodes and splits comma-separated barcode lists', () => {
    expect(normalizeBarcodeCode('8.85871E+12')).toBe('8858710000000');
    expect(normalizeBarcodeCode(8850123000011)).toBe('8850123000011');
    expect(normalizeBarcodeCode("'08851234")).toBe('08851234');
    expect(splitBarcodeList('885001, 885002 ; 885001\n8.85E+12')).toEqual([
      '885001',
      '885002',
      '8850000000000',
    ]);
  });

  it('parses valid upsert and delete rows and skips untouched unlinked export rows', () => {
    const ok = parseSupplierImportRow({
      rowNo: 2,
      values: {
        systemId: 'prod-uuid-1',
        sku: 'SKU-01',
        supplierName: '  บริษัท ก. ทอยส์   จำกัด ',
        supplierBarcodes: '885111, 885222',
        unitCost: '1,250.50',
        supplierProductName: 'รถบังคับ 4WD',
        supplierSku: 'SUP-RC01',
        isPreferred: 'ใช่',
      },
    });
    expect(ok.errors).toEqual([]);
    expect(ok.data).toEqual({
      systemId: 'prod-uuid-1',
      sku: 'SKU-01',
      supplierName: 'บริษัท ก. ทอยส์ จำกัด',
      supplierBarcodes: ['885111', '885222'],
      unitCost: 1250.5,
      supplierProductName: 'รถบังคับ 4WD',
      supplierSku: 'SUP-RC01',
      isPreferred: true,
      command: 'upsert',
    });

    const del = parseSupplierImportRow({
      rowNo: 3,
      values: { systemId: 'prod-uuid-1', supplierName: 'บริษัท ก. ทอยส์ จำกัด', command: 'ลบ' },
    });
    expect(del.errors).toEqual([]);
    expect(del.data.command).toBe('delete');

    // Untouched unlinked export row: has systemId/sku/barcode, blank supplierName & cost -> skipBlankSupplier
    const untouched = parseSupplierImportRow({
      rowNo: 4,
      values: { systemId: 'prod-uuid-2', sku: 'SKU-02', productName: 'สินค้ายังไม่มีซัพ', supplierBarcodes: '885999' },
    });
    expect(untouched.errors).toEqual([]);
    expect(untouched.data.skipBlankSupplier).toBe(true);

    // Filled cost without supplierName -> error
    const missingSup = parseSupplierImportRow({
      rowNo: 5,
      values: { systemId: 'prod-uuid-2', unitCost: '45' },
    });
    expect(missingSup.errors).toContain('กรุณาระบุชื่อผู้จำหน่าย');
  });

  it('rejects missing product identifiers, invalid costs, and bad commands', () => {
    const bad = parseSupplierImportRow({
      rowNo: 6,
      values: {
        supplierName: 'บจก. ทดสอบ',
        unitCost: '-10',
        command: 'แก้ไขมั่ว',
        isPreferred: 'อาจจะ',
      },
    });
    expect(bad.errors.length).toBe(4);
  });

  it('computes average supplier cost ignoring blanks and zeros', () => {
    expect(computeAverageSupplierCost([10, '12.5', 0, null, undefined, ''])).toBe(11.25);
    expect(computeAverageSupplierCost([0, null, ''])).toBeNull();
  });
});
