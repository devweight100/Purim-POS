import { describe, expect, it } from 'vitest';
import { calculatePurchaseBill } from '@shared/po-calc';
import {
  blankRow, exactCodeUnit, parseBillDiscount, rowError, rowLine, rowsFromPoItems, rowUnits, stepCell, toApiItems, unitIndex,
  withTrailingBlank, type PoGridProduct, type PoGridRow,
} from './po-grid';

const tape: PoGridProduct = {
  id: 'p1', name: 'เทปพันเกลียว', sku: 'TAPE-01', unit: 'ม้วน', costPrice: 8.5, barcodes: ['885001'],
  packagingUnits: [{ id: 'u-box', name: 'กล่อง', qtyPerPrev: 12, barcode: '885012' }, { id: 'u-crate', name: 'ลัง', qtyPerPrev: 10 }],
};
const row = (patch: Partial<PoGridRow>): PoGridRow => ({ ...blankRow(), product: tape, code: 'TAPE-01', qty: '1', price: '8.5', ...patch });

describe('PO grid rows', () => {
  it('always one empty row at the bottom', () => {
    const a = withTrailingBlank([]);
    expect(a).toHaveLength(1);
    const b = withTrailingBlank([row({}), blankRow(), blankRow()]);
    expect(b).toHaveLength(2);
    expect(b[1].product).toBeNull();
    expect(withTrailingBlank([row({})])).toHaveLength(2);
  });

  it('units: base + packs; a stored pack the product no longer has stays', () => {
    expect(rowUnits(row({})).map((u) => [u.name, u.factor])).toEqual([['ม้วน', 1], ['กล่อง', 12], ['ลัง', 120]]);
    expect(unitIndex(row({ unitId: 'u-crate', unitName: 'ลัง', unitFactor: 120 }))).toBe(2);
    const gone = row({ unitId: 'old', unitName: 'แพ็ค', unitFactor: 6 });
    expect(rowUnits(gone).map((u) => u.name)).toEqual(['ม้วน', 'กล่อง', 'ลัง', 'แพ็ค']);
    expect(unitIndex(gone)).toBe(3);
  });

  it('exact code: SKU any case / barcode -> base unit, pack barcode -> that pack', () => {
    expect(exactCodeUnit(tape, 'tape-01')?.factor).toBe(1);
    expect(exactCodeUnit(tape, '885001')?.factor).toBe(1);
    expect(exactCodeUnit(tape, '885012')).toMatchObject({ id: 'u-box', name: 'กล่อง', factor: 12 });
    expect(exactCodeUnit(tape, '8850')).toBeNull();
  });

  it('line: per-unit discount "5" / "5%", ราคารวม = qty x (price - discount)', () => {
    const lines = [row({ qty: '2', price: '120', discount: '5', unitId: 'u-box', unitName: 'กล่อง', unitFactor: 12 }), row({ qty: '3', price: '100', discount: '10%' })];
    const bill = calculatePurchaseBill(lines.map(rowLine));
    expect(bill.lines.map((l) => l.total)).toEqual([230, 270]);
    expect(toApiItems([...lines, blankRow()])).toEqual([
      { productId: 'p1', quantity: 2, unitCost: 120, unitId: 'u-box', unitName: 'กล่อง', unitFactor: 12, discountType: 'unit', discountValue: 5, vatType: 'NONE', vatRate: 7 },
      { productId: 'p1', quantity: 3, unitCost: 100, unitId: null, unitName: null, unitFactor: 1, discountType: 'percent', discountValue: 10, vatType: 'NONE', vatRate: 7 },
    ]);
  });

  it('errors per cell', () => {
    expect(rowError(row({ qty: '0' }), false)?.col).toBe('qty');
    expect(rowError(row({ qty: '1.5' }), false)?.message).toContain('ทศนิยม');
    expect(rowError(row({ qty: '1.5' }), true)).toBeNull();
    expect(rowError(row({ price: 'x' }), false)?.col).toBe('price');
    expect(rowError(row({ discount: 'abc' }), false)?.col).toBe('discount');
    expect(rowError(row({ discount: '9' }), false)?.message).toContain('มากกว่าราคา');
    expect(rowError({ ...blankRow(), name: 'ท่อ' }, false)?.col).toBe('name');
    expect(rowError(blankRow(), false)).toBeNull();
  });

  it('Enter order: code -> (name only without a product) -> qty -> unit -> price -> discount -> next row code; Shift+Enter back', () => {
    const rows = [row({}), blankRow()];
    const walk: string[] = [];
    let at: { row: number; col: import('./po-grid').GridCol } | null = { row: 0, col: 'code' };
    while (at) {
      walk.push(`${at.row}:${at.col}`);
      at = stepCell(rows, at, 1, false);
    }
    expect(walk).toEqual(['0:code', '0:qty', '0:unit', '0:price', '0:discount', '1:code', '1:name', '1:qty', '1:unit', '1:price', '1:discount']);
    expect(stepCell(rows, { row: 0, col: 'discount' }, 1, true)).toEqual({ row: 0, col: 'vat' });
    expect(stepCell(rows, { row: 1, col: 'code' }, -1, false)).toEqual({ row: 0, col: 'discount' });
    expect(stepCell(rows, { row: 0, col: 'qty' }, -1, false)).toEqual({ row: 0, col: 'code' });
    expect(stepCell(rows, { row: 0, col: 'code' }, -1, false)).toBeNull();
  });

  it('stored lines: units kept, older whole-line discounts per unit when they divide, else kept as they are', () => {
    const rows = rowsFromPoItems([
      { id: 'i1', productId: 'p1', quantity: '2', unitCost: '120', unitId: 'u-box', unitName: 'กล่อง', unitFactor: 12, discountType: 'unit', discountValue: '5', vatType: 'NONE' },
      { id: 'i2', productId: 'p1', quantity: 4, unitCost: 10, discountType: 'baht', discountValue: 6, vatType: 'EXCLUDED', vatRate: 7 },
      { id: 'i3', productId: 'p1', quantity: 3, unitCost: 10, discountType: 'baht', discountValue: 10, vatType: 'NONE' },
    ], new Map([['p1', tape]]));
    expect(rows.map((r) => [r.unitName, r.unitFactor, r.discount, r.legacyDiscount, r.vatType])).toEqual([
      ['กล่อง', 12, '5', null, 'NONE'],
      [null, 1, '1.5', null, 'EXCLUDED'],
      [null, 1, '', 10, 'NONE'],
    ]);
    // the same totals as the stored lines
    expect(calculatePurchaseBill(rows.map(rowLine)).lines.map((l) => l.total)).toEqual([230, 36.38, 20]);
  });

  it('bill discount text', () => {
    expect(parseBillDiscount('100')).toEqual({ type: 'baht', value: 100 });
    expect(parseBillDiscount('5%')).toEqual({ type: 'percent', value: 5 });
    expect(parseBillDiscount('')).toEqual({ type: 'baht', value: 0 });
    expect(parseBillDiscount('x')).toBeNull();
  });
});
