import { describe, expect, it } from 'vitest';
import {
  CsvImportError,
  csvRowsToProducts,
  detectCSVDelimiter,
  mapCSVHeader,
  normalizeProductIdentifier,
  parseCSVLines,
  parseProductCSV,
} from '@/lib/csv-parser';

describe('normalizeProductIdentifier', () => {
  it('trims, strips BOM / quotes / spaces', () => {
    expect(normalizeProductIdentifier('﻿"ABC 123"')).toBe('ABC123');
    expect(normalizeProductIdentifier("'0012")).toBe('0012');
    expect(normalizeProductIdentifier(null)).toBe('');
  });
  it('expands Excel scientific notation of barcodes', () => {
    expect(normalizeProductIdentifier('8.85E+12')).toBe('8850000000000');
    expect(normalizeProductIdentifier('8.850001111111E+12')).toBe('8850001111111');
    expect(normalizeProductIdentifier('1.5e-3')).toBe('0.0015');
  });
  it('keeps codes that only contain an E', () => {
    expect(normalizeProductIdentifier('E-100')).toBe('E-100');
    expect(normalizeProductIdentifier('ABC-E12')).toBe('ABC-E12');
  });
});

describe('CSV lines', () => {
  it('detects the delimiter from the header line, ignoring quoted text', () => {
    expect(detectCSVDelimiter('a,b,c\n1;2;3;4')).toBe(',');
    expect(detectCSVDelimiter('a;b;"c,d,e"\n')).toBe(';');
    expect(detectCSVDelimiter('a\tb\tc')).toBe('\t');
    expect(detectCSVDelimiter('single')).toBe(',');
  });

  it('handles quotes, escaped quotes, CRLF and newlines inside fields', () => {
    const rows = parseCSVLines('code,name\r\nA1,"Hello, ""world"""\r\nA2,"two\nlines"\r\n');
    expect(rows).toEqual([
      ['code', 'name'],
      ['A1', 'Hello, "world"'],
      ['A2', 'two\nlines'],
    ]);
  });

  it('last line without newline', () => {
    expect(parseCSVLines('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('mapCSVHeader', () => {
  it('matches exact aliases, bracket parts, Thai and English', () => {
    const col = mapCSVHeader(['รหัสสินค้า', 'Barcode', 'ชื่อสินค้า', 'ราคาทุน (Cost Price)', 'ราคา 1 (ทั่วไป)', 'Price 2', 'หน่วย', 'Stock']);
    expect(col).toMatchObject({ code: 0, barcode: 1, name: 2, cost: 3, price1: 4, price2: 5, unit: 6, stock: 7, category: -1 });
  });
  it('"barcode" is not read as "code" and "unit cost" is not "unit"', () => {
    const col = mapCSVHeader(['barcode', 'unit cost']);
    expect(col.code).toBe(-1);
    expect(col.unit).toBe(-1);
    expect(col.barcode).toBe(0);
    expect(col.cost).toBe(1);
  });
});

describe('parseProductCSV', () => {
  it('parses rows; blank cells stay undefined; code and barcode are separate', () => {
    const rows = parseProductCSV(
      'รหัสสินค้า,ชื่อสินค้า,บาร์โค้ด,ราคาทุน,ราคาขาย,ราคาสมาชิก,สต็อก,หน่วย,หมวดหมู่\n' +
        'RICE-JAS-5KG,ข้าวหอมมะลิ 5 กก.,8.85E+12,150,"1,190",,12,ถุง,ข้าว\n' +
        ',,,,,,,,\n' +
        'NOBAR,ไม่มีบาร์โค้ด,,,25,,,,\n',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      productCode: 'RICE-JAS-5KG',
      productName: 'ข้าวหอมมะลิ 5 กก.',
      customBarcodeId: '8850000000000',
      cost: 150,
      priceLevel1: 1190,
      price: 1190,
      priceLevel2: undefined,
      stock: 12,
      unit: 'ถุง',
      category: 'ข้าว',
    });
    expect(rows[1].customBarcodeId).toBe('');
    expect(rows[1].barcodeForSelling).toBe('');
    expect(rows[1].cost).toBeUndefined();
    expect(rows[1].stock).toBeUndefined();
  });

  it('semicolon files read a decimal comma', () => {
    const rows = parseProductCSV('code;name;price\nA;Apple;7,50\n');
    expect(rows[0].priceLevel1).toBe(7.5);
  });

  it('rejects negative and non-numeric amounts naming the row', () => {
    expect(() => parseProductCSV('code,name,price\nA,Apple,-1\n')).toThrow(/แถวที่ 2/);
    expect(() => parseProductCSV('code,name,cost\nA,Apple,x\nB,B,1\n')).toThrow(CsvImportError);
  });

  it('requires a code / name / barcode column', () => {
    expect(() => parseProductCSV('foo,bar\n1,2\n')).toThrow(CsvImportError);
    expect(parseProductCSV('')).toEqual([]);
  });
});

describe('csvRowsToProducts', () => {
  it('selling price goes to basePrice (never the cost), barcode only when given', () => {
    const [p] = csvRowsToProducts(parseProductCSV('code,name,cost,price,barcode,unit\nA-1,Apple,4,7,885,ลูก\n'));
    expect(p).toMatchObject({ id: 'A-1', sku: 'A-1', basePrice: 7, costPrice: 4, priceLevel1: 7, unit: 'ลูก' });
    expect(p.barcodes).toEqual([{ barcode: '885' }]);
    expect(p.units[0]).toMatchObject({ factor: 1, price: 7, barcode: '885' });
    const [q] = csvRowsToProducts(parseProductCSV('code,name\nB,Banana\n'));
    expect(q.barcodes).toEqual([]);
    expect(q.basePrice).toBe(0);
  });
});
