import { BadRequestException } from '@nestjs/common';
import { validateCheckoutInput, lineAmounts, checkPointsDiscount } from './checkout-guards';
import { shiftFigures, refundKind } from '../shifts/shifts.service';

const base = () => ({
  clientOrderId: 'c-1234567890abcdef',
  shiftId: 's1',
  items: [{ productId: 'p1', quantity: 1, unitPrice: 10 }],
  payments: [{ method: 'CASH', amount: 10 }],
});

describe('validateCheckoutInput', () => {
  const bad = (patch: (d: any) => void) => {
    const d: any = base();
    patch(d);
    expect(() => validateCheckoutInput(d)).toThrow(BadRequestException);
  };
  it('accepts a normal bill', () => expect(() => validateCheckoutInput(base())).not.toThrow());
  it('rejects malformed / overflowing input with 400', () => {
    bad((d) => (d.items = [null]));
    bad((d) => delete d.items[0].productId);
    bad((d) => (d.clientOrderId = { a: 1 }));
    bad((d) => (d.items[0].quantity = 1e9));
    bad((d) => (d.items[0].quantity = '2'));
    bad((d) => (d.items[0].unitPrice = 1e12));
    bad((d) => (d.payments = [null]));
    bad((d) => (d.orderNumber = { x: 1 }));
    bad((d) => (d.items[0].claimQuantity = 5));
    expect(() => validateCheckoutInput(null)).toThrow(BadRequestException);
  });
});

describe('lineAmounts', () => {
  it('keeps stored rows consistent when the price has more than 2 decimals', () => {
    const r = lineAmounts(3, 15.005, 0);
    expect(r.total).toBe(45.02);
    expect(r.storedUnitPrice).toBe(15.01);
    expect(Math.round((3 * r.storedUnitPrice - r.storedDiscount) * 100) / 100).toBe(r.total);
  });
  it('leaves 2-decimal prices alone', () => {
    expect(lineAmounts(2, 189, 10)).toEqual({ storedUnitPrice: 189, total: 368, storedDiscount: 10 });
  });
});

describe('checkPointsDiscount', () => {
  it('requires a multiple of the redeem rate and the exact value', () => {
    expect(() => checkPointsDiscount(150, 1, 100, 1, false)).toThrow(BadRequestException);
    expect(() => checkPointsDiscount(100, 5, 100, 1, false)).toThrow(BadRequestException);
    expect(() => checkPointsDiscount(0, 3, 100, 1, false)).toThrow(BadRequestException);
    expect(() => checkPointsDiscount(200, 2, 100, 1, false)).not.toThrow();
    expect(() => checkPointsDiscount(200, 1.5, 100, 1, true)).not.toThrow(); // bill fully covered
  });
});

describe('shiftFigures', () => {
  const shift = {
    status: 'OPEN', closedAt: null, startingCash: 100,
    orders: [
      { status: 'COMPLETED', discountAmount: 5, items: [{ discountAmount: 2 }], payments: [{ method: 'CASH', amount: 50 }], returns: [{ refundAmount: 10, refundMethod: 'CASH' }, { refundAmount: 5, refundMethod: 'DEBT_REDUCTION' }] },
      { status: 'VOIDED', discountAmount: 0, items: [], payments: [{ method: 'CASH', amount: 30 }], returns: [] },
    ],
    cashMovements: [
      { type: 'IN', category: 'DEBT_PAYMENT', amount: 20, reason: 'รับชำระหนี้ REC-1' },
      { type: 'IN', category: 'GENERAL', amount: 7, reason: 'เติม' },
      { type: 'OUT', category: 'REFUND', amount: 10, reason: 'คืนเงินสดคืนสินค้า RET-1 (บิล ORD-1)' },
      { type: 'OUT', category: 'REFUND', amount: 4, reason: 'คืนเงินสดเคลมสินค้า #CLM-1' },
    ],
  };
  it('counts completed bills, real discounts, returns, debt collections and refund kinds', () => {
    const f = shiftFigures(shift);
    expect(f.orderCount).toBe(1);
    expect(f.voidCount).toBe(1);
    expect(f.discountTotal).toBe(7);
    expect(f.netSales).toBe(35);
    expect(f.debtCollectionCash).toBe(20);
    expect(f.otherCashIn).toBe(7);
    expect(f.cashIn).toBe(27);
    expect(f.returnRefundCount).toBe(1);
    expect(f.claimRefundCount).toBe(1);
    expect(f.expectedCash).toBe(100 + 50 + 27 - 14);
  });
  it('classifies refund movements', () => {
    expect(refundKind('คืนเงินสดยกเลิกบิลข้ามกะ #ORD-1')).toBe('VOID');
    expect(refundKind('คืนเงินสดคืนสินค้า RET-1')).toBe('RETURN');
    expect(refundKind('อื่นๆ')).toBe('CLAIM');
  });
});
