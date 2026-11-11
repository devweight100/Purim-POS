import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  COL,
  ImportFileError,
  UNITS_SHEET,
  buildExportWorkbook,
  buildTemplateWorkbook,
  isUnitsFormat,
  packChainText,
  parseUnitsRows,
} from '@/lib/product-import';

/** Write the workbook to bytes and read it back like the import page does. */
function readBack(wb: XLSX.WorkBook) {
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const back = XLSX.read(bytes, { type: 'array' });
  const ws = back.Sheets[UNITS_SHEET];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  const headers = (XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0] || []).map(String);
  return { back, rows, headers };
}

const headers = Object.values(COL) as string[];
const row = (o: Partial<Record<keyof typeof COL, unknown>>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [COL[k as keyof typeof COL], v]));

describe('template', () => {
  it('round trips: template -> xlsx -> parse gives grouped products with pack units and stock totals', () => {
    const { back, rows, headers: h } = readBack(buildTemplateWorkbook(XLSX));
    expect(back.SheetNames).toEqual([UNITS_SHEET, 'วิธีกรอก']);
    expect(isUnitsFormat(h)).toBe(true);

    const products = parseUnitsRows(rows, h);
    expect(products.map((p) => p.sku)).toEqual(['DRK-001', 'NDL-001', 'CEM-050']);

    const water = products[0];
    expect(water).toMatchObject({ name: 'น้ำดื่มตราช้าง 600 มล.', unit: 'ขวด', barcode: '8850001111111', costPrice: 4.5, priceLevel1: 7 });
    expect(water.packagingUnits).toEqual([
      expect.objectContaining({ name: 'แพ็ค', qtyPerPrev: 6, barcode: '8850001111128', priceLevel1: 39, priceLevel2: 38 }),
      expect.objectContaining({ name: 'ลัง', qtyPerPrev: 2, barcode: '8850001111135', priceLevel1: 75 }),
    ]);
    // 5 ลัง x 12 + 3 แพ็ค x 6 + 10 ขวด
    expect(water.stock).toBe(88);
    expect(water.stockNote).toContain('= 88 ขวด');

    const noodles = products[1];
    expect(noodles.barcode).toBe('8850002222222');
    expect(noodles.barcodes).toEqual(['8850002222239']);
    // 24 ซอง + 4 ลัง x (10 x 3)
    expect(noodles.stock).toBe(144);

    const cement = products[2];
    expect(cement.packagingUnits).toEqual([]);
    expect(cement.stock).toBe(40);
    expect(cement.stockNote).toBeUndefined();
  });
});

describe('export', () => {
  it('export -> parse gives back the same products', () => {
    const source = [
      {
        id: 'p-1',
        sku: 'DRK-001',
        name: 'น้ำดื่ม',
        category: { name: 'เครื่องดื่ม' },
        unit: 'ขวด',
        barcode: '111',
        barcodes: [{ barcode: '111' }, { barcode: '112' }, { barcode: '222' }],
        costPrice: 4.5,
        priceLevel1: 7,
        priceLevel2: 6.5,
        stock: 88,
        description: 'desc',
        packagingUnits: [
          { name: 'แพ็ค', qtyPerPrev: 6, barcode: '222', priceLevel1: 39 },
          { name: 'ลัง', qtyPerPrev: 2, barcode: null, priceLevel1: 75 },
        ],
      },
    ];
    const { rows, headers: h } = readBack(buildExportWorkbook(XLSX, source, { withCost: true }));
    const [p] = parseUnitsRows(rows, h);
    expect(p).toMatchObject({
      id: 'p-1',
      sku: 'DRK-001',
      name: 'น้ำดื่ม',
      categoryName: 'เครื่องดื่ม',
      barcode: '111',
      barcodes: ['112'], // the pack barcode is not a base barcode
      costPrice: 4.5,
      priceLevel1: 7,
      priceLevel2: 6.5,
      stock: 88,
      description: 'desc',
    });
    expect(p.packagingUnits.map((u) => [u.name, u.qtyPerPrev, u.barcode, u.priceLevel1])).toEqual([
      ['แพ็ค', 6, '222', 39],
      ['ลัง', 2, null, 75],
    ]);
  });

  it('without cost permission the cost column is empty', () => {
    const { rows, headers: h } = readBack(buildExportWorkbook(XLSX, [{ sku: 'A', name: 'A', costPrice: 9, priceLevel1: 10 }], { withCost: false }));
    expect(parseUnitsRows(rows, h)[0].costPrice).toBeUndefined();
  });
});

describe('parseUnitsRows', () => {
  it('a pack row without price 1 gets base price x units (chained)', () => {
    const [p] = parseUnitsRows(
      [row({ sku: 'X', name: 'X', unit: 'ชิ้น', p1: 2.5 }), row({ sku: 'X', unit: 'แพ็ค', perPrev: 4 }), row({ sku: 'X', unit: 'ลัง', perPrev: 3 })],
      headers,
    );
    expect(p.packagingUnits.map((u) => u.priceLevel1)).toEqual([10, 30]);
    expect(p.stock).toBeUndefined();
  });

  it('SKU grouping is case-insensitive and skips empty lines; rows without SKU are separate products', () => {
    const products = parseUnitsRows(
      [
        row({ sku: 'abc', name: 'A', unit: 'ชิ้น' }),
        row({}),
        row({ sku: 'ABC', unit: 'แพ็ค', perPrev: 6 }),
        row({ name: 'No sku 1', unit: 'ชิ้น' }),
        row({ name: 'No sku 2', unit: 'ชิ้น' }),
      ],
      headers,
    );
    expect(products).toHaveLength(3);
    expect(products[0].packagingUnits).toHaveLength(1);
    expect(products[1].rowNo).toBe(5);
  });

  it('stock 0 is set explicitly', () => {
    const [p] = parseUnitsRows([row({ sku: 'Z', name: 'Z', unit: 'ชิ้น', stock: 0 })], headers);
    expect(p.stock).toBe(0);
  });

  it.each([
    ['first row is not the smallest unit', [row({ sku: 'A', name: 'A', unit: 'แพ็ค', perPrev: 6 })], /แถวที่ 2: แถวแรก/],
    ['pack row without per-prev', [row({ sku: 'A', name: 'A', unit: 'ชิ้น' }), row({ sku: 'A', unit: 'แพ็ค' })], /แถวที่ 3/],
    ['per-prev below 2', [row({ sku: 'A', name: 'A', unit: 'ชิ้น' }), row({ sku: 'A', unit: 'แพ็ค', perPrev: 1 })], /ต้องไม่ต่ำกว่า 2/],
    ['duplicate unit name', [row({ sku: 'A', name: 'A', unit: 'ชิ้น' }), row({ sku: 'A', unit: 'ชิ้น', perPrev: 6 })], /ซ้ำ/],
    ['two barcodes on a pack', [row({ sku: 'A', name: 'A', unit: 'ชิ้น' }), row({ sku: 'A', unit: 'แพ็ค', perPrev: 6, barcode: '1,2' })], /บาร์โค้ดได้ 1 ตัว/],
    ['missing name', [row({ sku: 'A', unit: 'ชิ้น' })], /ชื่อสินค้า/],
    ['missing unit', [row({ sku: 'A', name: 'A' })], /หน่วย/],
    ['non-numeric price', [row({ sku: 'A', name: 'A', unit: 'ชิ้น', p1: 'abc' })], /ไม่ใช่ตัวเลข/],
    ['negative cost', [row({ sku: 'A', name: 'A', unit: 'ชิ้น', cost: -1 })], /ต้องไม่ต่ำกว่า 0/],
    ['pack row without SKU', [row({ name: 'A', unit: 'แพ็ค', perPrev: 6 })], /ต้องมี/],
  ])('error: %s', (_label, rows, message) => {
    expect(() => parseUnitsRows(rows as Record<string, unknown>[], headers)).toThrow(ImportFileError);
    expect(() => parseUnitsRows(rows as Record<string, unknown>[], headers)).toThrow(message);
  });

  it('a file without the unit column is rejected', () => {
    expect(() => parseUnitsRows([{ SKU: 'A' }], ['SKU'])).toThrow(ImportFileError);
  });

  it('headers without the bracket part are accepted', () => {
    const h = ['SKU', 'ชื่อสินค้า', 'หน่วย', '1 หน่วยนี้ = ?', 'Barcode', 'ราคาขาย 1'];
    const [p] = parseUnitsRows(
      [
        { SKU: 'A', ชื่อสินค้า: 'A', หน่วย: 'ชิ้น', Barcode: '9', 'ราคาขาย 1': '1,000' },
        { SKU: 'A', หน่วย: 'ลัง', '1 หน่วยนี้ = ?': 10 },
      ],
      h,
    );
    expect(p).toMatchObject({ barcode: '9', priceLevel1: 1000 });
    expect(p.packagingUnits[0]).toMatchObject({ name: 'ลัง', qtyPerPrev: 10, priceLevel1: 10000 });
  });
});

describe('helpers', () => {
  it('isUnitsFormat', () => {
    expect(isUnitsFormat(['SKU', '1 หน่วยนี้ = กี่หน่วยก่อนหน้า'])).toBe(true);
    expect(isUnitsFormat(['SKU', 'ราคา'])).toBe(false);
  });
  it('packChainText', () => {
    expect(packChainText('ขวด', [{ name: 'แพ็ค', qtyPerPrev: 6 }, { name: 'ลัง', qtyPerPrev: 2 }])).toBe('ขวด → แพ็ค (6) → ลัง (2)');
    expect(packChainText('', undefined)).toBe('ชิ้น');
  });
});
