import { calculatePurchaseBill, grossPerUnit, stockCostPerUnit } from './po-calc';

describe('purchase bill arithmetic', () => {
  it('no VAT: total = qty x cost', () => {
    const b = calculatePurchaseBill([{ quantity: 10, unitCost: 50 }]);
    expect(b.totalAmount).toBe(500);
    expect(b.vatAmount).toBe(0);
    expect(b.subtotalAmount).toBe(500);
  });

  it('VAT included in the price: total unchanged, VAT extracted', () => {
    const b = calculatePurchaseBill([{ quantity: 1, unitCost: 107, vatType: 'INCLUDED', vatRate: 7 }]);
    expect(b.totalAmount).toBe(107);
    expect(b.vatAmount).toBe(7);
    expect(b.subtotalAmount).toBe(100);
  });

  it('VAT added on top: total = amount + 7%', () => {
    const b = calculatePurchaseBill([{ quantity: 2, unitCost: 50, vatType: 'EXCLUDED', vatRate: 7 }]);
    expect(b.subtotalAmount).toBe(100);
    expect(b.vatAmount).toBe(7);
    expect(b.totalAmount).toBe(107);
  });

  it('mixed lines from the same supplier', () => {
    const b = calculatePurchaseBill([
      { quantity: 1, unitCost: 100, vatType: 'NONE' },
      { quantity: 1, unitCost: 107, vatType: 'INCLUDED', vatRate: 7 },
      { quantity: 1, unitCost: 100, vatType: 'EXCLUDED', vatRate: 7 },
    ]);
    expect(b.vatAmount).toBe(14);
    expect(b.subtotalAmount).toBe(300);
    expect(b.totalAmount).toBe(314);
  });

  it('line discount (%), then bill discount spread by value, before VAT', () => {
    const b = calculatePurchaseBill(
      [
        { quantity: 1, unitCost: 200, discountType: 'percent', discountValue: 10, vatType: 'EXCLUDED', vatRate: 7 }, // 180
        { quantity: 1, unitCost: 120, vatType: 'NONE' }, // 120
      ],
      { type: 'baht', value: 30 }, // 18 + 12
    );
    expect(b.lineDiscountAmount).toBe(20);
    expect(b.billDiscountAmount).toBe(30);
    expect(b.lines[0].netAmount).toBe(162);
    expect(b.lines[0].vatAmount).toBe(11.34);
    expect(b.lines[1].total).toBe(108);
    expect(b.totalAmount).toBe(281.34);
  });

  it('bill discount allocation always adds up exactly', () => {
    const b = calculatePurchaseBill(
      [
        { quantity: 3, unitCost: 33.33 },
        { quantity: 7, unitCost: 1.11 },
        { quantity: 1, unitCost: 0.99 },
      ],
      { type: 'percent', value: 13 },
    );
    const shares = b.lines.reduce((s, l) => s + l.discountAmount, 0);
    expect(Math.round(shares * 100) / 100).toBe(b.discountAmount);
    expect(b.totalAmount).toBe(Math.round((b.baseAmount - b.discountAmount) * 100) / 100);
  });

  it('stock cost: VAT is a cost unless the shop is VAT-registered', () => {
    const [line] = calculatePurchaseBill([{ quantity: 4, unitCost: 100, vatType: 'EXCLUDED', vatRate: 7 }]).lines;
    expect(grossPerUnit({ quantity: 4, total: line.total })).toBe(107);
    expect(stockCostPerUnit({ quantity: 4, total: line.total, netAmount: line.netAmount }, false)).toBe(107);
    expect(stockCostPerUnit({ quantity: 4, total: line.total, netAmount: line.netAmount }, true)).toBe(100);
  });
});
