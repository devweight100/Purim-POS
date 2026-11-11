import { describe, expect, it } from 'vitest';
import {
  calculatePurchaseBill,
  grossPerUnit,
  normDiscountType,
  normVatType,
  stockCostPerUnit,
  toBaseUnitLine,
} from '@/lib/po-calc';

describe('normalisers', () => {
  it('maps VAT type spellings', () => {
    expect(normVatType('included')).toBe('INCLUDED');
    expect(normVatType('INCLUDE')).toBe('INCLUDED');
    expect(normVatType('exclude')).toBe('EXCLUDED');
    expect(normVatType(undefined)).toBe('NONE');
    expect(normVatType('nonsense')).toBe('NONE');
  });
  it('anything but percent is a baht discount', () => {
    expect(normDiscountType('percent')).toBe('percent');
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

describe('toBaseUnitLine', () => {
  it('base unit lines are unchanged', () => {
    expect(toBaseUnitLine({ quantity: 3, unitCost: 10 })).toEqual({ quantity: 3, unitCost: 10, discountType: 'baht', discountValue: 0 });
  });

  it('a pack price that divides into satang', () => {
    expect(toBaseUnitLine({ quantity: 2, unitCost: 120, multiplier: 12 })).toEqual({
      quantity: 24,
      unitCost: 10,
      discountType: 'baht',
      discountValue: 0,
    });
  });

  it('rounds the unit cost up and gives the extra back as a discount, keeping the line amount', () => {
    const r = toBaseUnitLine({ quantity: 1, unitCost: 100, multiplier: 12, discountType: 'percent', discountValue: 10 });
    expect(r.quantity).toBe(12);
    expect(r.unitCost).toBe(8.34);
    expect(r.discountType).toBe('baht');
    // 12 x 8.34 = 100.08 ; extra 0.08 + 10% of 100 = 10.08
    expect(r.discountValue).toBe(10.08);
    const before = calculatePurchaseBill([{ quantity: 1, unitCost: 100, discountType: 'percent', discountValue: 10 }]);
    const after = calculatePurchaseBill([r]);
    expect(after.totalAmount).toBe(before.totalAmount);
  });
});
