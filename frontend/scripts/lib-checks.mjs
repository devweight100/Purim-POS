// Self-checks for pure frontend helpers (no test runner in the frontend).
// Run from frontend/:  node scripts/lib-checks.mjs   (Node >= 22.18 strips the TypeScript types)
import assert from 'node:assert/strict';
import { convertThaiToEnBarcode, barcodeLookupCandidates } from '../src/lib/thai-barcode-converter.ts';
import { calculatePurchaseBill, toBaseUnitLine } from '../src/lib/po-calc.ts';
import { parseProductCSV, csvRowsToProducts, CsvImportError, mapCSVHeader } from '../src/lib/csv-parser.ts';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log('ok -', name);
};

check('ASCII barcodes / SKUs pass through unchanged', () => {
  for (const code of ['RICE-JAS-5KG', 'ABC-123', '1.5L', 'A/B', '8850999000011', 'X+Y']) {
    assert.equal(convertThaiToEnBarcode(code), code);
    assert.deepEqual(barcodeLookupCandidates(code), [code]);
  }
});

check('Thai keyboard layout scans are converted', () => {
  // "8850999" typed on a Kedmanee layout
  assert.equal(convertThaiToEnBarcode('คคถจตตต'), '8850999');
  // shifted digits / letters
  assert.equal(convertThaiToEnBarcode('ๅ/-ภถ'), '12345');
  // raw first, then the conversion
  assert.deepEqual(barcodeLookupCandidates(' คคถจ '), ['คคถจ', '8850']);
});

check('pack-unit PO line -> base units, totals unchanged', () => {
  const pack = { quantity: 2, unitCost: 120, multiplier: 12 };
  const base = toBaseUnitLine(pack);
  assert.deepEqual(base, { quantity: 24, unitCost: 10, discountType: 'baht', discountValue: 0 });

  const cases = [
    { quantity: 3, unitCost: 100, multiplier: 12, discountType: 'percent', discountValue: 5, vatType: 'EXCLUDED', vatRate: 7 },
    { quantity: 1, unitCost: 99.99, multiplier: 7, discountType: 'baht', discountValue: 3, vatType: 'INCLUDED', vatRate: 7 },
    { quantity: 5, unitCost: 250, multiplier: 24, vatType: 'NONE' },
  ];
  for (const line of cases) {
    const b = { ...line, ...toBaseUnitLine(line) };
    assert.equal(b.quantity, line.quantity * line.multiplier);
    const before = calculatePurchaseBill([line], { type: 'baht', value: 10 });
    const after = calculatePurchaseBill([b], { type: 'baht', value: 10 });
    assert.equal(after.totalAmount, before.totalAmount);
    assert.equal(after.vatAmount, before.vatAmount);
    assert.equal(after.subtotalAmount, before.subtotalAmount);
  }
});

check('CSV: exact headers, barcode is not code, unit cost is not unit', () => {
  const col = mapCSVHeader(['barcode', 'code', 'name', 'unit cost', 'unit']);
  assert.equal(col.barcode, 0);
  assert.equal(col.code, 1);
  assert.equal(col.cost, 3);
  assert.equal(col.unit, 4);
  const rows = parseProductCSV('barcode,code,name,unit cost,price,unit\n885001,P-1,Water,7.5,10,ขวด\n');
  assert.equal(rows[0].productCode, 'P-1');
  assert.equal(rows[0].customBarcodeId, '885001');
  assert.equal(rows[0].cost, 7.5);
  assert.equal(rows[0].unit, 'ขวด');
  const [p] = csvRowsToProducts(rows);
  assert.equal(p.costPrice, 7.5);
  assert.equal(p.basePrice, 10);
});

check('CSV: template headers and ";" delimiter', () => {
  const tpl = '﻿รหัสสินค้า,ชื่อสินค้า,บาร์โค้ด,หมวดหมู่,ราคาทุน,ราคา 1 (ทั่วไป),ราคา 2 (สมาชิก),ราคา 3 (ช่าง/ส่ง),ราคา 4 (VIP),ราคา 5 (ตัวแทน),จำนวนสต็อก,หน่วยนับ\nPROD-001,น้ำ,885099900001,เครื่องดื่ม,7.50,10.00,9.00,8.50,8.00,7.80,48,ขวด\n';
  const [r] = parseProductCSV(tpl);
  assert.deepEqual([r.productCode, r.cost, r.priceLevel1, r.priceLevel2, r.priceLevel3, r.priceLevel4, r.priceLevel5, r.stock, r.unit], ['PROD-001', 7.5, 10, 9, 8.5, 8, 7.8, 48, 'ขวด']);
  const [s] = parseProductCSV('code;name;cost;price;stock\nA-1;Rice;"1,250.50";1500;3\nA-2;Salt;7,50;10;1\n');
  assert.equal(s.productCode, 'A-1');
  assert.equal(s.cost, 1250.5);
  assert.equal(parseProductCSV('code;name;cost\nA-2;Salt;7,50\n')[0].cost, 7.5);
  // blank cells stay undefined (import keeps the current value)
  assert.equal(parseProductCSV('code,name,cost\nA-3,X,\n')[0].cost, undefined);
});

check('CSV: negative or invalid numbers are rejected with the row number', () => {
  assert.throws(() => parseProductCSV('code,name,stock\nA,a,1\nB,b,-5\n'), (e) => e instanceof CsvImportError && /แถวที่ 3/.test(e.message));
  assert.throws(() => parseProductCSV('code,name,cost\nA,a,-3\n'), CsvImportError);
  assert.throws(() => parseProductCSV('code,name,price\nA,a,abc\n'), CsvImportError);
  assert.throws(() => parseProductCSV('code,name,stock\nA,a,2.5\n'), CsvImportError);
});

console.log(`\n${passed} checks passed`);
