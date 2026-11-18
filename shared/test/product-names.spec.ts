/** Product name rules (docs/product-names.md). Runs under backend jest and frontend vitest. */
import {
  NAME_LIMITS,
  cleanNameField,
  docLineName,
  matchesOtherNames,
  normDocNameMode,
  searchMatchHint,
} from '../src/product-names';

const product = {
  name: 'ท่อพีวีซี 1 นิ้ว ตราช้าง',
  sku: '2000000000017',
  manufacturerName: 'SCG PVC Pipe Class 8.5 1"',
  supplierEntries: [
    { supplierId: 's1', supplierProductName: 'ท่อ PVC 8.5 1นิ้ว (ฟ้า)', supplierSku: 'PV-0185' },
    { supplierId: 's2', supplierProductName: null, supplierSku: 'X-77' },
    { supplierId: 's3', supplierProductName: '', supplierSku: '' },
  ],
};

describe('cleanNameField', () => {
  it('trims, collapses spaces, blank = null, undefined unchanged', () => {
    expect(cleanNameField('  SCG   Pipe  ', 'manufacturerName')).toEqual({ value: 'SCG Pipe' });
    expect(cleanNameField('   ', 'supplierSku')).toEqual({ value: null });
    expect(cleanNameField(null, 'supplierSku')).toEqual({ value: null });
    expect(cleanNameField(undefined, 'supplierSku')).toEqual({ value: undefined });
    expect(cleanNameField(12345, 'supplierSku')).toEqual({ value: '12345' });
  });
  it('rejects values over the limit and non-text', () => {
    expect(cleanNameField('ก'.repeat(NAME_LIMITS.manufacturerName), 'manufacturerName').error).toBeUndefined();
    expect(cleanNameField('ก'.repeat(NAME_LIMITS.manufacturerName + 1), 'manufacturerName').error).toBe('ชื่อผู้ผลิตยาวเกิน 200 ตัวอักษร');
    expect(cleanNameField('A'.repeat(101), 'supplierSku').error).toBe('รหัสสินค้าของผู้ขายยาวเกิน 100 ตัวอักษร');
    expect(cleanNameField({}, 'supplierProductName').error).toBe('ชื่อสินค้าของผู้ขายต้องเป็นข้อความ');
  });
});

describe('docLineName', () => {
  it('SHOP mode: always the shop name, no code', () => {
    expect(docLineName('SHOP', product, 's1')).toEqual({ name: product.name, code: null, source: 'shop' });
    expect(docLineName(undefined, product, 's1').name).toBe(product.name);
    expect(normDocNameMode('bogus')).toBe('SHOP');
  });
  it('SUPPLIER mode: supplier name + code, else manufacturer (+ code), else shop name', () => {
    expect(docLineName('SUPPLIER', product, 's1')).toEqual({ name: 'ท่อ PVC 8.5 1นิ้ว (ฟ้า)', code: 'PV-0185', source: 'supplier' });
    expect(docLineName('SUPPLIER', product, 's2')).toEqual({ name: 'SCG PVC Pipe Class 8.5 1"', code: 'X-77', source: 'manufacturer' });
    expect(docLineName('SUPPLIER', product, 's3')).toEqual({ name: 'SCG PVC Pipe Class 8.5 1"', code: null, source: 'manufacturer' });
    expect(docLineName('SUPPLIER', product, 'other')).toEqual({ name: 'SCG PVC Pipe Class 8.5 1"', code: null, source: 'manufacturer' });
    const plain = { name: 'ข้อต่อตรง', suppliers: [{ supplierId: 's1', supplierSku: 'C-1' }] };
    expect(docLineName('SUPPLIER', plain, 's1')).toEqual({ name: 'ข้อต่อตรง', code: 'C-1', source: 'shop' });
    expect(docLineName('SUPPLIER', plain, null)).toEqual({ name: 'ข้อต่อตรง', code: null, source: 'shop' });
  });
  it('a line snapshot name overrides the product name', () => {
    expect(docLineName('SHOP', product, 's1', 'ชื่อในใบคืน').name).toBe('ชื่อในใบคืน');
    expect(docLineName('SUPPLIER', { name: 'x' }, 's1', 'ชื่อในใบคืน').name).toBe('ชื่อในใบคืน');
  });
});

describe('search hints', () => {
  it('matches the manufacturer name and supplier names / codes, any case', () => {
    expect(matchesOtherNames(product, 'scg pvc')).toBe(true);
    expect(matchesOtherNames(product, 'pv-0185')).toBe(true);
    expect(matchesOtherNames(product, '(ฟ้า)')).toBe(true);
    expect(matchesOtherNames(product, 'ตราช้าง')).toBe(false);
    expect(matchesOtherNames(product, '  ')).toBe(false);
  });
  it('hint names the field that matched; none when the shop name / SKU matched', () => {
    expect(searchMatchHint(product, 'SCG')).toBe('ผู้ผลิต: SCG PVC Pipe Class 8.5 1"');
    expect(searchMatchHint(product, '1นิ้ว')).toBe('ชื่อผู้ขาย: ท่อ PVC 8.5 1นิ้ว (ฟ้า)');
    expect(searchMatchHint(product, 'x-77')).toBe('รหัสผู้ขาย: X-77');
    expect(searchMatchHint(product, 'ตราช้าง')).toBeNull();
    expect(searchMatchHint(product, '20000000')).toBeNull();
    expect(searchMatchHint(product, 'zzz')).toBeNull();
  });
  it('every-word search: the first word not in the shop name', () => {
    expect(searchMatchHint(product, 'ท่อ pv-0185')).toBe('รหัสผู้ขาย: PV-0185');
  });
});
