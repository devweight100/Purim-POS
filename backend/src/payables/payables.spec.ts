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
