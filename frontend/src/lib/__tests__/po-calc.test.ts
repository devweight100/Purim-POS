import { describe, expect, it } from 'vitest';
import {
  calculatePurchaseBill,
  grossPerUnit,
  normDiscountType,
  normVatType,
  stockCostPerUnit,
  baseQtyOf,
  defaultPoUnitPrice,
  lineOwnDiscount,
  parseUnitDiscount,
  poUnitOptions,
  unitDiscountText,
  unitFactorOf,
} from '@shared/po-calc';

describe('normalisers', () => {
  it('maps VAT type spellings', () => {
    expect(normVatType('included')).toBe('INCLUDED');
    expect(normVatType('INCLUDE')).toBe('INCLUDED');
    expect(normVatType('exclude')).toBe('EXCLUDED');
    expect(normVatType(undefined)).toBe('NONE');
    expect(normVatType('nonsense')).toBe('NONE');
  });
  it('percent / per unit, anything else is a whole-line baht discount', () => {
    expect(normDiscountType('percent')).toBe('percent');
    expect(normDiscountType('unit')).toBe('unit');
    expect(normDiscountType('baht')).toBe('baht');
    expect(normDiscountType(null)).toBe('baht');
  });
});

describe('calculatePurchaseBill - line discounts', () => {
  it('no discount, no VAT', () => {
    const t = calculatePurchaseBill([{ quantity: 3, unitCost: 12.5 }]);
    expect(t.baseAmount).toBe(37.5);
    expect(t.discountAmount).toBe(0);
    expect(t.subtotalAmount).toBe(37.5);
    expect(t.vatAmount).toBe(0);
    expect(t.totalAmount).toBe(37.5);
  });

  it('percent line discount', () => {
    const t = calculatePurchaseBill([{ quantity: 10, unitCost: 100, discountType: 'percent', discountValue: 10 }]);
    expect(t.lines[0].discountAmount).toBe(100);
    expect(t.lineDiscountAmount).toBe(100);
    expect(t.totalAmount).toBe(900);
  });

  it('baht line discount', () => {
    const t = calculatePurchaseBill([{ quantity: 2, unitCost: 50, discountType: 'baht', discountValue: 15 }]);
    expect(t.totalAmount).toBe(85);
  });

  it('a discount never exceeds the line (percent capped at 100, baht at the amount)', () => {
    const t = calculatePurchaseBill([
      { quantity: 1, unitCost: 40, discountType: 'percent', discountValue: 150 },
      { quantity: 1, unitCost: 40, discountType: 'baht', discountValue: 999 },
    ]);
    expect(t.lines.map((l) => l.total)).toEqual([0, 0]);
    expect(t.totalAmount).toBe(0);
  });

  it('negative discounts are ignored', () => {
    const t = calculatePurchaseBill([{ quantity: 1, unitCost: 40, discountType: 'baht', discountValue: -5 }]);
    expect(t.totalAmount).toBe(40);
  });

  it('accepts decimal quantities', () => {
    const t = calculatePurchaseBill([{ quantity: 2.5, unitCost: 40 }]);
    expect(t.totalAmount).toBe(100);
  });
});

describe('calculatePurchaseBill - VAT', () => {
  it('INCLUDED: the price already contains VAT', () => {
    const t = calculatePurchaseBill([{ quantity: 1, unitCost: 107, vatType: 'INCLUDED', vatRate: 7 }]);
    expect(t.lines[0]).toMatchObject({ netAmount: 100, vatAmount: 7, total: 107 });
    expect(t.subtotalAmount).toBe(100);
    expect(t.totalAmount).toBe(107);
  });

  it('EXCLUDED: VAT is added on top', () => {
    const t = calculatePurchaseBill([{ quantity: 2, unitCost: 50, vatType: 'EXCLUDED', vatRate: 7 }]);
    expect(t.lines[0]).toMatchObject({ netAmount: 100, vatAmount: 7, total: 107 });
    expect(t.totalAmount).toBe(107);
  });

  it('NONE: rate is forced to 0', () => {
    const t = calculatePurchaseBill([{ quantity: 1, unitCost: 100, vatType: 'NONE', vatRate: 7 }]);
    expect(t.lines[0].vatRate).toBe(0);
    expect(t.vatAmount).toBe(0);
  });

  it('missing / invalid rate defaults to 7', () => {
    const t = calculatePurchaseBill([{ quantity: 1, unitCost: 100, vatType: 'EXCLUDED', vatRate: 'x' }]);
    expect(t.lines[0].vatRate).toBe(7);
    expect(t.totalAmount).toBe(107);
  });

  it('VAT is computed after the line discount and rounded to satang', () => {
    const t = calculatePurchaseBill([
      { quantity: 3, unitCost: 33.33, discountType: 'percent', discountValue: 5, vatType: 'EXCLUDED', vatRate: 7 },
    ]);
    // 99.99 - 5.00 (4.9995 -> 5.00) = 94.99 ; vat 6.6493 -> 6.65
    expect(t.lines[0].discountAmount).toBe(5);
    expect(t.lines[0].netAmount).toBe(94.99);
    expect(t.lines[0].vatAmount).toBe(6.65);
    expect(t.totalAmount).toBe(101.64);
  });
});

describe('calculatePurchaseBill - bill discount', () => {
  it('spreads a baht bill discount over the lines by value, the last line takes the rest', () => {
    const t = calculatePurchaseBill(
      [
        { quantity: 1, unitCost: 100 },
        { quantity: 1, unitCost: 200 },
        { quantity: 1, unitCost: 0 },
      ],
      { type: 'baht', value: 10 },
    );
    expect(t.billDiscountAmount).toBe(10);
    expect(t.lines[0].discountAmount).toBe(3.33);
    expect(t.lines[1].discountAmount).toBe(6.67);
    expect(t.lines[2].discountAmount).toBe(0);
    expect(t.totalAmount).toBe(290);
    const shares = t.lines.reduce((s, l) => s + l.discountAmount, 0);
    expect(Math.round(shares * 100) / 100).toBe(10);
  });

  it('percent bill discount on top of line discounts', () => {
    const t = calculatePurchaseBill(
      [{ quantity: 1, unitCost: 200, discountType: 'baht', discountValue: 20 }],
      { type: 'percent', value: 10 },
    );
    expect(t.lineDiscountAmount).toBe(20);
    expect(t.billDiscountAmount).toBe(18);
    expect(t.discountAmount).toBe(38);
    expect(t.totalAmount).toBe(162);
  });

  it('bill discount is capped at the bill', () => {
    const t = calculatePurchaseBill([{ quantity: 1, unitCost: 50 }], { type: 'baht', value: 80 });
    expect(t.billDiscountAmount).toBe(50);
    expect(t.totalAmount).toBe(0);
  });

  it('bill discount before VAT on an EXCLUDED line', () => {
    const t = calculatePurchaseBill([{ quantity: 1, unitCost: 100, vatType: 'EXCLUDED', vatRate: 7 }], {
      type: 'baht',
      value: 10,
    });
    expect(t.subtotalAmount).toBe(90);
    expect(t.vatAmount).toBe(6.3);
    expect(t.totalAmount).toBe(96.3);
  });
});

describe('per-unit helpers', () => {
  it('grossPerUnit uses the stored total', () => {
    expect(grossPerUnit({ quantity: 4, total: 107 })).toBe(26.75);
    expect(grossPerUnit({ quantity: 0, unitCost: 9 })).toBe(9);
    expect(grossPerUnit({ quantity: 2, unitCost: 9 })).toBe(9);
  });

  it('stockCostPerUnit: gross unless the shop is VAT-registered', () => {
    const line = { quantity: 3, total: 107, netAmount: 100 };
    expect(stockCostPerUnit(line, false)).toBe(35.6667);
    expect(stockCostPerUnit(line, true)).toBe(33.3333);
  });
});

describe('pack units (2026-11-27)', () => {
  it('unit options: base unit, then each pack as a chain of qtyPerPrev', () => {
    const u = poUnitOptions('ม้วน', [{ id: 'g', name: 'กล่อง', qtyPerPrev: 12, barcode: '885' }, { id: 'l', name: 'ลัง', qtyPerPrev: 10 }]);
    expect(u).toEqual([
      { id: null, name: 'ม้วน', factor: 1, barcode: null },
      { id: 'g', name: 'กล่อง', factor: 12, barcode: '885' },
      { id: 'l', name: 'ลัง', factor: 120, barcode: null },
    ]);
    expect(poUnitOptions('', null)).toEqual([{ id: null, name: 'ชิ้น', factor: 1, barcode: null }]);
  });

  it('factor: whole numbers >= 1, anything else is the base unit', () => {
    expect(unitFactorOf(12)).toBe(12);
    expect(unitFactorOf('12')).toBe(12);
    expect(unitFactorOf(null)).toBe(1);
    expect(unitFactorOf(0)).toBe(1);
    expect(unitFactorOf(-3)).toBe(1);
    expect(baseQtyOf(2, 12)).toBe(24);
    expect(baseQtyOf(0.5, 12)).toBe(6);
    expect(baseQtyOf(3, undefined)).toBe(3);
  });

  it('2 ลัง (x12) @ 1,200: the bill is in packs, stock cost per base unit = pack price / 12', () => {
    const t = calculatePurchaseBill([{ quantity: 2, unitCost: 1200 }]);
    expect(t.totalAmount).toBe(2400);
    const [line] = t.lines;
    expect(stockCostPerUnit({ quantity: 2, total: line.total, netAmount: line.netAmount, unitFactor: 12 }, false)).toBe(100);
    // a pack price that does not divide into satang keeps 4 decimals (FIFO batches are Decimal(14,4))
    const [odd] = calculatePurchaseBill([{ quantity: 1, unitCost: 100 }]).lines;
    expect(stockCostPerUnit({ quantity: 1, total: odd.total, netAmount: odd.netAmount, unitFactor: 12 }, false)).toBe(8.3333);
    // VAT-registered shop: net per base unit
    const [vat] = calculatePurchaseBill([{ quantity: 2, unitCost: 1200, vatType: 'EXCLUDED', vatRate: 7 }]).lines;
    expect(stockCostPerUnit({ quantity: 2, total: vat.total, netAmount: vat.netAmount, unitFactor: 12 }, false)).toBe(107);
    expect(stockCostPerUnit({ quantity: 2, total: vat.total, netAmount: vat.netAmount, unitFactor: 12 }, true)).toBe(100);
  });
});

describe('per-unit discount (2026-11-27)', () => {
  it('"5" = 5 baht off each unit: line discount = 5 x qty', () => {
    const t = calculatePurchaseBill([{ quantity: 4, unitCost: 50, discountType: 'unit', discountValue: 5 }]);
    expect(t.lines[0].discountAmount).toBe(20);
    expect(t.totalAmount).toBe(180);
  });

  it('"5%" = 5 % of the unit price = 5 % of the line', () => {
    const t = calculatePurchaseBill([{ quantity: 3, unitCost: 1200, discountType: 'percent', discountValue: 5 }]);
    expect(t.lines[0].discountAmount).toBe(180);
    expect(t.totalAmount).toBe(3420);
  });

  it('per unit discount follows the quantity (re-pricing a partial delivery) and never exceeds the line', () => {
    expect(lineOwnDiscount(100, 2, 'unit', 5)).toBe(10);
    expect(lineOwnDiscount(50, 1, 'unit', 5)).toBe(5);
    expect(lineOwnDiscount(10, 2, 'unit', 99)).toBe(10);
    expect(lineOwnDiscount(100, 2, 'baht', 15)).toBe(15);
    expect(lineOwnDiscount(100, 2, 'percent', 150)).toBe(100);
  });

  it('per unit discount with a pack unit and a bill discount', () => {
    const t = calculatePurchaseBill(
      [{ quantity: 2, unitCost: 1200, discountType: 'unit', discountValue: 50 }, { quantity: 10, unitCost: 10 }],
      { type: 'baht', value: 25 },
    );
    expect(t.lineDiscountAmount).toBe(100);
    expect(t.billDiscountAmount).toBe(25);
    expect(t.totalAmount).toBe(2375);
  });

  it('parses what the grid cell accepts', () => {
    expect(parseUnitDiscount('5')).toEqual({ discountType: 'unit', discountValue: 5 });
    expect(parseUnitDiscount(' 2.50 ')).toEqual({ discountType: 'unit', discountValue: 2.5 });
    expect(parseUnitDiscount('฿1,000')).toEqual({ discountType: 'unit', discountValue: 1000 });
    expect(parseUnitDiscount('5%')).toEqual({ discountType: 'percent', discountValue: 5 });
    expect(parseUnitDiscount('12.5 %')).toEqual({ discountType: 'percent', discountValue: 12.5 });
    expect(parseUnitDiscount('')).toEqual({ discountType: 'unit', discountValue: 0 });
    expect(parseUnitDiscount('101%')).toBeNull();
    expect(parseUnitDiscount('-5')).toBeNull();
    expect(parseUnitDiscount('abc')).toBeNull();
    expect(parseUnitDiscount('1.234')).toBeNull();
  });

  it('shows stored discounts per unit; an older whole-line baht discount only when it divides exactly', () => {
    expect(unitDiscountText('percent', 5, 3)).toEqual({ text: '5%', discountType: 'percent', discountValue: 5 });
    expect(unitDiscountText('unit', 2.5, 3)).toEqual({ text: '2.5', discountType: 'unit', discountValue: 2.5 });
    expect(unitDiscountText('baht', 0, 3)).toEqual({ text: '', discountType: 'unit', discountValue: 0 });
    expect(unitDiscountText('baht', 30, 4)).toEqual({ text: '7.5', discountType: 'unit', discountValue: 7.5 });
    expect(unitDiscountText('baht', 10, 3)).toBeNull();
  });
});

describe('default unit price of a new line', () => {
  const history = [
    { unitFactor: 1, unitCost: 11 }, // newest: per piece
    { unitFactor: 12, unitCost: 120 }, // older: per box of 12
  ];
  it('the last price from this supplier in the same unit', () => {
    expect(defaultPoUnitPrice(history, 12, 9)).toEqual({ price: 120, source: 'same-unit' });
    expect(defaultPoUnitPrice(history, 1, 9)).toEqual({ price: 11, source: 'same-unit' });
  });
  it('else the newest price in another unit converted by the factors', () => {
    expect(defaultPoUnitPrice(history, 6, 9)).toEqual({ price: 66, source: 'other-unit' });
    expect(defaultPoUnitPrice([{ unitFactor: 12, unitCost: 100 }], 1, 9)).toEqual({ price: 8.33, source: 'other-unit' });
  });
  it('else the product cost x factor', () => {
    expect(defaultPoUnitPrice([], 12, 8.5)).toEqual({ price: 102, source: 'cost' });
    expect(defaultPoUnitPrice(null, 1, null)).toEqual({ price: 0, source: 'cost' });
  });
});
