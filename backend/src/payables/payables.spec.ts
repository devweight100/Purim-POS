import { payableNow } from './payables.service';

describe('payableNow (supplier bill amount that can be paid now)', () => {
  const items = (received: number, cost = 10) => [{ receivedQty: received, unitCost: cost }];
  it('is capped at the value of goods received', () => {
    expect(payableNow({ totalAmount: 1000, paidAmount: 0, remainingPayable: 1000, items: items(40) })).toBe(400);
  });
  it('subtracts what was already paid', () => {
    expect(payableNow({ totalAmount: 1000, paidAmount: 300, remainingPayable: 700, items: items(40) })).toBe(100);
  });
  it('is zero when everything received is paid', () => {
    expect(payableNow({ totalAmount: 1000, paidAmount: 400, remainingPayable: 600, items: items(40) })).toBe(0);
  });
  it('fully received bill: remaining payable', () => {
    expect(payableNow({ totalAmount: 1000, paidAmount: 250, remainingPayable: 750, items: items(100) })).toBe(750);
  });
});

import { billFigures, billMatchesSearch } from './payable-bills';

describe('billFigures (payables page bill row)', () => {
  const vatLine = [{ receivedQty: 10, unitCost: 10, quantity: 10, total: 107 }];
  it('remaining = payableNow (gross per unit incl. VAT)', () => {
    const po = { totalAmount: 107, paidAmount: 0, remainingPayable: 107, paymentStatus: 'UNPAID', items: vatLine };
    expect(billFigures(po, [])).toMatchObject({ receivedAmount: 107, remainingPayable: payableNow(po), paymentStatus: 'UNPAID' });
    expect(payableNow(po)).toBe(107);
  });
  it('paid / discount from the vouchers; PAID only when the whole PO is settled', () => {
    const po = { totalAmount: 300, paidAmount: 120, remainingPayable: 180, paymentStatus: 'PARTIALLY_PAID', items: [{ receivedQty: 4, unitCost: 30, quantity: 10, total: 300 }] };
    expect(billFigures(po, [{ amountPaid: '100', discountAmount: '3' }, { amountPaid: 20, discountAmount: 0 }])).toEqual({
      totalAmount: 300, receivedAmount: 120, alreadyPaidAmount: 120, alreadyDiscountAmount: 3, remainingPayable: 0, paymentStatus: 'PARTIALLY_PAID',
    });
    expect(billFigures({ ...po, paidAmount: 300, remainingPayable: 0 }, []).paymentStatus).toBe('PAID');
    expect(billFigures({ ...po, paidAmount: 0, remainingPayable: 300, paymentStatus: 'UNPAID' }, []).paymentStatus).toBe('UNPAID');
  });
  it('search: PO number, supplier name, supplier invoice number (case-insensitive)', () => {
    const b = { poNumber: 'PO-2611001', supplierName: 'ABC Trading', supplierInvoiceNo: 'INV-9' };
    expect(['po-26', 'abc', 'inv-9', ''].map((q) => billMatchesSearch(b, q))).toEqual([true, true, true, true]);
    expect(billMatchesSearch(b, 'zzz')).toBe(false);
  });
});
